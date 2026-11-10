import { randomUUID } from 'node:crypto'
import type { Chat, Workspace } from '@shared/types'
import type { InboxPr } from '@shared/prInbox'
import {
  DEFAULT_MAX_FINDINGS,
  LEDGER_LIMIT,
  RUNS_LIMIT,
  diffInbox,
  isSchedule,
  nextRun,
  runPrompt,
  type Automation,
  type AutomationRun,
  type AutomationTarget,
  type AutomationTrigger,
  type PrEvent
} from '@shared/automations'
import * as store from './store'
import type { AutomationHooks } from './orchestrator'

/**
 * Runs automations: a timer for schedules, a GitHub poll for PR events, and Run now. Each run is
 * a turn in the automation's own chat on an orchestrator, which opens one workspace per finding.
 * The app holds the per-run cap and the ledger of findings already handled. See docs/prd/automations.md.
 */

export interface Deps {
  /** The automation's chat: a thread on its project's orchestrator, or a chat on its repo's. Made the first time. */
  chatFor(a: Automation): Promise<Chat>
  /** Starts a turn. Throws when the chat is busy. */
  send(chat: Chat, text: string): void
  isRunning(chatId: string): boolean
  /** The PR inbox, with each PR tied to its local repo where there is one. */
  loadPrs(): Promise<InboxPr[]>
  /** Saves state and tells the window. */
  changed(): void
}

const TICK_MS = 30_000
const GITHUB_POLL_MS = 2 * 60_000

let deps: Deps | null = null
let lastGithubPoll = 0
let polling = false
/** Findings a run is opening right now, per run, so parallel calls can't pass the cap together. */
const claimed = new Map<string, Set<string>>()

const list = () => (store.get().automations ??= [])
const runs = () => (store.get().automationRuns ??= [])
const ledger = (id: string) => ((store.get().automationLedger ??= {})[id] ??= [])

export function init(d: Deps) {
  deps = d
  // A run can't still be going after a restart.
  for (const r of runs()) if (r.status === 'running') r.status = 'done'
  const t = setInterval(() => void tick(), TICK_MS)
  t.unref?.()
  setTimeout(() => void tick(), 5_000).unref?.()
}

function cleanTrigger(t: AutomationTrigger): AutomationTrigger {
  switch (t?.kind) {
    case 'hourly':
      return { kind: 'hourly', hours: Math.max(1, Math.min(24, Math.round(Number(t.hours)) || 1)) }
    case 'daily':
      return { kind: 'daily', at: /^\d{1,2}:\d{2}$/.test(t.at) ? t.at : '09:00', ...(t.weekdaysOnly ? { weekdaysOnly: true } : {}) }
    case 'weekly':
      return { kind: 'weekly', day: Math.max(0, Math.min(6, Math.round(Number(t.day)) || 0)), at: /^\d{1,2}:\d{2}$/.test(t.at) ? t.at : '09:00' }
    case 'github':
      if (!['review_requested', 'checks_failed', 'reviewed'].includes(t.event)) throw new Error('Pick a GitHub event')
      return { kind: 'github', event: t.event }
    default:
      return { kind: 'manual' }
  }
}

function checkTarget(t: AutomationTarget): AutomationTarget {
  const s = store.get()
  if (t?.kind === 'project') {
    if (!s.groups?.some((g) => g.id === t.groupId)) throw new Error('Pick a project')
    return { kind: 'project', groupId: t.groupId }
  }
  if (t?.kind === 'repo' && s.repos.some((r) => r.id === t.repoId)) return { kind: 'repo', repoId: t.repoId }
  throw new Error('Pick where results go')
}

/** Creates or updates an automation from the editor. */
export function save(input: Partial<Automation> & { name: string; prompt: string; trigger: AutomationTrigger; target: AutomationTarget }): Automation {
  const name = String(input.name ?? '').trim()
  const prompt = String(input.prompt ?? '').trim()
  if (!name) throw new Error('Give the automation a name')
  if (!prompt) throw new Error('Say what the automation should check')
  const trigger = cleanTrigger(input.trigger)
  const target = checkTarget(input.target)
  const maxFindings = Math.max(1, Math.min(20, Math.round(Number(input.maxFindings)) || DEFAULT_MAX_FINDINGS))
  let a = input.id ? list().find((x) => x.id === input.id) : undefined
  if (input.id && !a) throw new Error('This automation was deleted')
  const wasGithub = list().some((x) => x.enabled && x.trigger.kind === 'github')
  if (!a) {
    a = { id: randomUUID(), name, prompt, trigger, target, maxFindings, enabled: input.enabled ?? true, createdAt: Date.now() }
    list().push(a)
  } else {
    const retimed = JSON.stringify(a.trigger) !== JSON.stringify(trigger)
    Object.assign(a, { name, prompt, trigger, target, maxFindings, enabled: input.enabled ?? a.enabled })
    if (retimed) delete a.nextRunAt
  }
  a.nextRunAt = a.enabled && isSchedule(a.trigger) ? (a.nextRunAt ?? nextRun(a.trigger, Date.now())) : undefined
  // The first GitHub automation starts from where things stand now, not from an old look.
  if (!wasGithub && a.enabled && a.trigger.kind === 'github') {
    delete store.get().githubWatch
    lastGithubPoll = 0
  }
  deps?.changed()
  return a
}

export function setEnabled(id: string, enabled: boolean): Automation {
  const a = list().find((x) => x.id === id)
  if (!a) throw new Error('This automation was deleted')
  return save({ ...a, enabled })
}

/** Deletes an automation. Its chat, workspaces and run history stay. */
export function remove(id: string) {
  const s = store.get()
  s.automations = list().filter((a) => a.id !== id)
  if (s.automationLedger) delete s.automationLedger[id]
  deps?.changed()
}

/** The repos an automation's GitHub events may come from. */
function targetRepoIds(a: Automation): string[] {
  if (a.target.kind === 'repo') return [a.target.repoId]
  const groupId = a.target.groupId
  return store.get().groups?.find((g) => g.id === groupId)?.repoIds ?? []
}

function addRun(r: AutomationRun) {
  const all = runs()
  all.push(r)
  if (all.length > RUNS_LIMIT) all.splice(0, all.length - RUNS_LIMIT)
}

/** Starts a run. Skips it, with a note in the history, when the last run is still going. */
export async function fire(a: Automation, reason: string, events: PrEvent[] = []): Promise<AutomationRun> {
  if (!deps) throw new Error('Automations are not ready yet')
  a.lastRunAt = Date.now()
  const run: AutomationRun = { id: randomUUID(), automationId: a.id, chatId: '', startedAt: Date.now(), reason, findings: [], skipped: 0, status: 'running' }
  try {
    const chat = await deps.chatFor(a)
    run.chatId = chat.id
    if (deps.isRunning(chat.id)) {
      run.status = 'skipped'
      run.note = 'The last run was still going'
    } else {
      addRun(run)
      deps.send(chat, runPrompt(a, reason, events))
      deps.changed()
      return run
    }
  } catch (e) {
    run.status = 'error'
    run.note = (e as Error).message
  }
  addRun(run)
  deps.changed()
  return run
}

export function runNow(id: string): Promise<AutomationRun> {
  const a = list().find((x) => x.id === id)
  if (!a) throw new Error('This automation was deleted')
  return fire(a, 'Run now')
}

/** The latest run in this chat, while it's going or after: findings the person asks for later count toward it too. */
function latestRun(chatId: string): AutomationRun | undefined {
  const all = runs()
  for (let i = all.length - 1; i >= 0; i--) if (all[i].chatId === chatId && all[i].status !== 'skipped') return all[i]
  return undefined
}

/** start_workspace's cap and ledger, for a turn in an automation's chat. */
export function hooksFor(chat: Chat): AutomationHooks | undefined {
  const a = chat.automationId ? list().find((x) => x.id === chat.automationId) : undefined
  if (!a) return undefined
  const current = () => latestRun(chat.id)
  return {
    name: a.name,
    chatId: chat.id,
    maxFindings: a.maxFindings,
    claim: (findingId) => {
      const run = current()
      const held = run ? (claimed.get(run.id) ?? new Set<string>()) : new Set<string>()
      if (ledger(a.id).includes(findingId) || held.has(findingId)) {
        if (run) run.skipped++
        return `an earlier run of this automation already opened a workspace for ${findingId}.`
      }
      if (run && run.findings.length + held.size >= a.maxFindings) {
        run.skipped++
        return `this run already opened ${a.maxFindings} workspaces, the most it may. Mention the rest in your summary.`
      }
      held.add(findingId)
      if (run) claimed.set(run.id, held)
      return undefined
    },
    release: (findingId) => {
      const run = current()
      if (run) claimed.get(run.id)?.delete(findingId)
    },
    record: (findingId, title, ws: Workspace) => {
      ws.automationId = a.id
      const l = ledger(a.id)
      l.push(findingId)
      if (l.length > LEDGER_LIMIT) l.splice(0, l.length - LEDGER_LIMIT)
      const run = current()
      if (run) {
        claimed.get(run.id)?.delete(findingId)
        run.findings.push({ id: findingId, title, workspaceId: ws.id })
      }
      deps?.changed()
    }
  }
}

/** Marks the run in this chat finished when its turn ends. */
export function onTurnDone(chat: Chat) {
  if (!chat.automationId) return
  const run = latestRun(chat.id)
  if (!run || run.status !== 'running') return
  run.status = chat.status === 'error' ? 'error' : 'done'
  claimed.delete(run.id)
  deps?.changed()
}

async function tick() {
  // Automations sit behind Settings › Experimental › Projects for now.
  if (!store.get().settings.experimentalProjects) return
  const now = Date.now()
  for (const a of list()) {
    if (!a.enabled || !isSchedule(a.trigger)) continue
    a.nextRunAt ??= nextRun(a.trigger, now)
    if (a.nextRunAt !== undefined && now >= a.nextRunAt) {
      a.nextRunAt = nextRun(a.trigger, now)
      await fire(a, 'Scheduled')
    }
  }
  if (now - lastGithubPoll >= GITHUB_POLL_MS) await pollGithub()
}

/** Looks at the PR inbox and starts the GitHub-event automations that match what changed. */
export async function pollGithub() {
  const watching = list().filter((a) => a.enabled && a.trigger.kind === 'github')
  if (!deps || polling || !watching.length) return
  polling = true
  lastGithubPoll = Date.now()
  try {
    const prs = await deps.loadPrs()
    const s = store.get()
    const { events, next } = diffInbox(s.githubWatch, prs)
    s.githubWatch = next
    store.save()
    const repoOf = new Map(prs.map((p) => [`${p.repo}#${p.number}`, p.repoId]))
    for (const a of watching) {
      if (a.trigger.kind !== 'github') continue
      const event = a.trigger.event
      const repos = targetRepoIds(a)
      const mine = events.filter((e) => e.event === event && repos.includes(repoOf.get(`${e.repo}#${e.number}`) ?? ''))
      if (!mine.length) continue
      const reason = mine.length === 1 ? `${mine[0].repo}#${mine[0].number} ${mine[0].detail}` : `${mine.length} GitHub events`
      await fire(a, reason, mine)
    }
  } catch {
    // gh missing or offline: try again next poll.
  } finally {
    polling = false
  }
}
