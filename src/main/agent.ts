import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, Workspace } from '@shared/types'
import * as store from './store'

type Emit = (chatId: string, payload: { item?: ChatItem; chat?: Chat }) => void

interface Running {
  abort: AbortController
  query?: { interrupt(): Promise<unknown> }
}

const running = new Map<string, Running>()

// The SDK is ESM-only; load it lazily from the CJS main bundle.
let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

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
  const r = running.get(chatId)
  if (!r) return
  try {
    await r.query?.interrupt()
  } catch {
    r.abort.abort()
  }
}

export async function send(chat: Chat, ws: Workspace, text: string, env: Record<string, string>, emit: Emit) {
  if (running.has(chat.id)) throw new Error('Agent is already running in this chat')
  const now = Date.now()
  const userItem: ChatItem = { id: randomUUID(), kind: 'user', text, ts: now }
  store.upsertItem(chat.id, userItem)
  emit(chat.id, { item: userItem })

  if (chat.title === 'New chat') chat.title = text.slice(0, 40).replace(/\s+/g, ' ').trim() || 'New chat'
  chat.status = 'running'
  store.save()
  emit(chat.id, { chat })

  const abort = new AbortController()
  const r: Running = { abort }
  running.set(chat.id, r)

  // Streaming text for the current assistant message, keyed by content-block index.
  let streamItem: Extract<ChatItem, { kind: 'assistant' }> | null = null
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  const put = (item: ChatItem) => {
    store.upsertItem(chat.id, item)
    emit(chat.id, { item })
  }

  try {
    const { query } = await loadSdk()
    const q = query({
      prompt: text,
      options: {
        cwd: ws.path,
        model: chat.model,
        effort: chat.effort,
        resume: chat.sdkSessionId,
        // Conductor runs agents unattended inside an isolated worktree.
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        abortController: abort,
        settingSources: ['user', 'project', 'local'],
        env: { ...process.env, ...env }
      } as never
    })
    r.query = q

    for await (const msg of q as AsyncIterable<any>) {
      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init' && msg.session_id) {
            chat.sdkSessionId = msg.session_id
            store.save()
          }
          break
        case 'stream_event': {
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
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text) {
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
      text: aborted ? 'Stopped' : (e as Error).message || String(e),
      ts: Date.now()
    })
  } finally {
    if (streamItem) put({ ...streamItem, streaming: false })
    running.delete(chat.id)
    store.save()
    emit(chat.id, { chat })
  }
}
