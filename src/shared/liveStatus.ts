import type { BackgroundTask, ChatItem } from './types'

type Tool = Extract<ChatItem, { kind: 'tool' }>

/**
 * What a running chat is doing right now, in plain words, so a long turn never reads as a bare
 * "Working…". Shared by the live line under the chat and the check-in that answers "what are you
 * working on?" without interrupting the turn.
 */
export interface LiveStatus {
  /** "Running tests", "Waiting on run 123", "Compacting", "Thinking". */
  label: string
  /** The step is a wait or a polling loop: it will sit quiet until something outside finishes. */
  waiting: boolean
  /** When the current step started (ms). */
  since: number
  /** When the turn started (ms), when known. */
  turnSince?: number
  /** The raw command or target behind the label, for a tooltip. */
  detail?: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const input = (t: Tool) => (t.input ?? {}) as Record<string, unknown>
const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? ''
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

// A shell loop that sleeps, or a command that blocks until something else finishes.
const WAIT_RE = /\b(until|while)\b[\s\S]*\bsleep\b|\bsleep\s+\d|\bgh\s+run\s+watch\b|\bgh\s+pr\s+checks\b[\s\S]*--watch|\s--watch\b|\bwait\b\s*$|\bkubectl\s+(rollout\s+status|wait)\b|\btail\s+-f\b/
// The thing being waited on, when the command names it.
const TARGETS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\bgh\s+run\s+(?:watch|view)\s+["']?\$?\{?(\d{3,})/, (m) => `run ${m[1]}`],
  [/\bgh\s+pr\s+checks\s+["']?#?(\d+)/, (m) => `PR #${m[1]} checks`],
  [/\bgh\s+pr\s+(?:view|merge)\s+["']?#?(\d+)/, (m) => `PR #${m[1]}`],
  [/\bgh\s+run\s+(?:watch|view)\b/, () => 'a CI run'],
  [/\bgh\s+pr\s+checks\b/, () => 'PR checks'],
  [/\bkubectl\s+(?:rollout\s+status|wait)\b/, () => 'a rollout'],
  [/\b(?:curl|wget)\b/, () => 'a URL to respond']
]

/** Whether a shell command is a wait or a polling loop. */
export function isWaitCommand(command: string): boolean {
  return WAIT_RE.test(command)
}

/** What a polling command is waiting on ("run 123", "PR #4 checks"), or ''. */
export function waitTarget(command: string): string {
  // A run id held in a shell variable (r=123; gh run view $r) still names the run.
  const vars = new Map<string, string>()
  for (const m of command.matchAll(/\b([A-Za-z_]\w*)=["']?(\d{3,})["']?/g)) vars.set(m[1], m[2])
  const resolved = command.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, v: string) => vars.get(v) ?? all)
  for (const [re, f] of TARGETS) {
    const m = resolved.match(re)
    if (m) return f(m)
  }
  return ''
}

/** One tool call in plain words, and whether it's a wait. */
export function describeTool(t: Tool): { label: string; waiting: boolean; detail?: string } {
  const i = input(t)
  const name = t.name
  if (name === 'Bash') {
    const cmd = str(i.command)
    const said = str(i.description).trim()
    if (isWaitCommand(cmd)) {
      const target = waitTarget(cmd)
      return { label: target ? `Waiting on ${target}` : said ? `Waiting: ${clip(said)}` : 'Waiting in a polling loop', waiting: true, detail: cmd }
    }
    return { label: said ? clip(said) : `Running ${clip(firstLine(cmd), 50)}`, waiting: false, detail: cmd }
  }
  if (name === 'BashOutput') return { label: 'Checking a background command', waiting: false }
  if (name === 'Read') return { label: `Reading ${base(str(i.file_path))}`, waiting: false, detail: str(i.file_path) }
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') return { label: `Editing ${base(str(i.file_path))}`, waiting: false, detail: str(i.file_path) }
  if (name === 'Grep' || name === 'Glob') return { label: `Searching for ${clip(str(i.pattern), 40)}`, waiting: false }
  if (name === 'WebFetch') return { label: `Reading ${clip(str(i.url), 50)}`, waiting: false }
  if (name === 'WebSearch') return { label: `Searching the web for ${clip(str(i.query), 40)}`, waiting: false }
  if (name === 'Task' || name === 'Agent') return { label: `Subagent: ${clip(str(i.description) || 'working', 50)}`, waiting: false }
  if (name === 'AskUserQuestion') return { label: 'Waiting for your answer', waiting: true }
  if (name === 'mcp__choo__wait_for_workspaces') return { label: 'Waiting on workspaces to finish', waiting: true }
  if (name === 'mcp__choo__pr_status') return i.wait ? { label: 'Waiting on PR checks', waiting: true } : { label: 'Checking a pull request', waiting: false }
  if (name.startsWith('mcp__')) {
    const [, server, tool] = name.split('__')
    return { label: `Using ${server}: ${(tool ?? '').replace(/_/g, ' ')}`, waiting: false }
  }
  return { label: `Using ${name}`, waiting: false }
}

/** The person's message that started the running turn: their latest one not sent into a turn already running. */
export function turnStart(items: ChatItem[]): number | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user' && !it.sentWhileRunning) return it.ts
    if (it.kind === 'result') return undefined
  }
  return undefined
}

/**
 * What a running chat is doing now. Only meaningful while the chat is running. `compactingSince` is
 * when Claude Code started compacting the conversation, while it still is.
 */
export function liveStatus(items: ChatItem[], compactingSince?: number): LiveStatus {
  const turnSince = turnStart(items)
  if (compactingSince !== undefined) return { label: 'Compacting', waiting: false, since: compactingSince, turnSince }
  // The step in flight: the latest tool call still without a result (a subagent's own calls count).
  let pending: Tool | undefined
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'result') break
    if (it.kind === 'tool' && it.result === undefined) {
      pending = it
      break
    }
  }
  if (pending) {
    const d = describeTool(pending)
    // A subagent's step reads under its parent's name.
    const parent = pending.parentId ? items.find((x) => x.id === pending!.parentId) : undefined
    const label = parent?.kind === 'tool' && !d.waiting ? `${describeTool(parent).label} · ${d.label}` : d.label
    return { label, waiting: d.waiting, since: pending.ts, turnSince, detail: d.detail }
  }
  const last = items.at(-1)
  if (last?.kind === 'assistant' && last.streaming) return { label: 'Writing', waiting: false, since: last.ts, turnSince }
  return { label: 'Thinking', waiting: false, since: last && last.ts > (turnSince ?? 0) ? last.ts : (turnSince ?? Date.now()), turnSince }
}

/** "45s", "14m", "2h 5m". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/** A message sent mid-turn that only asks how things are going. These get a check-in answer right away instead of waiting for Claude's next step. */
export function isStatusQuestion(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  if (!t || t.length > 80 || t.includes('\n')) return false
  return (
    /^(status|update|progress|eta)\s*\??$/.test(t) ||
    /^(any|an|got an?) (update|news|progress)s?\b.*\??$/.test(t) ||
    /^(how'?s|how is|how are) (it|this|that|things|everything|the \w+|we)( going| looking| coming along| doing)?( so far)?\s*\??$/.test(t) ||
    /^what('?s| is| are) (you|we|it|happening|going on|the status)( (doing|working on|waiting on|waiting for|up to|stuck on))?( (right )?now)?\s*\??$/.test(t) ||
    /^(are you|is it) (stuck|still (going|working|running|there))\s*\??$/.test(t) ||
    /^where are (you|we)( at| with this)?\s*\??$/.test(t)
  )
}

/** The default check-in question. */
export const CHECK_IN_QUESTION = 'What are you working on, and what are we waiting on?'

/** The slash command for a side question that doesn't interrupt the turn, as in Claude Code. */
export const CHECK_IN_COMMAND = /^\/btw(?:\s+([\s\S]*))?$/i

/**
 * The status block given to the check-in model ahead of the transcript: what is running and for how
 * long, and Claude Code's background tasks.
 */
export function statusBlock(items: ChatItem[], tasks: BackgroundTask[], running: boolean, now = Date.now(), compactingSince?: number): string {
  const lines: string[] = []
  if (!running) lines.push('The agent is not running right now; its last turn has ended.')
  else {
    const s = liveStatus(items, compactingSince)
    lines.push(`Current step: ${s.label} (for ${formatElapsed(now - s.since)})${s.waiting ? ', a wait or polling loop' : ''}`)
    if (s.detail) lines.push(`Current command: ${clip(s.detail, 600)}`)
    if (s.turnSince !== undefined) lines.push(`This turn has run for ${formatElapsed(now - s.turnSince)}.`)
  }
  for (const t of tasks) lines.push(`Background task: ${t.description}${t.summary ? ` (${t.summary})` : ''}`)
  return lines.join('\n')
}
