import { randomUUID } from 'node:crypto'
import type { Chat, SubscriptionLimits } from '@shared/types'
import {
  KEEP_GOING_PROMPT,
  MAX_RETRIES,
  RECHECK_MS,
  RESET_GRACE_MS,
  continueSettings,
  insertIndex,
  isWeekly,
  limitLabel,
  moveItem,
  pickToStart,
  shouldWait,
  type LimitKind,
  type QueueItem,
  type ResetLog
} from '@shared/continueWork'
import * as store from './store'

/**
 * Continue work: when a chat stops on a plan usage limit it joins Up next, and when the window resets
 * the queue starts in order, a few at a time, until the new window reaches the stop threshold.
 * Only resumes after the reset time the server gave and /usage confirms it (decision 0019).
 * See docs/prd/continue-work.md.
 */

export interface Deps {
  /** Starts a turn. Throws when the chat can't take one. */
  send(chat: Chat, text: string, images: string[]): void
  isRunning(chatId: string): boolean
  /** Claude's plan windows from /usage, or null when unknown (API key, or the call failed). */
  limits(force: boolean): Promise<SubscriptionLimits | null>
  /** The project (group) or repo id a chat's workspace belongs to, for project priority. */
  projectOf(chatId: string): string | undefined
  notify(title: string, body: string): void
  /** Hold off idle sleep while on. */
  keepAwake(on: boolean): void
  /** The queue started after a window reset. */
  onReset(): void
  /** Saves state and tells the window. */
  changed(): void
}

const TICK_MS = 30_000
const LOG_LIMIT = 20

let deps: Deps | null = null
let ticking = false
let again: Promise<void> | null = null
let rerun: (() => void) | null = null
/** Chats the queue started whose turn hasn't finished, so the cap counts them. */
const inFlight = new Set<string>()
/** Set when a reset was just confirmed: the next drain writes a log entry for it. */
let pendingReset: { at: number; lateMs?: number } | null = null

const queue = () => (store.get().continueQueue ??= [])
const settings = () => continueSettings(store.get().settings.continueWork)

export function init(d: Deps) {
  deps = d
  // Items for chats that no longer exist can't run.
  const ids = new Set(store.get().chats.map((c) => c.id))
  store.get().continueQueue = queue().filter((q) => ids.has(q.chatId))
  const t = setInterval(() => void tick(), TICK_MS)
  t.unref?.()
  setTimeout(() => void tick(), 5_000).unref?.()
}

export function isLimited(): boolean {
  return !!store.get().usageLimit
}

/** Called when the Mac wakes: the reset may have passed while it slept. */
export function onWake() {
  void tick()
}

function windowFor(l: SubscriptionLimits | null, kind: LimitKind) {
  if (!l) return undefined
  const key = kind === 'seven_day_opus' ? 'claude:model:Opus' : kind === 'seven_day_sonnet' ? 'claude:model:Sonnet' : isWeekly(kind) ? 'claude:seven_day' : 'claude:five_hour'
  return l.windows.find((w) => (key.startsWith('claude:model:') ? w.key.startsWith(key) : w.key === key))
}

/** A chat's turn ended. If it stopped on a limit, queue it; either way, a slot may have freed up. */
export function onTurnDone(chat: Chat) {
  inFlight.delete(chat.id)
  if (chat.paused) void onPaused(chat)
  else void tick()
}

async function onPaused(chat: Chat) {
  const p = chat.paused
  if (!p || !deps) return
  const now = Date.now()
  if (!p.resetsAt) {
    const w = windowFor(await deps.limits(true).catch(() => null), p.kind)
    if (w?.resetsAt && w.resetsAt > now) p.resetsAt = w.resetsAt
  }
  const st = store.get()
  const lim = st.usageLimit
  // Keep the latest reset we know of: a weekly stop outlasts a 5-hour one.
  if (!lim || (p.resetsAt && (!lim.until || p.resetsAt > lim.until))) st.usageLimit = { kind: p.kind, until: p.resetsAt ?? lim?.until, since: lim?.since ?? now }
  const s = settings()
  const already = queue().some((q) => q.chatId === chat.id)
  if (!already && shouldWait(p, s, now) && (p.retries ?? 0) <= MAX_RETRIES) {
    const item: QueueItem = { id: randomUUID(), chatId: chat.id, source: 'paused', addedAt: now }
    // A chat that was already resumed once and hit the limit again keeps its place at the front.
    const at = p.retries ? 0 : insertIndex(queue(), deps.projectOf, deps.projectOf(chat.id), s)
    queue().splice(at, 0, item)
  }
  deps.changed()
  void tick()
}

/** Adds work to Up next. */
export function add(chatId: string, prompt: string, opts: { top?: boolean; images?: string[] } = {}) {
  if (!deps) throw new Error('Not ready')
  const chat = store.get().chats.find((c) => c.id === chatId)
  if (!chat) throw new Error('Chat not found')
  const text = prompt.trim()
  // No prompt means "continue where it left off", with the continue prompt from Settings.
  // A paused chat gets the continue prompt from Settings when it starts; any other chat just keeps going.
  const paused = !text && !!chat.paused
  const item: QueueItem = { id: randomUUID(), chatId, source: paused ? 'paused' : 'queued', ...(paused ? {} : { prompt: text || KEEP_GOING_PROMPT }), ...(opts.images?.length ? { images: opts.images } : {}), addedAt: Date.now() }
  const at = opts.top ? 0 : insertIndex(queue(), deps.projectOf, deps.projectOf(chatId), settings())
  queue().splice(at, 0, item)
  deps.changed()
  void tick()
  return { item, position: at + 1 }
}

export function move(id: string, to: number) {
  store.get().continueQueue = moveItem(queue(), id, to)
  deps?.changed()
}

export function edit(id: string, prompt: string) {
  const q = queue().find((x) => x.id === id)
  if (!q) throw new Error('Not in Up next')
  if (prompt.trim()) q.prompt = prompt.trim()
  else if (q.source === 'queued') q.prompt = KEEP_GOING_PROMPT
  else delete q.prompt
  deps?.changed()
}

export function remove(id: string) {
  store.get().continueQueue = queue().filter((q) => q.id !== id)
  deps?.changed()
}

/** Removes every item for a chat, such as when the chat is deleted. */
export function forgetChat(chatId: string) {
  const before = queue().length
  store.get().continueQueue = queue().filter((q) => q.chatId !== chatId)
  inFlight.delete(chatId)
  if (queue().length !== before) deps?.changed()
}

/** Starts one item now, whatever the reset time and caps say. */
export function runNow(id: string) {
  const q = queue().find((x) => x.id === id)
  if (!q) throw new Error('Not in Up next')
  if (deps?.isRunning(q.chatId)) throw new Error('That chat is already working')
  start(q)
}

function start(q: QueueItem) {
  if (!deps) return
  const chat = store.get().chats.find((c) => c.id === q.chatId)
  store.get().continueQueue = queue().filter((x) => x.id !== q.id)
  if (!chat) return
  inFlight.add(chat.id)
  try {
    deps.send(chat, q.prompt ?? settings().prompt, q.images ?? [])
  } catch {
    inFlight.delete(chat.id)
  }
}

export async function tick(): Promise<void> {
  if (!deps) return
  // A tick asked for while one runs (a turn ended, an item was added) runs right after it.
  if (ticking) return (again ??= new Promise<void>((r) => (rerun = r)))
  ticking = true
  try {
    await step(Date.now())
  } finally {
    ticking = false
    const s = settings()
    deps?.keepAwake(s.keepAwake && isLimited() && queue().length > 0)
    if (again) {
      const done = rerun
      again = null
      void tick().then(() => done?.())
    }
  }
}

async function step(now: number) {
  const d = deps!
  const st = store.get()
  const s = settings()
  const lim = st.usageLimit
  if (lim) {
    const due = (lim.until ?? lim.since + RECHECK_MS) + RESET_GRACE_MS
    if (now < due) return
    const limits = await d.limits(true).catch(() => null)
    const w = windowFor(limits, lim.kind)
    if (w && w.percent >= 100) {
      // Still full: wait for the reset /usage reports, or check again shortly.
      lim.until = w.resetsAt && w.resetsAt > now ? w.resetsAt : now + RECHECK_MS - RESET_GRACE_MS
      d.changed()
      return
    }
    st.usageLimit = undefined
    pendingReset = { at: now, ...(lim.until && now - lim.until > 10 * 60_000 ? { lateMs: now - lim.until } : {}) }
    for (const c of st.chats) if (c.paused && !queue().some((q) => q.chatId === c.id)) c.paused = undefined
    d.changed()
  }
  const all = queue()
  // Drop items whose chat is gone.
  const ids = new Set(st.chats.map((c) => c.id))
  if (all.some((q) => !ids.has(q.chatId))) st.continueQueue = all.filter((q) => ids.has(q.chatId))
  if (!queue().length) {
    if (pendingReset) logReset(0, 0)
    return
  }
  const limits = await d.limits(!!pendingReset).catch(() => null)
  const percent = windowFor(limits, 'five_hour')?.percent
  for (const id of inFlight) if (!d.isRunning(id)) inFlight.delete(id)
  const picks = pickToStart(queue(), d.isRunning, inFlight.size, s, percent)
  for (const q of picks) start(q)
  if (pendingReset) {
    const held = percent !== undefined && percent >= s.stopAtPercent ? queue().length : 0
    logReset(picks.length, held)
    if (s.notify && picks.length) d.notify('Choo Choo', `Your usage window reset. Started ${picks.length === 1 ? '1 chat' : `${picks.length} chats`} from Up next.`)
    d.onReset()
  }
  if (picks.length) d.changed()
}

function logReset(started: number, held: number) {
  const st = store.get()
  const entry: ResetLog = { at: pendingReset!.at, started, held, ...(pendingReset!.lateMs ? { lateMs: pendingReset!.lateMs } : {}) }
  st.resetLog = [...(st.resetLog ?? []), entry].slice(-LOG_LIMIT)
  pendingReset = null
  deps?.changed()
}

/** The banner text for a paused chat, for notifications. */
export function pauseText(chat: Chat): string {
  const p = chat.paused
  if (!p) return ''
  const at = p.resetsAt ? new Date(p.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  return `Paused at your ${limitLabel(p.kind)}${at ? `. Resumes around ${at}.` : '.'}`
}

/** For tests. */
export function _reset() {
  inFlight.clear()
  pendingReset = null
  ticking = false
  again = null
  rerun = null
  deps = null
}
