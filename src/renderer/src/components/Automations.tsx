import { useMemo, useState } from 'react'
import { DAYS, DEFAULT_MAX_FINDINGS, GITHUB_EVENTS, describeTrigger, type Automation, type AutomationRun, type AutomationTarget, type AutomationTrigger, type GithubEvent } from '@shared/automations'
import { useStore, refreshState, reportError } from '../store'
import { IconPlay, IconPlus, IconSidebar } from '../icons'

/**
 * The Automations page: checks that run on a schedule, a GitHub event or a button press, and open
 * a workspace per finding. Each one sends its results to a project thread or to a repo.
 */
export function AutomationsPage() {
  const s = useStore()
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)
  const lastRun = useMemo(() => {
    const m = new Map<string, AutomationRun>()
    for (const r of s.automationRuns) m.set(r.automationId, r)
    return m
  }, [s.automationRuns])
  const recent = [...s.automationRuns].reverse().slice(0, 25)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="drag flex h-11 shrink-0 items-center gap-2 px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-6 pt-6 pb-10">
        <div className="mb-1 flex items-center gap-3">
          <h1 className="flex-1 text-[20px] font-[650] tracking-[-0.02em]">Automations</h1>
          <button className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90" onClick={() => setEditing('new')}>
            <IconPlus width={13} height={13} /> New automation
          </button>
        </div>
        <p className="mb-5 text-[13px] text-muted">
          Checks that run on a schedule or a GitHub event, look at your connected tools, and open a workspace for each thing they find. They run while Choo Choo is open.
        </p>

        {editing && <Editor initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}

        {s.automations.length ? (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[44px_1.5fr_1.1fr_1.3fr_1.5fr_80px] gap-3 border-b border-line px-3 py-2 text-[11px] font-medium tracking-wide text-faint uppercase">
              <span />
              <span>Name</span>
              <span>When</span>
              <span>Results go to</span>
              <span>Last run</span>
              <span />
            </div>
            {s.automations.map((a) => (
              <Row key={a.id} a={a} run={lastRun.get(a.id)} onEdit={() => setEditing(a)} />
            ))}
          </div>
        ) : (
          !editing && (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-muted">
              <div className="mb-1 text-fg">No automations yet</div>
              <div className="text-[12px]">For example: every weekday at 9:00, find new bugs in your issue tracker and open a workspace to fix each one.</div>
            </div>
          )
        )}

        <div className="mt-5 rounded-lg border border-line px-4 py-3 text-[12px] text-muted">
          <div className="mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Results go to</div>
          <div>
            <span className="text-fg">A project</span>: runs post in a thread named after the automation, and the workspaces list under the project like any other work.
          </div>
          <div>
            <span className="text-fg">A repo</span>: runs post in a chat on the repo's orchestrator, and the workspaces list under the repo.
          </div>
          <div className="mt-1.5">Runs can use Linear and Notion from Settings › Integrations, and any MCP server Claude Code has. A finding that already got a workspace never gets a second one.</div>
        </div>

        {recent.length > 0 && (
          <>
            <h2 className="mt-7 mb-2 text-[13px] font-medium">Recent runs</h2>
            <div className="divide-y divide-line rounded-lg border border-line">
              {recent.map((r) => (
                <RunRow key={r.id} r={r} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function when(ts: number): string {
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function runSummary(r: AutomationRun): string {
  if (r.status === 'running') return 'running…'
  if (r.status === 'skipped') return `skipped: ${r.note ?? ''}`
  if (r.status === 'error') return `failed${r.note ? `: ${r.note}` : ''}`
  const n = r.findings.length
  return n ? `${n} new workspace${n === 1 ? '' : 's'}` : 'nothing new'
}

function useTargetName() {
  const s = useStore()
  return (t: AutomationTarget): { name: string; kind: string } => {
    if (t.kind === 'project') return { name: s.groups.find((g) => g.id === t.groupId)?.name ?? 'Deleted project', kind: 'project thread' }
    return { name: s.repos.find((r) => r.id === t.repoId)?.name ?? 'Removed repo', kind: 'repo' }
  }
}

/** Opens the chat a run posted in. */
function openChat(chatId: string) {
  const st = useStore.getState()
  const chat = st.chats.find((c) => c.id === chatId)
  if (!chat) return
  st.setActiveChat(chat.workspaceId, chat.id)
  st.selectWorkspace(chat.workspaceId)
}

function Row({ a, run, onEdit }: { a: Automation; run?: AutomationRun; onEdit: () => void }) {
  const target = useTargetName()(a.target)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    try {
      await window.api.setAutomationEnabled(a.id, !a.enabled)
      await refreshState()
    } catch (e) {
      reportError(e)
    }
  }
  const runNow = async () => {
    setBusy(true)
    try {
      await window.api.runAutomation(a.id)
      await refreshState()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="group grid grid-cols-[44px_1.5fr_1.1fr_1.3fr_1.5fr_80px] items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-hover/50">
      <button
        role="switch"
        aria-checked={a.enabled}
        title={a.enabled ? 'On: click to pause' : 'Paused: click to turn on'}
        onClick={() => void toggle()}
        className={`relative h-[18px] w-[32px] rounded-full transition-colors ${a.enabled ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${a.enabled ? 'left-[16px]' : 'left-[2px]'}`} />
      </button>
      <button className="truncate text-left font-medium hover:underline" onClick={onEdit} title="Edit">
        {a.name}
      </button>
      <span className="truncate text-muted">{describeTrigger(a.trigger)}</span>
      <span className="truncate">
        {target.name} <span className="text-faint">· {target.kind}</span>
      </span>
      <span className="truncate text-[12px] text-muted">
        {!a.enabled ? 'paused' : run ? `${when(run.startedAt)} · ${runSummary(run)}` : a.nextRunAt ? `next ${when(a.nextRunAt)}` : 'not run yet'}
      </span>
      <span className="flex justify-end gap-1">
        {run?.chatId && (
          <button className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => openChat(run.chatId)} title="Open the chat its runs post in">
            Chat
          </button>
        )}
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40" disabled={busy} onClick={() => void runNow()} title="Run now">
          <IconPlay width={13} height={13} />
        </button>
      </span>
    </div>
  )
}

function RunRow({ r }: { r: AutomationRun }) {
  const s = useStore()
  const a = s.automations.find((x) => x.id === r.automationId)
  return (
    <div className="px-3 py-2 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.status === 'running' ? 'bg-accent' : r.status === 'error' ? 'bg-del' : r.status === 'skipped' ? 'bg-faint' : 'bg-add'}`} />
        <span className="w-24 shrink-0 text-faint">{when(r.startedAt)}</span>
        <span className="truncate font-medium">{a?.name ?? 'Deleted automation'}</span>
        <span className="truncate text-muted">{r.reason}</span>
        <span className="flex-1" />
        <span className="shrink-0 text-muted">{runSummary(r)}</span>
        {r.chatId && s.chats.some((c) => c.id === r.chatId) && (
          <button className="shrink-0 rounded px-1.5 text-muted hover:bg-hover hover:text-fg" onClick={() => openChat(r.chatId)}>
            Open
          </button>
        )}
      </div>
      {r.findings.length > 0 && (
        <div className="mt-1 ml-[118px] flex flex-wrap gap-1.5">
          {r.findings.map((f) => (
            <button
              key={f.workspaceId}
              className="rounded border border-line px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg"
              title={f.id}
              onClick={() => s.workspaces.some((w) => w.id === f.workspaceId) && s.selectWorkspace(f.workspaceId)}
            >
              {f.title || f.id}
            </button>
          ))}
          {r.skipped > 0 && <span className="px-1 py-0.5 text-faint">{r.skipped} skipped</span>}
        </div>
      )}
    </div>
  )
}

type WhenKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'github' | 'manual'

function whenKind(t: AutomationTrigger): WhenKind {
  if (t.kind === 'daily') return t.weekdaysOnly ? 'weekdays' : 'daily'
  return t.kind
}

const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent'
const select = 'rounded-md border border-line bg-bg px-2 py-1.5 outline-none'

function Editor({ initial, onDone }: { initial: Automation | null; onDone: () => void }) {
  const s = useStore()
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const t = initial?.trigger
  const [kind, setKind] = useState<WhenKind>(t ? whenKind(t) : 'daily')
  const [hours, setHours] = useState(t?.kind === 'hourly' ? t.hours : 2)
  const [at, setAt] = useState(t && 'at' in t ? t.at : '09:00')
  const [day, setDay] = useState(t?.kind === 'weekly' ? t.day : 1)
  const [event, setEvent] = useState<GithubEvent>(t?.kind === 'github' ? t.event : 'review_requested')
  const firstTarget = (): string => (s.groups[0] ? `project:${s.groups[0].id}` : s.repos[0] ? `repo:${s.repos[0].id}` : '')
  const [target, setTarget] = useState(initial ? `${initial.target.kind}:${initial.target.kind === 'project' ? initial.target.groupId : initial.target.repoId}` : firstTarget())
  const [max, setMax] = useState(initial?.maxFindings ?? DEFAULT_MAX_FINDINGS)
  const [saving, setSaving] = useState(false)

  const trigger = (): AutomationTrigger => {
    switch (kind) {
      case 'hourly':
        return { kind: 'hourly', hours }
      case 'daily':
        return { kind: 'daily', at }
      case 'weekdays':
        return { kind: 'daily', at, weekdaysOnly: true }
      case 'weekly':
        return { kind: 'weekly', day, at }
      case 'github':
        return { kind: 'github', event }
      default:
        return { kind: 'manual' }
    }
  }
  const parsedTarget = (): AutomationTarget => {
    const [k, id] = target.split(':')
    return k === 'project' ? { kind: 'project', groupId: id } : { kind: 'repo', repoId: id }
  }

  const submit = async () => {
    setSaving(true)
    try {
      await window.api.saveAutomation({ ...(initial ? { id: initial.id, enabled: initial.enabled } : {}), name, prompt, trigger: trigger(), target: parsedTarget(), maxFindings: max })
      await refreshState()
      onDone()
    } catch (e) {
      reportError(e)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!initial) return
    try {
      await window.api.deleteAutomation(initial.id)
      await refreshState()
      onDone()
    } catch (e) {
      reportError(e)
    }
  }

  return (
    <div className="mb-5 space-y-3 rounded-lg border border-accent/40 bg-raised/40 px-4 py-4">
      <div className="font-medium">{initial ? 'Edit automation' : 'New automation'}</div>
      <input autoFocus className={input} placeholder="Name, e.g. Fix new bugs" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea
        className={`${input} min-h-[96px] resize-y`}
        placeholder="What to check and what counts as a finding. For example: look for issues labelled bug in the tracker created since the last run. Open a workspace for each to reproduce and fix it, with a PR."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-28 text-muted">When</span>
        <select className={select} value={kind} onChange={(e) => setKind(e.target.value as WhenKind)}>
          <option value="hourly">Every few hours</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Once a week</option>
          <option value="github">On a GitHub event</option>
          <option value="manual">Only when I run it</option>
        </select>
        {kind === 'hourly' && (
          <>
            every
            <input type="number" min={1} max={24} className={`${select} w-16`} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
            hours
          </>
        )}
        {kind === 'weekly' && (
          <select className={select} value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        )}
        {(kind === 'daily' || kind === 'weekdays' || kind === 'weekly') && (
          <>
            at
            <input type="time" className={select} value={at} onChange={(e) => setAt(e.target.value)} />
          </>
        )}
        {kind === 'github' && (
          <select className={select} value={event} onChange={(e) => setEvent(e.target.value as GithubEvent)}>
            {GITHUB_EVENTS.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {kind === 'github' && <div className="ml-[120px] text-[12px] text-faint">Checked every two minutes while Choo Choo is open, for PRs in the repos below. {GITHUB_EVENTS.find((e) => e.id === event)?.hint}</div>}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-28 text-muted">Results go to</span>
        <select className={select} value={target} onChange={(e) => setTarget(e.target.value)}>
          {s.groups.length > 0 && (
            <optgroup label="Projects">
              {s.groups.map((g) => (
                <option key={g.id} value={`project:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Repos">
            {s.repos
              .filter((r) => !r.hidden)
              .map((r) => (
                <option key={r.id} value={`repo:${r.id}`}>
                  {r.name}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="w-28 text-muted">At most</span>
        <input type="number" min={1} max={20} className={`${select} w-16`} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        <span className="text-muted">new workspaces per run</span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        {initial && (
          <button className="rounded-md px-2.5 py-1 text-[12px] text-del hover:bg-del/10" onClick={() => void remove()}>
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button className="rounded-md px-3 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={onDone}>
          Cancel
        </button>
        <button className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50" disabled={saving || !name.trim() || !prompt.trim() || !target} onClick={() => void submit()}>
          {initial ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  )
}
