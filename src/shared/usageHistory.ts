/**
 * Usage history: plan window readings kept over time, plus a small summary of every Claude Code
 * response (time, session, folder, model, token counts; never the text). The main process stores
 * them (src/main/usageHistory.ts); this file turns them into what the Usage page draws.
 *
 * Claude only reports a window's total, never how much one message used. Shares by workspace are
 * estimates: each rise between two readings is split across the responses in between by their
 * API-equivalent cost, which weights tokens by model price.
 */

/** One Claude Code response, as stored. Short keys keep a year of these small. */
export interface UsageMsg {
  /** Time of the response. */
  t: number
  /** Message id from the API; a response is written as several transcript lines. */
  id: string
  /** Claude Code session id. */
  s: string
  /** Working folder of the session. */
  cwd?: string
  /** Model id. */
  m: string
  /** Input, cache write, cache read and output tokens. */
  i: number
  cw: number
  cr: number
  o: number
  /** From a subagent. */
  sub?: 1
}

/** One plan window reading, as stored. */
export interface UsageReading {
  t: number
  /** Window key, e.g. claude:five_hour. */
  k: string
  /** Percent used. */
  p: number
  /** When the window resets. */
  r?: number
  /** Window length. */
  w?: number
}

export interface UsageHistorySettings {
  /** Save readings and response summaries. Default on. */
  enabled: boolean
  /** Months to keep. Default 12. */
  keepMonths: number
}

export const DEFAULT_USAGE_HISTORY: UsageHistorySettings = { enabled: true, keepMonths: 12 }

export function usageHistorySettings(s?: Partial<UsageHistorySettings>): UsageHistorySettings {
  return { ...DEFAULT_USAGE_HISTORY, ...(s ?? {}) }
}

// ---- Prices (API list prices, $ per million tokens). Used only to weight models against each other.

type Price = { in: number; out: number; cr?: number }
const PRICES: [RegExp, Price][] = [
  [/fable-5-2|mythos-5-2/, { in: 8, out: 40, cr: 0.2 }],
  [/fable|mythos/, { in: 10, out: 50 }],
  [/opus-5-5/, { in: 4, out: 20, cr: 0.2 }],
  [/opus-(5|4-[5-9])/, { in: 5, out: 25 }],
  [/opus/, { in: 15, out: 75 }],
  [/sonnet-5-5/, { in: 2, out: 10, cr: 0.1 }],
  [/sonnet-5/, { in: 2, out: 10 }],
  [/sonnet/, { in: 3, out: 15 }],
  [/haiku-5-5/, { in: 0.1, out: 0.5 }],
  [/haiku-3/, { in: 0.8, out: 4 }],
  [/haiku/, { in: 1, out: 5 }]
]

export function priceOf(model: string): Price {
  const m = model.toLowerCase()
  for (const [re, p] of PRICES) if (re.test(m)) return p
  return { in: 3, out: 15 }
}

/** What a response would cost on the API, in dollars. Cache writes at 1.25x input, reads at 0.1x unless listed. */
export function msgCost(x: Pick<UsageMsg, 'm' | 'i' | 'cw' | 'cr' | 'o'>): number {
  const p = priceOf(x.m)
  return (x.i * p.in + x.cw * p.in * 1.25 + x.cr * (p.cr ?? p.in * 0.1) + x.o * p.out) / 1e6
}

export type ModelFamily = 'Opus' | 'Sonnet' | 'Haiku' | 'Fable' | 'Other'
export const FAMILIES: ModelFamily[] = ['Opus', 'Sonnet', 'Haiku', 'Fable', 'Other']
export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('haiku')) return 'Haiku'
  if (m.includes('fable') || m.includes('mythos')) return 'Fable'
  return 'Other'
}

/** Responses can be stored more than once (a transcript line per content block, or a re-read file). Keeps one per id. */
export function dedupeMsgs(list: UsageMsg[]): UsageMsg[] {
  const by = new Map<string, UsageMsg>()
  for (const m of list) {
    const prev = by.get(m.id)
    if (!prev) by.set(m.id, { ...m })
    else {
      prev.o = Math.max(prev.o, m.o)
      prev.i = Math.max(prev.i, m.i)
      prev.cw = Math.max(prev.cw, m.cw)
      prev.cr = Math.max(prev.cr, m.cr)
    }
  }
  return [...by.values()].sort((a, b) => a.t - b.t)
}

// ---- Windows

const HOUR = 3600_000
export function windowLabel(key: string): string {
  if (key === 'claude:five_hour') return '5-hour'
  if (key === 'claude:seven_day') return 'Weekly'
  if (key.startsWith('claude:model:')) return `${key.slice(13)} weekly`
  const codex = key.match(/^codex:(\d+)$/)
  if (codex) {
    const mins = Number(codex[1])
    return mins <= 360 ? `Codex ${Math.round(mins / 60)}-hour` : mins >= 10_000 && mins <= 10_200 ? 'Codex weekly' : `Codex ${Math.round(mins / 1440)}-day`
  }
  return key
}

export const providerOf = (key: string): 'claude' | 'codex' => (key.startsWith('codex:') ? 'codex' : 'claude')

export interface UsageHit {
  /** When the window was first seen full. */
  t: number
  key: string
  label: string
  /** Window start and reset. */
  start?: number
  resetsAt?: number
  /** How long until it reset. */
  waitedMs?: number
}

/** The first full reading of each window period. A period is told apart by its reset time. */
export function findHits(readings: UsageReading[]): UsageHit[] {
  const out: UsageHit[] = []
  const seen = new Set<string>()
  for (const x of [...readings].sort((a, b) => a.t - b.t)) {
    if (x.p < 99.5) continue
    const period = `${x.k}@${x.r ? Math.round(x.r / 60_000) : Math.floor(x.t / (5 * HOUR))}`
    if (seen.has(period)) continue
    seen.add(period)
    out.push({
      t: x.t,
      key: x.k,
      label: windowLabel(x.k),
      ...(x.r ? { resetsAt: x.r, waitedMs: Math.max(0, x.r - x.t) } : {}),
      ...(x.r && x.w ? { start: x.r - x.w } : {})
    })
  }
  return out
}

// ---- Where usage went

export interface UsageGroup {
  id: string
  label: string
  kind: 'repo' | 'project' | 'outside' | 'elsewhere' | 'other'
}

/** Maps a response to the workspace, repo or project it came from, and to a chat title. Built in main from app state. */
export interface Attributor {
  group(m: UsageMsg): UsageGroup
  chat(sessionId: string, cwd?: string): { title: string; workspace?: string }
}

/** Usage that a reading counted but no response on this Mac explains: claude.ai, another computer, the phone. */
export const ELSEWHERE: UsageGroup = { id: 'elsewhere', label: 'Not on this Mac (claude.ai, other devices)', kind: 'elsewhere' }

export interface UsageDashboard {
  from: number
  to: number
  /** Window readings in range, by key, oldest first. */
  windows: { key: string; label: string; provider: 'claude' | 'codex'; points: { t: number; p: number }[]; resets: number[] }[]
  hits: UsageHit[]
  /** Share of API-equivalent cost by group, biggest first, the tail folded into Other. */
  groups: (UsageGroup & { cost: number; share: number })[]
  /** Cost per bucket per model family. */
  buckets: { start: number; end: number; costs: Partial<Record<ModelFamily, number>> }[]
  bucket: 'hour' | 'day' | 'week'
  /** Cost by weekday (Monday first) and hour, local time. */
  heat: number[][]
  totalCost: number
  responses: number
  sessions: number
  /** Time spent at a limit within the range. */
  limitMs: number
  /** Earliest stored reading and response, to say how far back history goes. */
  firstReading?: number
  firstResponse?: number
}

function startOfDay(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function addDays(t: number, n: number) {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Thins a line to at most `max` points, keeping each bucket's highest reading so peaks and hits survive. */
export function thin(points: { t: number; p: number }[], max = 1200): { t: number; p: number }[] {
  if (points.length <= max) return points
  const span = points[points.length - 1].t - points[0].t || 1
  const size = span / max
  const out: { t: number; p: number }[] = []
  let cur: { t: number; p: number } | null = null
  let bucket = -1
  for (const x of points) {
    const b = Math.floor((x.t - points[0].t) / size)
    if (b !== bucket) {
      if (cur) out.push(cur)
      cur = x
      bucket = b
    } else if (cur && x.p >= cur.p) cur = x
  }
  if (cur) out.push(cur)
  return out
}

export function buildDashboard(o: {
  readings: UsageReading[]
  msgs: UsageMsg[]
  from: number
  to: number
  attribute: Attributor
  firstReading?: number
  firstResponse?: number
  maxGroups?: number
}): UsageDashboard {
  const { from, to } = o
  const readings = o.readings.filter((x) => x.t >= from && x.t <= to).sort((a, b) => a.t - b.t)
  const byKey = new Map<string, UsageReading[]>()
  for (const x of readings) (byKey.get(x.k) ?? byKey.set(x.k, []).get(x.k)!).push(x)
  const order = (k: string) => (k === 'claude:five_hour' ? 0 : k === 'claude:seven_day' ? 1 : k.startsWith('claude:') ? 2 : 3)
  const windows = [...byKey.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, xs]) => ({
      key,
      label: windowLabel(key),
      provider: providerOf(key),
      points: thin(xs.map((x) => ({ t: x.t, p: x.p }))),
      resets: [...new Set(xs.map((x) => x.r).filter((r): r is number => !!r && r >= from && r <= to))].sort((a, b) => a - b)
    }))
  const hits = findHits(o.readings).filter((h) => h.t >= from && h.t <= to)
  const limitMs = hits.reduce((a, h) => a + Math.min(h.waitedMs ?? 0, Math.max(0, to - h.t)), 0)

  const msgs = o.msgs.filter((m) => m.t >= from && m.t <= to)
  const groupCost = new Map<string, UsageGroup & { cost: number }>()
  const span = to - from
  const bucket: UsageDashboard['bucket'] = span <= 2 * 24 * HOUR ? 'hour' : span <= 60 * 24 * HOUR ? 'day' : 'week'
  const bucketStart = (t: number) => {
    if (bucket === 'hour') return Math.floor(t / HOUR) * HOUR
    const day = startOfDay(t)
    if (bucket === 'day') return day
    const dow = (new Date(day).getDay() + 6) % 7
    return addDays(day, -dow)
  }
  const bucketEnd = (s: number) => (bucket === 'hour' ? s + HOUR : addDays(s, bucket === 'day' ? 1 : 7))
  const buckets = new Map<number, Partial<Record<ModelFamily, number>>>()
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const sessions = new Set<string>()
  let total = 0
  for (const m of msgs) {
    const c = msgCost(m)
    total += c
    sessions.add(m.s)
    const g = o.attribute.group(m)
    const cur = groupCost.get(g.id) ?? { ...g, cost: 0 }
    cur.cost += c
    groupCost.set(g.id, cur)
    const b = bucketStart(m.t)
    const row = buckets.get(b) ?? {}
    const fam = modelFamily(m.m)
    row[fam] = (row[fam] ?? 0) + c
    buckets.set(b, row)
    const d = new Date(m.t)
    heat[(d.getDay() + 6) % 7][d.getHours()] += c
  }
  // Every bucket in range, empty ones too, so gaps show as gaps.
  const allBuckets: UsageDashboard['buckets'] = []
  for (let s = bucketStart(from); s <= to; s = bucketEnd(s)) allBuckets.push({ start: s, end: bucketEnd(s), costs: buckets.get(s) ?? {} })

  const sorted = [...groupCost.values()].sort((a, b) => b.cost - a.cost)
  const max = o.maxGroups ?? 6
  const top = sorted.slice(0, max)
  const rest = sorted.slice(max)
  const groups = top.map((g) => ({ ...g, share: total ? g.cost / total : 0 }))
  if (rest.length) {
    const cost = rest.reduce((a, g) => a + g.cost, 0)
    groups.push({ id: 'other', label: `Other (${rest.length})`, kind: 'other', cost, share: total ? cost / total : 0 })
  }
  return {
    from,
    to,
    windows,
    hits,
    groups,
    buckets: allBuckets,
    bucket,
    heat,
    totalCost: total,
    responses: msgs.length,
    sessions: sessions.size,
    limitMs,
    firstReading: o.firstReading,
    firstResponse: o.firstResponse
  }
}

// ---- One window: what filled it

export interface WindowDetail {
  key: string
  label: string
  start: number
  end: number
  /** Readings in the window. */
  points: { t: number; p: number }[]
  hit?: UsageHit
  /** Groups, biggest share first. `series` holds each group's running share at each `times` entry. */
  groups: (UsageGroup & { share: number })[]
  times: number[]
  series: Record<string, number[]>
  /** Chats by estimated share of the window. */
  chats: { session: string; title: string; workspace?: string; group: string; share: number; cost: number; responses: number }[]
  cost: number
  models: Partial<Record<ModelFamily, number>>
  responses: number
}

/**
 * Splits each rise between two readings across the responses since the previous rise, by cost. A
 * rise with no response on this Mac behind it goes to "Not on this Mac". The window starts at 0%.
 */
export function windowDetail(o: { key: string; start: number; end: number; readings: UsageReading[]; msgs: UsageMsg[]; attribute: Attributor }): WindowDetail {
  const { key, start, end } = o
  const pts = o.readings.filter((x) => x.k === key && x.t >= start && x.t <= end).sort((a, b) => a.t - b.t)
  const msgs = o.msgs.filter((m) => m.t >= start && m.t <= end).sort((a, b) => a.t - b.t)
  const shares = new Map<string, UsageGroup & { share: number }>()
  const chatShare = new Map<string, { share: number; cost: number; responses: number; group: string; cwd?: string }>()
  const times: number[] = [start]
  const snapshots: Map<string, number>[] = [new Map()]
  let prev = { t: start, p: 0 }
  let mi = 0
  // Responses since the last rise. The reading can lag the responses behind it by a few minutes,
  // so responses carry over until a reading goes up.
  let inside: UsageMsg[] = []
  for (const x of pts) {
    const rise = Math.max(0, x.p - prev.p)
    while (mi < msgs.length && msgs[mi].t <= x.t) inside.push(msgs[mi++])
    if (rise > 0) {
      const costs = inside.map((m) => msgCost(m))
      const sum = costs.reduce((a, b) => a + b, 0)
      if (!sum) {
        const g = shares.get(ELSEWHERE.id) ?? { ...ELSEWHERE, share: 0 }
        g.share += rise
        shares.set(g.id, g)
      } else
        inside.forEach((m, j) => {
          const part = (rise * costs[j]) / sum
          const grp = o.attribute.group(m)
          const g = shares.get(grp.id) ?? { ...grp, share: 0 }
          g.share += part
          shares.set(g.id, g)
          const c = chatShare.get(m.s) ?? { share: 0, cost: 0, responses: 0, group: grp.label, cwd: m.cwd }
          c.share += part
          chatShare.set(m.s, c)
        })
      inside = []
    }
    times.push(x.t)
    snapshots.push(new Map([...shares.values()].map((g) => [g.id, g.share])))
    prev = { t: x.t, p: x.p }
  }
  // Cost, responses and models count every response in the window, read or not.
  const models: Partial<Record<ModelFamily, number>> = {}
  let cost = 0
  for (const m of msgs) {
    const c = msgCost(m)
    cost += c
    const f = modelFamily(m.m)
    models[f] = (models[f] ?? 0) + c
    const cs = chatShare.get(m.s) ?? { share: 0, cost: 0, responses: 0, group: o.attribute.group(m).label, cwd: m.cwd }
    cs.cost += c
    cs.responses++
    chatShare.set(m.s, cs)
  }
  const groups = [...shares.values()].sort((a, b) => b.share - a.share)
  const series: Record<string, number[]> = {}
  for (const g of groups) series[g.id] = snapshots.map((s) => s.get(g.id) ?? 0)
  const hit = findHits(pts)[0]
  const chats = [...chatShare.entries()]
    .map(([session, c]) => ({ session, ...o.attribute.chat(session, c.cwd), group: c.group, share: c.share, cost: c.cost, responses: c.responses }))
    .sort((a, b) => b.share - a.share || b.cost - a.cost)
  return { key, label: windowLabel(key), start, end, points: pts.map((x) => ({ t: x.t, p: x.p })), hit, groups, times, series, chats, cost, models, responses: msgs.length }
}

/** CSV of responses: one row each. */
export function usageCsv(msgs: UsageMsg[], attribute: Attributor): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = ['time,group,chat,model,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,api_equivalent_usd,subagent']
  for (const m of msgs) {
    const g = attribute.group(m)
    rows.push([new Date(m.t).toISOString(), esc(g.label), esc(attribute.chat(m.s, m.cwd).title), esc(m.m), m.i, m.cw, m.cr, m.o, msgCost(m).toFixed(4), m.sub ? 'yes' : ''].join(','))
  }
  return rows.join('\n') + '\n'
}
