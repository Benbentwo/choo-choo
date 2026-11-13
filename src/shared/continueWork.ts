/**
 * Continue work: chats that stop on a plan usage limit wait in one ordered queue ("Up next") and
 * resume when the usage window resets. Pure types and helpers; the scheduler is src/main/continueWork.ts.
 * See docs/prd/continue-work.md.
 */

/** Which plan window stopped a chat. Mirrors the SDK's rate_limit_info.rateLimitType, plus "unknown". */
export type LimitKind = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'seven_day_overage_included' | 'overage' | 'unknown'

/** Set on a chat whose last turn stopped on a usage limit. */
export interface ChatPause {
  kind: LimitKind
  /** When the window resets (ms). Missing until Choo Choo learns it from /usage. */
  resetsAt?: number
  at: number
  /** How many times in a row this chat hit the limit again right after resuming. */
  retries?: number
}

export interface QueueItem {
  id: string
  chatId: string
  /** paused: stopped on the limit and continues with the continue prompt. queued: new work Ben lined up. */
  source: 'paused' | 'queued'
  /** What to send. Missing on paused items means the continue prompt from Settings. */
  prompt?: string
  images?: string[]
  addedAt: number
}

/** The plan is out of usage until `until`. Cleared once /usage shows the window open again. */
export interface UsageLimitState {
  kind: LimitKind
  until?: number
  since: number
}

/** A window reset and what the queue did with it. */
export interface ResetLog {
  at: number
  started: number
  /** Items left waiting because the new window passed the stop threshold. */
  held: number
  /** The Mac was asleep or the app closed at reset time; started this long after. */
  lateMs?: number
}

export interface ContinueSettings {
  /** Resume paused chats when the limit resets. */
  enabled: boolean
  /** Items running at once after a reset. */
  maxConcurrent: number
  /** Stop starting new items once the 5-hour window is this full (percent). */
  stopAtPercent: number
  /** Sent to a paused chat when it resumes. */
  prompt: string
  /** Where a newly paused chat lands: by project priority then time, or just by time. */
  order: 'project' | 'time'
  /** Also wait for weekly limits, when the reset is less than a day away. */
  weekly: boolean
  /** Hold off idle sleep while work waits for a reset. */
  keepAwake: boolean
  /** Notify when the queue starts after a reset. */
  notify: boolean
  /** Repo or project-group ids, highest priority first. */
  projectOrder: string[]
}

export const DEFAULT_CONTINUE_PROMPT = 'Your last turn stopped at the usage limit. Check the working tree, then pick up where you left off.'

export const DEFAULT_CONTINUE: ContinueSettings = {
  enabled: true,
  maxConcurrent: 2,
  stopAtPercent: 60,
  prompt: DEFAULT_CONTINUE_PROMPT,
  order: 'project',
  weekly: true,
  keepAwake: false,
  notify: true,
  projectOrder: []
}

export function continueSettings(s: Partial<ContinueSettings> | undefined): ContinueSettings {
  const c = { ...DEFAULT_CONTINUE, ...(s ?? {}) }
  return {
    ...c,
    maxConcurrent: Math.max(1, Math.min(5, Math.round(Number(c.maxConcurrent)) || DEFAULT_CONTINUE.maxConcurrent)),
    stopAtPercent: Math.max(20, Math.min(100, Math.round(Number(c.stopAtPercent)) || DEFAULT_CONTINUE.stopAtPercent)),
    prompt: c.prompt?.trim() ? c.prompt : DEFAULT_CONTINUE_PROMPT,
    order: c.order === 'time' ? 'time' : 'project',
    projectOrder: Array.isArray(c.projectOrder) ? c.projectOrder.filter((x) => typeof x === 'string') : []
  }
}

/** Wait this long after the reset time before checking, so the server has rolled the window over. */
export const RESET_GRACE_MS = 60_000
/** When /usage still reads full after the reset time, check again this much later. */
export const RECHECK_MS = 5 * 60_000
/** A chat that hits the limit again right after resuming is re-queued at most this many times. */
export const MAX_RETRIES = 2
const DAY = 24 * 3600_000

/** The SDK sends seconds since the epoch; accept milliseconds too. */
export function toMs(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n < 1e12 ? n * 1000 : n
}

const KINDS: LimitKind[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_overage_included', 'overage']
const kindOf = (v: unknown): LimitKind => (KINDS.includes(v as LimitKind) ? (v as LimitKind) : 'unknown')

/** A `rate_limit_event` that means the turn was refused, as a pause. Null for warnings and allowed. */
export function limitFromEvent(msg: { rate_limit_info?: { status?: string; resetsAt?: unknown; rateLimitType?: unknown; isUsingOverage?: boolean } }, now: number): ChatPause | null {
  const info = msg?.rate_limit_info
  if (!info || info.status !== 'rejected' || info.isUsingOverage) return null
  return { kind: kindOf(info.rateLimitType), resetsAt: toMs(info.resetsAt), at: now }
}

/**
 * Messages Claude Code shows when a plan limit was genuinely reached (the SDK's USAGE_LIMIT_ERROR_PREFIXES,
 * the ones a window reset clears). Spend-limit and seat messages are left out: waiting doesn't fix those.
 */
const LIMIT_TEXT = /^(?:API Error: )?(?:You've hit your|You've reached your) (session|weekly|Opus|Sonnet|usage)? ?limit/i

/** A pause from the limit message text, when no rate_limit_event said so. */
export function limitFromText(text: string | undefined, now: number): ChatPause | null {
  const t = (text ?? '').trim()
  const m = t.match(LIMIT_TEXT)
  if (!m) return null
  const word = (m[1] ?? '').toLowerCase()
  const kind: LimitKind = word === 'session' ? 'five_hour' : word === 'weekly' ? 'seven_day' : word === 'opus' ? 'seven_day_opus' : word === 'sonnet' ? 'seven_day_sonnet' : 'unknown'
  return { kind, at: now }
}

export const isWeekly = (k: LimitKind) => k.startsWith('seven_day')

/** Whether to wait for this limit: the 5-hour window always; weekly ones only when on and under a day away. */
export function shouldWait(p: ChatPause, s: Pick<ContinueSettings, 'enabled' | 'weekly'>, now: number): boolean {
  if (!s.enabled || p.kind === 'overage') return false
  if (!isWeekly(p.kind)) return true
  return s.weekly && !!p.resetsAt && p.resetsAt - now < DAY
}

export function limitLabel(k: LimitKind): string {
  switch (k) {
    case 'five_hour':
      return '5-hour limit'
    case 'seven_day':
    case 'seven_day_overage_included':
      return 'weekly limit'
    case 'seven_day_opus':
      return 'Opus weekly limit'
    case 'seven_day_sonnet':
      return 'Sonnet weekly limit'
    case 'overage':
      return 'extra usage limit'
    default:
      return 'usage limit'
  }
}

/**
 * Where a new item goes. Queued work and "project" order put it after the last item of the same or a
 * higher-priority project; "time" order (and projects not in the list) put it at the end.
 */
export function insertIndex(queue: QueueItem[], projectOf: (chatId: string) => string | undefined, project: string | undefined, s: Pick<ContinueSettings, 'order' | 'projectOrder'>): number {
  if (s.order !== 'project' || !project) return queue.length
  const rank = (p: string | undefined) => {
    const i = p ? s.projectOrder.indexOf(p) : -1
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const mine = rank(project)
  if (mine === Number.MAX_SAFE_INTEGER) return queue.length
  let at = 0
  for (let i = 0; i < queue.length; i++) if (rank(projectOf(queue[i].chatId)) <= mine) at = i + 1
  return at
}

/** Moves an item to a new index, clamped. */
export function moveItem(queue: QueueItem[], id: string, to: number): QueueItem[] {
  const from = queue.findIndex((q) => q.id === id)
  if (from < 0) return queue
  const next = queue.slice()
  const [it] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it)
  return next
}

/**
 * Which items to start now while the queue drains: the first ones not already running, up to the
 * free slots, and none once the new window is at the stop threshold.
 */
export function pickToStart(queue: QueueItem[], isRunning: (chatId: string) => boolean, inFlight: number, s: Pick<ContinueSettings, 'maxConcurrent' | 'stopAtPercent'>, percent: number | undefined): QueueItem[] {
  if (percent !== undefined && percent >= s.stopAtPercent) return []
  const free = s.maxConcurrent - inFlight
  if (free <= 0) return []
  const out: QueueItem[] = []
  const chats = new Set<string>()
  for (const q of queue) {
    if (out.length >= free) break
    // One turn per chat at a time; a second queued item for the same chat waits for the first.
    if (isRunning(q.chatId) || chats.has(q.chatId)) continue
    chats.add(q.chatId)
    out.push(q)
  }
  return out
}

/** "in 1h 23m", "in 4m", "now". */
export function untilText(at: number | undefined, now: number): string {
  if (!at) return ''
  const ms = at - now
  if (ms <= 60_000) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  return `in ${Math.round(h / 24)}d`
}
