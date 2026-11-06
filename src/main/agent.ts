import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, PermissionDecision, PermissionRequest, Workspace } from '@shared/types'
import * as store from './store'
import * as git from './git'
import { claudeExecutable } from './claudeBinary'
import { runCodex } from './codex'
import { enabledSubagents, expandShortcuts, renderTurn, runAdvisor, steerMessage, systemAppend } from './extras'
import * as orchestrator from './orchestrator'

type Emit = (chatId: string, payload: { item?: ChatItem; chat?: Chat; permission?: PermissionRequest; permissionDone?: string }) => void

interface Running {
  abort: AbortController
  query?: { interrupt(): Promise<unknown> }
}

const running = new Map<string, Running>()
/** Advisor reviews in flight, per chat. */
const advising = new Map<string, AbortController>()

/** Marks advisor notes as sent or dismissed. For "send", returns the message to pass to the agent. */
export function resolveAdvice(chat: Chat, itemId: string, action: 'send' | 'dismiss'): { item: ChatItem; message?: string } {
  const item = store.chatItems(chat.id).find((x) => x.id === itemId)
  if (!item || item.kind !== 'advisor' || item.pending || item.silent) throw new Error('No advisor notes to act on')
  if (item.resolved) throw new Error('These notes were already handled')
  item.resolved = action === 'send' ? 'sent' : 'dismissed'
  store.upsertItem(chat.id, item)
  chat.advisorBlocker = false
  store.save()
  return { item, message: action === 'send' ? steerMessage({ silent: false, blocker: !!item.blocker, notes: item.text.split('\n') }) : undefined }
}

// Tools that only read; asking about them would be noise.
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Agent', 'NotebookRead', 'BashOutput', 'ExitPlanMode', 'ToolSearch', 'Skill'])
for (const t of orchestrator.READ_ONLY) READ_ONLY_TOOLS.add(t)
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const pending = new Map<string, { req: PermissionRequest; resolve: (d: PermissionDecision) => void }>()

export function respondPermission(id: string, decision: PermissionDecision) {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  p.resolve(decision)
}

export function pendingPermissions(): PermissionRequest[] {
  return [...pending.values()].map((p) => p.req)
}

/** Whether a tool call needs the user's OK under a chat's permission setting. */
export function needsApproval(permission: Chat['permission'], alwaysAllow: string[] | undefined, toolName: string): boolean {
  if (!permission || permission === 'full') return false
  if (READ_ONLY_TOOLS.has(toolName) || alwaysAllow?.includes(toolName)) return false
  if (permission === 'edits' && EDIT_TOOLS.has(toolName)) return false
  return true
}

/** Slash commands the agent reported at startup, per workspace. */
export const reportedCommands = new Map<string, string[]>()

// The SDK is ESM-only; load it lazily from the CJS main bundle.
let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

const AUTH_ERROR = /not logged in|please run \/login|invalid api key|authentication[_ ]error|oauth token (?:has )?expired|\b401\b/i

/** A clearer message when Claude Code isn't signed in. Sign-in always goes through Claude Code's own /login. */
export function authHint(text: string | undefined): string | null {
  if (!text || !AUTH_ERROR.test(text)) return null
  return 'Claude Code isn\'t signed in. Open Terminal, run `claude`, and type /login to sign in with your Claude account. Or add an Anthropic API key in Settings.'
}

function stringifyResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: { type?: string; text?: string }) => (c?.type === 'text' ? c.text : `[${c?.type}]`))
      .join('\n')
  }
  return JSON.stringify(content)
}

export function isRunning(chatId: string) {
  return running.has(chatId)
}

export async function stop(chatId: string) {
  advising.get(chatId)?.abort()
  const r = running.get(chatId)
  if (!r) return
  if (!r.query) return r.abort.abort()
  try {
    await r.query.interrupt()
  } catch {
    r.abort.abort()
  }
}

function dataUrlToBlock(url: string) {
  const m = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/)
  if (!m) return null
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
}

/**
 * Streaming input for one turn. It stays open until the turn ends, because permission answers
 * travel over the same channel.
 */
async function* userMessage(text: string, images: string[], done: Promise<void>) {
  const content = images.length ? [...images.map(dataUrlToBlock).filter(Boolean), { type: 'text', text }] : text
  yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  await done
}

export async function send(
  chat: Chat,
  ws: Workspace,
  text: string,
  env: Record<string, string>,
  emit: Emit,
  onDone?: (chat: Chat) => void,
  images: string[] = [],
  onAsk?: (chat: Chat, req: PermissionRequest) => void,
  /** Builds extra query() options, such as the orchestrator's tools. */
  extraOptions?: (sdk: Awaited<ReturnType<typeof loadSdk>>) => Record<string, unknown>,
  opts: { fromAdvisor?: boolean } = {}
) {
  if (running.has(chat.id)) throw new Error('Agent is already running in this chat')
  const now = Date.now()
  const checkpoint = (await git.snapshot(ws.path)) ?? undefined
  const userItem: ChatItem = {
    id: randomUUID(),
    kind: 'user',
    text,
    images: images.length ? images : undefined,
    ts: now,
    checkpoint,
    resumeAt: chat.lastUuid,
    ...(opts.fromAdvisor ? { fromAdvisor: true } : {})
  }
  store.upsertItem(chat.id, userItem)
  emit(chat.id, { item: userItem })

  if (chat.title === 'New chat') chat.title = text.slice(0, 40).replace(/\s+/g, ' ').trim() || 'New chat'
  chat.status = 'running'
  chat.unread = false
  chat.advisorBlocker = false
  store.save()
  emit(chat.id, { chat })

  const abort = new AbortController()
  const r: Running = { abort }
  running.set(chat.id, r)

  // Streaming text for the current assistant message, keyed by content-block index.
  let streamItem: Extract<ChatItem, { kind: 'assistant' }> | null = null
  let lastUuid: string | undefined
  // After a revert, fork the session at the kept point (or start fresh if nothing was kept).
  const forkAt = chat.forkAt
  const resume = forkAt === null ? undefined : chat.sdkSessionId
  chat.forkAt = undefined
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  // A chat opened from a coworker's share starts with their transcript as context.
  const prompt = chat.handoff ? `${chat.handoff}\n\n${text}` : text
  chat.handoff = undefined
  let endTurn = () => {}
  const turnDone = new Promise<void>((r) => (endTurn = r))
  const put = (item: ChatItem) => {
    store.upsertItem(chat.id, item)
    emit(chat.id, { item })
  }
  let turnOk = false

  try {
    if (chat.model === 'codex') {
      const started = Date.now()
      const res = await runCodex({
        cwd: ws.path,
        prompt,
        effort: chat.effort,
        readOnly: !!chat.planMode,
        threadId: forkAt === null ? undefined : chat.codexThreadId,
        images,
        env,
        signal: abort.signal,
        onThread: (id) => {
          chat.codexThreadId = id
          store.save()
        },
        put
      })
      put({ id: randomUUID(), kind: 'result', ok: res.ok, durationMs: Date.now() - started, ts: Date.now() })
      turnOk = res.ok
      chat.status = 'idle'
      return
    }
    const sdkMod = await loadSdk()
    const { query } = sdkMod
    const extras = store.get().settings.extras
    const append = systemAppend(extras, !!chat.planMode)
    const canUseTool = async (toolName: string, input: Record<string, unknown>, opts: { signal: AbortSignal; suggestions?: unknown[] }) => {
      if (toolName === 'ExitPlanMode' && chat.planMode) {
        // The plan card asks the user; the agent must not start building on its own.
        return { behavior: 'deny', message: 'The plan is shown to the user for approval. Stop here and wait for their reply.' }
      }
      if (!needsApproval(chat.permission, chat.alwaysAllow, toolName)) return { behavior: 'allow', updatedInput: input }
      const req: PermissionRequest = { id: randomUUID(), chatId: chat.id, toolName, input }
      const decision = await new Promise<PermissionDecision>((resolve) => {
        pending.set(req.id, { req, resolve })
        const cancel = () => respondPermission(req.id, 'deny')
        opts.signal.addEventListener('abort', cancel, { once: true })
        abort.signal.addEventListener('abort', cancel, { once: true })
        emit(chat.id, { permission: req })
        onAsk?.(chat, req)
      })
      emit(chat.id, { permissionDone: req.id })
      if (decision === 'deny') return { behavior: 'deny', message: 'The user declined this tool call.' }
      if (decision === 'always') {
        chat.alwaysAllow = [...new Set([...(chat.alwaysAllow ?? []), toolName])]
        store.save()
      }
      return { behavior: 'allow', updatedInput: input }
    }
    const q = query({
      prompt: userMessage(expandShortcuts(prompt, extras), images, turnDone) as never,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable(),
        cwd: ws.path,
        model: chat.model,
        effort: chat.effort,
        resume,
        ...(forkAt ? { resumeSessionAt: forkAt, forkSession: true } : {}),
        additionalDirectories: chat.additionalDirectories,
        // Conductor runs agents unattended inside an isolated worktree.
        permissionMode: chat.planMode ? 'plan' : !chat.permission || chat.permission === 'full' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: true,
        canUseTool,
        includePartialMessages: true,
        abortController: abort,
        settingSources: ['user', 'project', 'local'],
        agents: enabledSubagents(extras),
        ...(append ? { systemPrompt: { type: 'preset', preset: 'claude_code', append } } : {}),
        env: { ...process.env, ...env },
        ...extraOptions?.(sdkMod)
      } as never
    })
    r.query = q

    for await (const msg of q as AsyncIterable<any>) {
      if ((msg.type === 'assistant' || msg.type === 'user') && msg.uuid) lastUuid = msg.uuid
      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            if (msg.session_id) chat.sdkSessionId = msg.session_id
            if (Array.isArray(msg.slash_commands)) reportedCommands.set(ws.id, msg.slash_commands)
            store.save()
          } else if (msg.subtype === 'commands_changed' && Array.isArray(msg.commands)) {
            reportedCommands.set(ws.id, msg.commands.map((c: { name: string }) => c.name))
          }
          break
        case 'stream_event': {
          // Subagent text isn't shown; its result arrives on the Agent tool call.
          if (msg.parent_tool_use_id) break
          const ev = msg.event
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            if (!streamItem) {
              streamItem = { id: randomUUID(), kind: 'assistant', text: '', streaming: true, ts: Date.now() }
            }
            streamItem.text += ev.delta.text
            emit(chat.id, { item: { ...streamItem } })
          }
          break
        }
        case 'assistant': {
          const parentId: string | undefined = msg.parent_tool_use_id ?? undefined
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text) {
              if (parentId) continue
              const item: ChatItem = streamItem
                ? { ...streamItem, text: block.text, streaming: false }
                : { id: randomUUID(), kind: 'assistant', text: block.text, ts: Date.now() }
              streamItem = null
              put(item)
            } else if (block.type === 'tool_use') {
              streamItem = null
              const item: Extract<ChatItem, { kind: 'tool' }> = {
                id: block.id,
                kind: 'tool',
                name: block.name,
                input: block.input,
                ...(parentId ? { parentId } : {}),
                ts: Date.now()
              }
              tools.set(block.id, item)
              put(item)
            }
          }
          break
        }
        case 'user': {
          const content = msg.message?.content
          if (!Array.isArray(content)) break
          for (const block of content) {
            if (block.type !== 'tool_result') continue
            const t = tools.get(block.tool_use_id)
            if (!t) continue
            t.result = stringifyResult(block.content).slice(0, 20000)
            t.isError = !!block.is_error
            put({ ...t })
          }
          break
        }
        case 'result':
          endTurn()
          turnOk = msg.subtype === 'success' && !msg.is_error
          if (!turnOk) {
            const hint = authHint(typeof msg.result === 'string' ? msg.result : (msg.errors ?? []).join('\n'))
            if (hint) put({ id: randomUUID(), kind: 'error', text: hint, ts: Date.now() })
          }
          put({
            id: randomUUID(),
            kind: 'result',
            ok: msg.subtype === 'success' && !msg.is_error,
            costUsd: msg.total_cost_usd,
            durationMs: msg.duration_ms,
            turns: msg.num_turns,
            ts: Date.now()
          })
          if (msg.session_id) chat.sdkSessionId = msg.session_id
          break
      }
    }
    chat.status = 'idle'
  } catch (e) {
    const aborted = abort.signal.aborted
    chat.status = aborted ? 'idle' : 'error'
    put({
      id: randomUUID(),
      kind: 'error',
      text: aborted ? 'Stopped' : authHint((e as Error).message) ?? ((e as Error).message || String(e)),
      ts: Date.now()
    })
  } finally {
    endTurn()
    for (const [id, p] of pending) if (p.req.chatId === chat.id) respondPermission(id, 'deny')
    if (streamItem) put({ ...streamItem, streaming: false })
    running.delete(chat.id)
    if (lastUuid) chat.lastUuid = lastUuid
    chat.unread = true
    store.save()
    emit(chat.id, { chat })
    onDone?.(chat)
  }
  if (turnOk && !abort.signal.aborted && store.get().settings.extras.advisor) {
    await advise(chat, ws, userItem.id, env, emit, (msg) => send(chat, ws, msg, env, emit, onDone, [], onAsk, extraOptions, { fromAdvisor: true }), !opts.fromAdvisor)
  }
}

/** Has the advisor review the turn that started at `fromItemId`, and passes blockers back if allowed. */
async function advise(
  chat: Chat,
  ws: Workspace,
  fromItemId: string,
  env: Record<string, string>,
  emit: Emit,
  followUp: (text: string) => Promise<void>,
  maySteer: boolean
) {
  const extras = store.get().settings.extras
  if (chat.advisor === false) return
  const list = store.chatItems(chat.id)
  const start = list.findIndex((x) => x.id === fromItemId)
  const turn = start < 0 ? [] : list.slice(start)
  if (!turn.some((x) => x.kind === 'assistant' || x.kind === 'tool')) return
  const item: Extract<ChatItem, { kind: 'advisor' }> = { id: randomUUID(), kind: 'advisor', text: '', pending: true, ts: Date.now() }
  const put = () => {
    store.upsertItem(chat.id, { ...item })
    emit(chat.id, { item: { ...item } })
  }
  put()
  const abort = new AbortController()
  advising.set(chat.id, abort)
  try {
    const advice = await runAdvisor({
      transcript: renderTurn(turn),
      cwd: ws.path,
      model: extras.advisorModel,
      env: { ...process.env, ...env },
      executable: claudeExecutable(),
      signal: abort.signal
    })
    item.pending = false
    item.silent = advice.silent
    item.blocker = advice.blocker
    item.text = advice.silent ? 'No concerns' : advice.notes.join('\n')
    put()
    if (advice.blocker && !running.has(chat.id)) {
      chat.advisorBlocker = true
      emit(chat.id, { chat })
    }
    store.save()
    // One automatic follow-up per user message, and only if the user hasn't started a new turn.
    if (advice.blocker && maySteer && extras.advisorSteer && !running.has(chat.id)) {
      item.resolved = 'sent'
      put()
      await followUp(steerMessage(advice))
    }
  } catch (e) {
    item.pending = false
    item.silent = true
    item.text = abort.signal.aborted ? 'Advisor stopped' : `Advisor failed: ${(e as Error).message || String(e)}`
    put()
    store.save()
  } finally {
    if (advising.get(chat.id) === abort) advising.delete(chat.id)
  }
}


/** Rewinds a chat to just before `itemId`: restores the files and forks the conversation there. */
export async function revert(chat: Chat, ws: Workspace, itemId: string): Promise<string> {
  await stop(chat.id)
  const list = store.chatItems(chat.id)
  const i = list.findIndex((x) => x.id === itemId)
  const item = list[i]
  if (!item || item.kind !== 'user') throw new Error('Can only revert to a message you sent')
  if (item.checkpoint) await git.restore(ws.path, item.checkpoint)
  list.splice(i)
  const note: ChatItem = { id: randomUUID(), kind: 'note', text: 'Reverted files and conversation to before this message', ts: Date.now() }
  store.upsertItem(chat.id, note)
  chat.forkAt = item.resumeAt ?? null
  chat.lastUuid = item.resumeAt
  store.save()
  return item.text
}

export function stopAll() {
  for (const a of advising.values()) a.abort()
  for (const r of running.values()) r.abort.abort()
}
