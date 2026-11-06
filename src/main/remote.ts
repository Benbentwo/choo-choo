import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { Chat, ChatItem, Workspace } from '@shared/types'
import * as store from './store'
import * as pty from './pty'
import * as agent from './agent'
import { claudeExecutable, installedExecutable } from './claudeBinary'

/**
 * "Continue on phone": hands a chat's Claude Code session to Remote Control so it can be steered from
 * claude.ai/code or the Claude app. Choo Choo runs the official `claude` binary in a terminal with
 * `--resume <session> --remote-control`; it never talks to claude.ai itself (decision 0001).
 * While the chat is on the phone, Choo Choo doesn't run its own agent on that session. Bringing it
 * back stops that process and copies the turns made on the phone into the chat.
 */

type Emit = (chatId: string, payload: { item?: ChatItem; chat?: Chat }) => void

/** Terminal id for a chat's Remote Control process. Starts with the workspace id so archiving kills it. */
export const phoneTerminalId = (chat: Chat) => `${chat.workspaceId}:phone-${chat.id}`

/** Quotes one argument for a POSIX shell. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/** Arguments for `claude` that resume this chat's session with Remote Control on, in the chat's mode. */
export function phoneArgs(chat: Pick<Chat, 'sdkSessionId' | 'title' | 'model' | 'effort' | 'permission' | 'planMode'>): string[] {
  if (!chat.sdkSessionId) throw new Error('Send a message first, so there is a session to continue')
  const args = ['--resume', chat.sdkSessionId, '--remote-control', chat.title || 'Choo Choo']
  if (chat.model && chat.model !== 'codex') args.push('--model', chat.model)
  if (chat.effort) args.push('--effort', chat.effort)
  if (chat.planMode) args.push('--permission-mode', 'plan')
  else if (!chat.permission || chat.permission === 'full') args.push('--dangerously-skip-permissions')
  else if (chat.permission === 'edits') args.push('--permission-mode', 'acceptEdits')
  return args
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g

export const SESSION_LIST_URL = 'https://claude.ai/code'
const SESSION_URL = /https:\/\/claude\.ai\/code\/(?:session_)?[A-Za-z0-9_-]{8,}(?:\?[\w=&%.-]*)?/

/** The claude.ai/code session link in Claude Code's output, if it printed one yet. */
export function findSessionUrl(output: string): string | undefined {
  // A terminal hyperlink (OSC 8) carries the link even when the visible text is just a label.
  return output.match(SESSION_URL)?.[0] ?? output.replace(ANSI, '').match(SESSION_URL)?.[0]
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c: { type?: string; text?: string }) => (c?.type === 'text' ? (c.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

interface TranscriptMessage {
  type: string
  uuid: string
  message: unknown
  parent_tool_use_id?: string | null
}

/**
 * Chat items for the transcript entries after `afterUuid` (all of them if it isn't found), so turns
 * made on the phone show up in the chat. Returns the last entry's uuid to fork or resume from next.
 */
export function itemsFromTranscript(messages: TranscriptMessage[], afterUuid?: string): { items: ChatItem[]; lastUuid?: string } {
  // If the last known entry is gone, don't guess: re-adding the whole history would duplicate it.
  const start = afterUuid ? messages.findIndex((m) => m.uuid === afterUuid) + 1 : 0
  if (afterUuid && start === 0) {
    const last = [...messages].reverse().find((m) => m.type === 'user' || m.type === 'assistant')
    return { items: [], lastUuid: last?.uuid }
  }
  const items: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  const now = Date.now()
  let lastUuid: string | undefined
  for (const m of messages.slice(start)) {
    if (m.type !== 'user' && m.type !== 'assistant') continue
    lastUuid = m.uuid
    if (m.parent_tool_use_id) continue
    const content = (m.message as { content?: unknown } | undefined)?.content
    if (m.type === 'user') {
      const results = Array.isArray(content) ? content.filter((b: { type?: string }) => b?.type === 'tool_result') : []
      for (const b of results as { tool_use_id: string; content: unknown; is_error?: boolean }[]) {
        const t = tools.get(b.tool_use_id)
        if (!t) continue
        t.result = (typeof b.content === 'string' ? b.content : textOf(b.content)).slice(0, 20000)
        t.isError = !!b.is_error
      }
      const text = results.length ? '' : textOf(content)
      // Claude Code's own wrappers, such as command echoes and caveats, aren't something you typed.
      if (text.trim() && !/^<(command-|local-command-|system-reminder)/.test(text.trim())) {
        items.push({ id: randomUUID(), kind: 'user', text, ts: now, resumeAt: lastUuidBefore(messages, m.uuid) })
      }
      continue
    }
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'text' && b.text) items.push({ id: randomUUID(), kind: 'assistant', text: b.text, ts: now })
      else if (b?.type === 'tool_use') {
        const t: Extract<ChatItem, { kind: 'tool' }> = { id: b.id, kind: 'tool', name: b.name, input: b.input, ts: now }
        tools.set(b.id, t)
        items.push(t)
      }
    }
  }
  return { items, lastUuid }
}

function lastUuidBefore(messages: TranscriptMessage[], uuid: string): string | undefined {
  const i = messages.findIndex((m) => m.uuid === uuid)
  for (let j = i - 1; j >= 0; j--) if (messages[j].type === 'user' || messages[j].type === 'assistant') return messages[j].uuid
  return undefined
}

let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

/** Copies the turns made on the phone into the chat. */
async function importPhoneTurns(chat: Chat, ws: Workspace, emit: Emit) {
  if (!chat.sdkSessionId) return
  let messages: TranscriptMessage[] = []
  try {
    messages = (await (await loadSdk()).getSessionMessages(chat.sdkSessionId, { dir: ws.path })) as TranscriptMessage[]
  } catch {
    /* no transcript: nothing happened on the phone */
  }
  const { items, lastUuid } = itemsFromTranscript(messages, chat.lastUuid)
  for (const item of items) {
    store.upsertItem(chat.id, item)
    emit(chat.id, { item })
  }
  if (lastUuid) chat.lastUuid = lastUuid
  const note: ChatItem = {
    id: randomUUID(),
    kind: 'note',
    text: items.length ? 'Back from your phone' : 'Back from your phone (nothing new was sent there)',
    ts: Date.now()
  }
  store.upsertItem(chat.id, note)
  emit(chat.id, { item: note })
}

const finishing = new Set<string>()

async function finish(chat: Chat, ws: Workspace, emit: Emit, failure?: string) {
  if (!chat.remote || finishing.has(chat.id)) return
  finishing.add(chat.id)
  try {
    if (failure) {
      const item: ChatItem = { id: randomUUID(), kind: 'error', text: failure, ts: Date.now() }
      store.upsertItem(chat.id, item)
      emit(chat.id, { item })
    } else await importPhoneTurns(chat, ws, emit)
  } finally {
    chat.remote = undefined
    finishing.delete(chat.id)
    store.save()
    emit(chat.id, { chat })
  }
}

/** Starts Remote Control for a chat. The link and QR code arrive on the chat once Claude Code prints them. */
export function continueOnPhone(chat: Chat, ws: Workspace, env: Record<string, string>, emit: Emit, onExit: (id: string, code: number) => void, onData: (id: string, d: string) => void) {
  if (chat.remote) return chat
  if (chat.model === 'codex') throw new Error('Continue on phone works with Claude chats, not Codex')
  if (ws.orchestrator) throw new Error("The orchestrator's tools only run inside Choo Choo, so it can't continue on your phone")
  if (agent.isRunning(chat.id)) throw new Error('Wait for the agent to finish, or stop it, first')
  if (chat.forkAt !== undefined) throw new Error('You reverted this chat. Send a message here first, then continue on your phone.')
  const args = phoneArgs(chat)
  // Remote Control needs your claude.ai sign-in; an API key would stop it from starting.
  const exe = claudeExecutable() ?? installedExecutable() ?? 'claude'
  const command = [exe, ...args].map(shellQuote).join(' ')
  const id = phoneTerminalId(chat)
  chat.remote = { kind: 'phone', startedAt: Date.now() }
  store.save()
  emit(chat.id, { chat })
  let seen = ''
  let found = false
  const setUrl = (url: string, listOnly: boolean) => {
    if (!chat.remote) return
    chat.remote.url = url
    chat.remote.listOnly = listOnly || undefined
    void QRCode.toString(url, { type: 'svg', margin: 1 })
      .then((svg) => {
        if (chat.remote?.url === url) chat.remote.qr = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
      })
      .catch(() => undefined)
      .finally(() => {
        store.save()
        emit(chat.id, { chat })
      })
  }
  // If the link never shows up in the output (the terminal UI may hide it behind a hyperlink or
  // redraw it), the session still appears in your claude.ai/code list under the chat's title.
  const fallback = setTimeout(() => {
    if (!found && pty.isAlive(id)) setUrl(SESSION_LIST_URL, true)
  }, 20000)
  pty.kill(id)
  pty.create(
    id,
    ws.path,
    { ...env, ANTHROPIC_API_KEY: '' },
    (i, d) => {
      onData(i, d)
      if (found) return
      seen = (seen + d).slice(-8000)
      const url = findSessionUrl(seen)
      if (!url) return
      found = true
      clearTimeout(fallback)
      setUrl(url, false)
    },
    (i, code) => {
      clearTimeout(fallback)
      onExit(i, code)
      // It quit before connecting: say why instead of silently closing the panel.
      const failure = chat.remote && !found && !chat.remote.url ? connectFailure(seen) : undefined
      void finish(chat, ws, emit, failure)
    },
    command,
    `\x1b[2m$ claude ${args.map(shellQuote).join(' ')}\x1b[0m\r\n`
  )
  return chat
}

/** Why Remote Control quit before it connected, from the end of its output. */
export function connectFailure(output: string): string {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-4)
  const tail = lines.join('\n')
  const hint = /log ?in|sign(ed)? in|api key|not available/i.test(tail)
    ? '\n\nRemote Control needs Claude Code signed in with your Claude account (Pro, Max, Team or Enterprise). Run `claude` in Terminal and type /login.'
    : ''
  return `Remote Control stopped before it connected.${tail ? `\n\n${tail}` : ''}${hint}`
}

/** Stops Remote Control and copies what happened on the phone into the chat. */
export async function bringBack(chat: Chat, ws: Workspace, emit: Emit) {
  if (!chat.remote) return chat
  const id = phoneTerminalId(chat)
  if (pty.isAlive(id)) pty.kill(id)
  await finish(chat, ws, emit)
  return chat
}

/** After a restart no Remote Control process is left, so pull in what happened and clear the flag. */
export async function recoverAfterRestart(findWs: (id: string) => Workspace | undefined, emit: Emit) {
  for (const chat of store.get().chats.filter((c) => c.remote)) {
    const ws = findWs(chat.workspaceId)
    if (ws) await finish(chat, ws, emit)
    else chat.remote = undefined
  }
  store.save()
}
