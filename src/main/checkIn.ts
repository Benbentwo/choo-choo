import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, Workspace } from '@shared/types'
import { CHECK_IN_QUESTION, statusBlock, turnStart } from '@shared/liveStatus'
import * as store from './store'
import { claudeExecutable } from './claudeBinary'
import { redactSecrets, renderTurn } from './extras'
import { isRunning, liveCompacting, liveTasks } from './agent'

type Emit = (chatId: string, payload: { item?: ChatItem }) => void

const SYSTEM = [
  "You answer a quick check-in about a coding agent's session while the agent keeps working. You cannot act, run anything, or message the agent.",
  "Use the status block and the transcript to answer the person's question in plain words, in one to four short sentences:",
  'what the agent is doing right now, what it is waiting on (name the run, PR, check or command), for how long, and what it plans to do next if the transcript says.',
  'If it looks stuck (the same command failing again and again, a loop that can never finish, no progress for a long time), say so plainly and say what would unstick it.',
  'Only state what the transcript shows. Do not use headings. Do not greet.'
].join(' ')

/** The context the check-in model reads: the conversation before this turn, briefly, then the turn itself. */
export function checkInContext(items: ChatItem[], maxChars = 40000): string {
  const since = turnStart(items)
  const at = since === undefined ? -1 : items.findIndex((x) => x.ts >= since && x.kind === 'user' && !x.sentWhileRunning)
  const before = (at < 0 ? items : items.slice(0, at))
    .filter((x) => (x.kind === 'user' && !x.fromAdvisor) || (x.kind === 'assistant' && !x.streaming))
    .slice(-6)
  const earlier = before.map((x) => (x.kind === 'user' ? `USER: ${x.text.slice(0, 800)}` : x.kind === 'assistant' ? `AGENT: ${x.text.slice(0, 800)}` : '')).join('\n')
  // A check-in's own question and answer aren't part of the agent's work.
  const turn = (at < 0 ? [] : items.slice(at)).filter((x) => x.kind !== 'checkin')
  const text = [earlier && `<earlier>\n${earlier}\n</earlier>`, `<current_turn>\n${renderTurn(turn, maxChars)}\n</current_turn>`].filter(Boolean).join('\n\n')
  return redactSecrets(text)
}

/** Check-ins being answered, per chat, so a second click doesn't start a second one. */
const answering = new Set<string>()

/**
 * Answers "what are you working on / waiting on?" from a fresh, tool-less query over the transcript.
 * The running turn is never touched: the question goes nowhere near it unless the person forwards it.
 */
export async function checkIn(chat: Chat, ws: Workspace, question: string | undefined, env: Record<string, string>, emit: Emit) {
  const q = question?.trim() || CHECK_IN_QUESTION
  if (answering.has(chat.id)) return
  answering.add(chat.id)
  const all = store.chatItems(chat.id)
  const running = isRunning(chat.id)
  const item: Extract<ChatItem, { kind: 'checkin' }> = { id: randomUUID(), kind: 'checkin', question: q, text: '', pending: true, ts: Date.now() }
  const put = () => {
    store.upsertItem(chat.id, { ...item })
    emit(chat.id, { item: { ...item } })
  }
  put()
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const prompt = `<status>\n${statusBlock(all, liveTasks(chat.id), running, Date.now(), liveCompacting(chat.id))}\n</status>\n\n${checkInContext(all)}\n\nThe person asks: ${q}`
    const res = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable(),
        cwd: ws.path,
        model: 'sonnet',
        systemPrompt: SYSTEM,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        env: { ...process.env, ...env }
      } as never
    })
    for await (const m of res as AsyncIterable<any>) {
      if (m.type !== 'assistant') continue
      for (const b of m.message?.content ?? []) if (b.type === 'text') item.text += b.text
      put()
    }
    item.text = item.text.trim() || "Couldn't tell from the chat so far."
  } catch (e) {
    item.failed = true
    item.text = `Check-in failed: ${(e as Error).message || String(e)}`
  } finally {
    item.pending = false
    put()
    store.save()
    answering.delete(chat.id)
  }
}

/** Marks a check-in as also sent to the agent. Returns its question. */
export function markForwarded(chatId: string, itemId: string): string {
  const item = store.chatItems(chatId).find((x) => x.id === itemId)
  if (!item || item.kind !== 'checkin') throw new Error('Check-in not found')
  if (item.forwarded) throw new Error('Already sent to Claude')
  item.forwarded = true
  store.upsertItem(chatId, item)
  store.save()
  return item.question
}
