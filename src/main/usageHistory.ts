import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AppState } from '@shared/types'
import { dedupeMsgs, type Attributor, type UsageGroup, type UsageMsg, type UsageReading } from '@shared/usageHistory'

/**
 * Stores usage history under <data>/usage:
 * - readings-YYYY-MM.jsonl: plan window readings (from /usage and Codex logs), written when they change.
 * - messages-YYYY-MM.jsonl: one line per Claude Code response (time, session, folder, model, tokens).
 *   Copied from Claude Code's transcripts, which it deletes after 30 days by default.
 * - sync.json: how far each transcript has been read.
 * Nothing here leaves the machine.
 */

let dir: string | null = null
let enabled = true
let keepMonths = 12

const month = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function initUsageHistory(dataDir: string, opts: { enabled: boolean; keepMonths: number }) {
  dir = join(dataDir, 'usage')
  mkdirSync(dir, { recursive: true })
  configureUsageHistory(opts)
  loadLast()
  prune()
}

export function configureUsageHistory(opts: { enabled: boolean; keepMonths: number }) {
  enabled = opts.enabled
  keepMonths = Math.max(1, Math.round(opts.keepMonths || 12))
}

/** Deletes month files older than the keep period. */
function prune(now = Date.now()) {
  if (!dir) return
  const d = new Date(now)
  d.setMonth(d.getMonth() - keepMonths)
  const oldest = month(d.getTime())
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(?:readings|messages)-(\d{4}-\d{2})\.jsonl$/)
    if (m && m[1] < oldest) {
      try {
        unlinkSync(join(dir, f))
      } catch {
        /* best effort */
      }
    }
  }
}

// ---- Readings

const last = new Map<string, UsageReading>()
function loadLast() {
  last.clear()
  for (const r of readFiles<UsageReading>('readings', Date.now() - 62 * 24 * 3600_000, Date.now())) {
    const prev = last.get(r.k)
    if (!prev || r.t >= prev.t) last.set(r.k, r)
  }
}

/**
 * Saves a reading when it moved, the window reset, or 15 minutes passed. Older or same-time
 * readings are skipped, so Codex logs read again on every refresh add nothing.
 */
export function recordReading(k: string, t: number, p: number, r?: number, w?: number) {
  if (!dir || !enabled || !Number.isFinite(p)) return
  const prev = last.get(k)
  if (prev && t <= prev.t) return
  const sameReset = !r || !prev?.r || Math.abs(prev.r - r) < 120_000
  if (prev && Math.abs(prev.p - p) < 0.5 && sameReset && t - prev.t < 15 * 60_000) return
  const x: UsageReading = {
    t,
    k,
    p: Math.round(p * 10) / 10,
    ...(r ? { r } : {}),
    ...(w ? { w } : {})
  }
  last.set(k, x)
  try {
    appendFileSync(join(dir, `readings-${month(t)}.jsonl`), JSON.stringify(x) + '\n')
  } catch {
    /* best effort */
  }
}

// ---- Reading the store

const parsed = new Map<string, { key: string; rows: unknown[] }>()
function readFiles<T>(kind: 'readings' | 'messages', from: number, to: number): T[] {
  if (!dir || !existsSync(dir)) return []
  const lo = month(from)
  const hi = month(to)
  const out: T[] = []
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(new RegExp(`^${kind}-(\\d{4}-\\d{2})\\.jsonl$`))
    if (!m || m[1] < lo || m[1] > hi) continue
    const path = join(dir, f)
    // One handle: the cache key and the contents come from the same open file.
    const fd = openSync(path, 'r')
    try {
      const st = fstatSync(fd)
      const key = `${st.size}:${st.mtimeMs}`
      let hit = parsed.get(path)
      if (hit?.key !== key) {
        const rows: unknown[] = []
        for (const line of readFileSync(fd, 'utf8').split('\n')) {
          if (!line) continue
          try {
            rows.push(JSON.parse(line))
          } catch {
            /* a line cut by a crash */
          }
        }
        hit = { key, rows }
        parsed.set(path, hit)
      }
      out.push(...(hit.rows as T[]))
    } finally {
      closeSync(fd)
    }
  }
  return out
}

export function readings(from: number, to: number): UsageReading[] {
  return readFiles<UsageReading>('readings', from, to).filter((x) => x.t >= from && x.t <= to)
}

export function messages(from: number, to: number): UsageMsg[] {
  return dedupeMsgs(readFiles<UsageMsg>('messages', from, to).filter((x) => x.t >= from && x.t <= to))
}

/** The earliest stored reading and response. */
export function historyStart(): {
  firstReading?: number
  firstResponse?: number
} {
  if (!dir || !existsSync(dir)) return {}
  const first = (kind: string) => {
    const f = readdirSync(dir!)
      .filter((x) => x.startsWith(`${kind}-`))
      .sort()[0]
    if (!f) return undefined
    const line = readFileSync(join(dir!, f), 'utf8').split('\n').find(Boolean)
    try {
      return line ? (JSON.parse(line).t as number) : undefined
    } catch {
      return undefined
    }
  }
  return { firstReading: first('readings'), firstResponse: first('messages') }
}

// ---- Transcripts → response summaries

/** Parses complete transcript lines into response summaries, merging the lines of one response. */
export function parseTranscriptChunk(text: string, fallbackSession: string, subagent: boolean): UsageMsg[] {
  const by = new Map<string, UsageMsg>()
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.type !== 'assistant' || !e.message?.usage) continue
    const model = String(e.message.model ?? '')
    if (!model || model === '<synthetic>') continue
    const t = Date.parse(e.timestamp)
    if (!Number.isFinite(t)) continue
    const u = e.message.usage
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    const id = String(e.message.id ?? e.uuid ?? `${fallbackSession}:${t}`)
    const x: UsageMsg = {
      t,
      id,
      s: String(e.sessionId ?? fallbackSession),
      ...(typeof e.cwd === 'string' ? { cwd: e.cwd } : {}),
      m: model,
      i: n(u.input_tokens),
      cw: n(u.cache_creation_input_tokens),
      cr: n(u.cache_read_input_tokens),
      o: n(u.output_tokens),
      ...(subagent || e.isSidechain ? { sub: 1 as const } : {})
    }
    const prev = by.get(id)
    if (prev) prev.o = Math.max(prev.o, x.o)
    else by.set(id, x)
  }
  return [...by.values()]
}

type SyncState = Record<string, number>
function loadSync(): SyncState {
  try {
    return JSON.parse(readFileSync(join(dir!, 'sync.json'), 'utf8'))
  } catch {
    return {}
  }
}

function transcriptFiles(root: string): { path: string; session: string; sub: boolean }[] {
  const out: { path: string; session: string; sub: boolean }[] = []
  if (!existsSync(root)) return out
  for (const proj of readdirSync(root)) {
    const pdir = join(root, proj)
    let entries: string[]
    try {
      entries = readdirSync(pdir)
    } catch {
      continue
    }
    for (const f of entries) {
      if (f.endsWith('.jsonl')) out.push({ path: join(pdir, f), session: f.slice(0, -6), sub: false })
      else {
        const sub = join(pdir, f, 'subagents')
        if (existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith('.jsonl')) out.push({ path: join(sub, s), session: f, sub: true })
      }
    }
  }
  return out
}

let syncing: Promise<number> | null = null

/**
 * Reads what's new in Claude Code's transcripts since the last sync and stores a summary of each
 * response. The first run copies everything Claude Code still has (30 days by default).
 * Returns how many responses were added.
 */
export function syncTranscripts(root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')): Promise<number> {
  if (!dir || !enabled) return Promise.resolve(0)
  if (syncing) return syncing
  syncing = (async () => {
    const state = loadSync()
    let added = 0
    const keepFrom = (() => {
      const d = new Date()
      d.setMonth(d.getMonth() - keepMonths)
      return d.getTime()
    })()
    for (const f of transcriptFiles(root)) {
      let fh: Awaited<ReturnType<typeof open>>
      try {
        fh = await open(f.path, 'r')
      } catch {
        continue
      }
      try {
        // Size from the open handle, so it matches what is read.
        const size = (await fh.stat()).size
        let from = state[f.path] ?? 0
        if (size < from) from = 0 // rewritten; ids keep it from counting twice
        if (size === from) continue
        const CHUNK = 32 * 1024 * 1024
        while (from < size) {
          const len = Math.min(CHUNK, size - from)
          const buf = Buffer.alloc(len)
          await fh.read(buf, 0, len, from)
          // Only whole lines; the rest is read next time.
          const end = buf.lastIndexOf(0x0a)
          if (end < 0) {
            if (len === CHUNK) from += len // one giant line with no usage in it
            break
          }
          const text = buf.subarray(0, end + 1).toString('utf8')
          from += end + 1
          const rows = parseTranscriptChunk(text, f.session, f.sub).filter((m) => m.t >= keepFrom)
          const byMonth = new Map<string, string[]>()
          for (const m of rows) (byMonth.get(month(m.t)) ?? byMonth.set(month(m.t), []).get(month(m.t))!).push(JSON.stringify(m))
          for (const [mo, lines] of byMonth) appendFileSync(join(dir!, `messages-${mo}.jsonl`), lines.join('\n') + '\n')
          added += rows.length
        }
        state[f.path] = from
      } finally {
        await fh.close()
      }
    }
    // Forget transcripts Claude Code has deleted.
    for (const p of Object.keys(state)) if (!existsSync(p)) delete state[p]
    writeFileSync(join(dir!, 'sync.json'), JSON.stringify(state))
    return added
  })().finally(() => {
    syncing = null
  })
  return syncing
}

// ---- Who used it

/** Maps responses to projects, repos and workspaces from app state. */
export function attributor(state: Pick<AppState, 'repos' | 'workspaces' | 'chats' | 'groups'>): Attributor {
  const groups = new Map((state.groups ?? []).map((g) => [g.id, g]))
  const repos = new Map(state.repos.map((r) => [r.id, r]))
  const wsById = new Map(state.workspaces.map((w) => [w.id, w]))
  const bySession = new Map<string, { title: string; wsId: string }>()
  for (const c of state.chats) if (c.sdkSessionId) bySession.set(c.sdkSessionId, { title: c.title, wsId: c.workspaceId })
  // Longest path first, so a worktree wins over the repo that holds it.
  const paths = [
    ...state.workspaces.map((w) => ({
      path: w.path,
      wsId: w.id as string | undefined,
      repoId: w.repoId
    })),
    ...state.repos.map((r) => ({
      path: r.path,
      wsId: undefined as string | undefined,
      repoId: r.id
    }))
  ]
    .filter((x) => x.path)
    .sort((a, b) => b.path.length - a.path.length)
  const under = (cwd: string, p: string) => cwd === p || cwd.startsWith(p.endsWith('/') ? p : `${p}/`)
  const groupOfWs = (wsId: string | undefined, repoId: string): UsageGroup => {
    const w = wsId ? wsById.get(wsId) : undefined
    const gid = w?.groupId ?? (w?.orchestratorId && groups.has(w.orchestratorId) ? w.orchestratorId : undefined)
    const g = gid ? groups.get(gid) : undefined
    if (g)
      return {
        id: `project:${g.id}`,
        label: `Project: ${g.name}`,
        kind: 'project'
      }
    const r = repos.get(repoId)
    return {
      id: `repo:${repoId}`,
      label: r?.name ?? 'Unknown repo',
      kind: 'repo'
    }
  }
  const cache = new Map<string, UsageGroup>()
  return {
    group(m) {
      const ck = `${m.s}|${m.cwd ?? ''}`
      const hit = cache.get(ck)
      if (hit) return hit
      let g: UsageGroup
      const chat = bySession.get(m.s)
      const w = chat ? wsById.get(chat.wsId) : undefined
      if (w) g = groupOfWs(w.id, w.repoId)
      else {
        const p = m.cwd ? paths.find((x) => under(m.cwd!, x.path)) : undefined
        if (p) g = groupOfWs(p.wsId, p.repoId)
        else {
          const name = m.cwd ? basename(m.cwd) : 'unknown folder'
          g = {
            id: `outside:${name}`,
            label: `Outside Choo Choo · ${name}`,
            kind: 'outside'
          }
        }
      }
      cache.set(ck, g)
      return g
    },
    chat(sessionId, cwd) {
      const c = bySession.get(sessionId)
      if (c) {
        const w = wsById.get(c.wsId)
        return { title: c.title || 'Untitled chat', workspace: w?.title }
      }
      return {
        title: `Terminal session in ${cwd ? basename(cwd) : 'an unknown folder'}`
      }
    }
  }
}

export function _resetUsageHistoryForTests() {
  dir = null
  last.clear()
  parsed.clear()
  enabled = true
  keepMonths = 12
}
