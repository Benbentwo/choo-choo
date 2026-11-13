import { useEffect, useMemo, useState } from 'react'
import type { Chat } from '@shared/types'
import { KEEP_GOING_PROMPT, PROJECT_CONTINUE_PROMPT, QUEUE_DRAG_TYPE, continueSettings, limitLabel, parseQueueTarget, untilText, type ContinueSettings, type QueueItem, type QueueTarget } from '@shared/continueWork'
import { routerChat } from '@shared/projects'
import { createPortal } from 'react-dom'
import { useStore, reportError } from '../store'
import { IconGrip, IconPause, IconPlay, IconSidebar, IconUpNext, IconX } from '../icons'

/**
 * Continue work: what starts, in order, when the usage window resets. The Up next page, the Home card
 * (only while out of usage), and the banner on a paused chat. See docs/prd/continue-work.md.
 */

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Re-renders every 30 seconds so countdowns stay current. */
function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function useContinue(): ContinueSettings {
  return continueSettings(useStore((s) => s.settings.continueWork))
}

function saveContinue(cur: ContinueSettings, patch: Partial<ContinueSettings>) {
  void window.api.saveSettings({ continueWork: { ...cur, ...patch } }).then((settings) => useStore.getState().set({ settings }), reportError)
}

type Row = { item: QueueItem; chat?: Chat; title: string; sub?: string; project?: string }

/** Queue items with their chat, workspace and project names. */
function useRows(): Row[] {
  const s = useStore()
  return useMemo(
    () =>
      s.continueQueue.map((item) => {
        const chat = s.chats.find((c) => c.id === item.chatId)
        const ws = chat && s.workspaces.find((w) => w.id === chat.workspaceId)
        const repo = ws && s.repos.find((r) => r.id === ws.repoId)
        const group = ws && (ws.groupId ? s.groups.find((g) => g.id === ws.groupId) : s.settings.experimentalProjects ? s.groups.find((g) => g.repoIds.includes(ws.repoId)) : undefined)
        const title = ws && !ws.orchestrator ? ws.title : (chat?.title ?? 'Chat')
        const sub = ws && !ws.orchestrator && chat && chat.title !== ws.title && chat.title !== 'New chat' ? chat.title : undefined
        return { item, chat, title, sub, project: group?.name ?? repo?.name }
      }),
    [s.continueQueue, s.chats, s.workspaces, s.repos, s.groups, s.settings.experimentalProjects]
  )
}

function openChat(chat?: Chat) {
  if (!chat) return
  const st = useStore.getState()
  st.setActiveChat(chat.workspaceId, chat.id)
  st.selectWorkspace(chat.workspaceId)
}

const chip = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-[10.5px] leading-[18px] whitespace-nowrap'
const btn = 'no-drag shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-40'

function stoppedText(chat: Chat | undefined, item: QueueItem): string {
  if (item.source === 'queued') return !item.prompt || item.prompt === KEEP_GOING_PROMPT ? 'continues where it left off' : `"${item.prompt}"`
  const p = chat?.paused
  const when = p ? `stopped ${time(p.at)}` : 'waiting'
  return item.prompt ? `${when} · then: "${item.prompt}"` : `${when} · continues where it left off`
}

/** The ordered list, with drag to reorder. `limit` shows only the first few (Home). */
function QueueList({ limit, compact }: { limit?: number; compact?: boolean }) {
  const rows = useRows()
  const cs = useContinue()
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // A string, so the selector stays equal between renders; a new Set each time would loop.
  const runningKey = useStore((s) => s.chats.filter((c) => c.status === 'running').map((c) => c.id).join(','))
  const running = useMemo(() => new Set(runningKey.split(',').filter(Boolean)), [runningKey])
  const shown = limit ? rows.slice(0, limit) : rows
  const drop = (to: number) => {
    if (drag) void window.api.continueMove(drag, to).catch(reportError)
    setDrag(null)
    setOver(null)
  }
  return (
    <div>
      {shown.map((r, i) => (
        <div key={r.item.id}>
          {!compact && i === cs.maxConcurrent && <div className="flex items-center gap-3 border-t border-dashed border-line px-4 py-1.5 text-[11px] text-faint before:flex-1 before:border-t before:border-dashed before:border-line after:flex-1 after:border-t after:border-dashed after:border-line">starts when a slot frees up</div>}
          <div
            draggable
            onDragStart={() => setDrag(r.item.id)}
            onDragEnd={() => {
              setDrag(null)
              setOver(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(i)
            }}
            onDrop={() => drop(i)}
            className={`group flex items-center gap-3 px-3 py-2.5 ${i ? 'border-t border-line' : ''} ${drag === r.item.id ? 'opacity-50' : ''} ${over === i && drag && drag !== r.item.id ? 'shadow-[inset_0_2px_0_var(--color-accent)]' : ''}`}
          >
            <span className="cursor-grab text-faint" title="Drag to reorder">
              <IconGrip width={13} height={13} />
            </span>
            <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-semibold ${i < cs.maxConcurrent ? 'bg-add/15 text-add' : 'bg-raised text-muted'}`}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <button className="truncate font-medium hover:underline" onClick={() => openChat(r.chat)}>
                  {r.title}
                </button>
                {r.sub && <span className="truncate text-[12px] text-muted">{r.sub}</span>}
                {r.item.source === 'paused' ? (
                  <span className={`${chip} bg-amber-400/15 text-amber-400`}>
                    <IconPause width={10} height={10} /> {compact ? 'Paused' : 'Paused at limit'}
                  </span>
                ) : (
                  <span className={`${chip} bg-[#60a5fa]/15 text-[#60a5fa]`}>New work</span>
                )}
                {running.has(r.item.chatId) && <span className={`${chip} bg-raised text-muted`}>working now</span>}
                {!compact && r.project && <span className={`${chip} bg-raised text-muted`}>{r.project}</span>}
              </div>
              {editing === r.item.id ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <textarea
                    autoFocus
                    rows={2}
                    className="min-w-0 flex-1 resize-none rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
                    value={draft}
                    placeholder={r.item.source === 'paused' ? cs.prompt : 'What should it do?'}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null)
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        void window.api.continueEdit(r.item.id, draft).catch(reportError)
                        setEditing(null)
                      }
                    }}
                  />
                  <button
                    className={btn}
                    onClick={() => {
                      void window.api.continueEdit(r.item.id, draft).catch(reportError)
                      setEditing(null)
                    }}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="mt-0.5 truncate text-[12px] text-muted">{compact && r.project ? `${r.project} · ` : ''}{stoppedText(r.chat, r.item)}</div>
              )}
            </div>
            {!compact && editing !== r.item.id && (
              <button
                className={btn}
                onClick={() => {
                  setDraft(r.item.prompt ?? '')
                  setEditing(r.item.id)
                }}
              >
                Edit prompt
              </button>
            )}
            <button className={btn} disabled={running.has(r.item.chatId)} title="Start it now, whatever the reset time" onClick={() => void window.api.continueRunNow(r.item.id).catch(reportError)}>
              Run now
            </button>
            {!compact && (
              <button className={`${btn} px-1.5`} title="Take off Up next" onClick={() => void window.api.continueRemove(r.item.id).catch(reportError)}>
                <IconX width={11} height={11} />
              </button>
            )}
          </div>
        </div>
      ))}
      {drag && (
        <div className="h-3" onDragOver={(e) => (e.preventDefault(), setOver(rows.length))} onDrop={() => drop(rows.length)} />
      )}
    </div>
  )
}

/** One sentence on the window and what happens next. */
function statusLine(limited: boolean, until: number | undefined, cs: ContinueSettings, count: number, now: number): string {
  if (!count) return limited ? 'Nothing is waiting. Chats that stop on the limit land here.' : 'Nothing is waiting.'
  if (limited)
    return `${until ? `At ${time(until + 60_000)}` : 'When it resets'}: start ${count === 1 ? '#1' : cs.maxConcurrent === 1 ? '#1' : `#1${cs.maxConcurrent > 2 && count > 2 ? `–#${Math.min(count, cs.maxConcurrent)}` : ' and #2'}`}. Each finished turn starts the next. Stop starting new ones once the window is ${cs.stopAtPercent}% used.`
  void now
  return `You have usage left, so items start now while the 5-hour window is under ${cs.stopAtPercent}%, ${cs.maxConcurrent} at a time.`
}

function Ring({ percent }: { percent: number }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--color-del) ${percent}%, var(--color-raised) 0)` }}>
      <div className="grid h-[34px] w-[34px] place-items-center rounded-full bg-panel text-[10.5px] font-bold">{percent}%</div>
    </div>
  )
}

export function ContinueWorkPage() {
  const s = useStore()
  const drop = useQueueDrop()
  const cs = useContinue()
  const now = useNow()
  const lim = s.usageLimit
  const count = s.continueQueue.length
  const last = s.resetLog[s.resetLog.length - 1]
  const sel = 'no-drag rounded-md border border-line bg-bg px-2 py-1 text-[12px] outline-none'
  return (
    <div className="relative flex min-w-0 flex-1 flex-col" {...drop.props}>
      {drop.over && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-[14px] font-medium text-accent">
          Drop to queue it for the next window
        </div>
      )}
      <div className="drag flex h-11 shrink-0 items-center gap-2 px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
        <div className="flex-1" />
        <button className={`${btn} px-3 py-1 text-[12px]`} onClick={() => s.set({ modal: 'settings', settingsTab: 'continue' })}>
          Settings
        </button>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-6 overflow-y-auto px-6 pt-4 pb-10">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-[650] tracking-[-0.02em]">Continue work</h1>
          <p className="mt-1 mb-5 text-[13px] text-muted">What Choo Choo starts, in this order, when your usage window resets. Drag to reorder, or drag a project, thread or workspace here from the sidebar.</p>

          <div className="mb-4 flex items-center gap-4 rounded-lg border border-line bg-panel px-4 py-3">
            {lim ? <Ring percent={100} /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raised text-muted"><IconUpNext width={18} height={18} /></span>}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {lim ? (
                  <>
                    {limitLabel(lim.kind).replace(/^./, (c) => c.toUpperCase())} reached{lim.until ? ` · resets ${time(lim.until)} ` : ' '}
                    {lim.until && <span className="font-normal text-muted">({untilText(lim.until, now)})</span>}
                  </>
                ) : (
                  'Not at a limit'
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-muted">{statusLine(!!lim, lim?.until, cs, count, now)}</div>
            </div>
            <select className={sel} value={cs.maxConcurrent} onChange={(e) => saveContinue(cs, { maxConcurrent: Number(e.target.value) })} title="How many run at once">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} at a time
                </option>
              ))}
            </select>
            <select className={sel} value={cs.stopAtPercent} onChange={(e) => saveContinue(cs, { stopAtPercent: Number(e.target.value) })} title="Stop starting new work once the 5-hour window is this full">
              {[40, 50, 60, 70, 80, 90, 100].map((n) => (
                <option key={n} value={n}>
                  {n === 100 ? 'No stop' : `Stop at ${n}%`}
                </option>
              ))}
            </select>
          </div>

          {count ? (
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              <QueueList />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-muted">
              <div className="mb-1 text-fg">Nothing up next</div>
              <div className="text-[12px]">When a chat stops on your plan's usage limit it waits here and continues after the reset. To line up more, drag a project, thread or workspace here from the sidebar, right-click one and pick Queue for next window, or use the box on the right.</div>
            </div>
          )}
          {s.automations.some((a) => a.enabled && a.trigger.kind === 'usage_reset') && (
            <div className="mt-3 text-[12px] text-muted">
              Also at each reset:{' '}
              {s.automations
                .filter((a) => a.enabled && a.trigger.kind === 'usage_reset')
                .map((a) => a.name)
                .join(', ')}{' '}
              (Automations).
            </div>
          )}
        </div>

        <div className="flex w-[300px] shrink-0 flex-col gap-4 pt-[60px]">
          <AddWork />
          <ProjectPriority />
          {last && (
            <div className="rounded-lg border border-line bg-panel p-3.5">
              <div className="mb-1.5 font-semibold">Last reset</div>
              <div className="text-[12px] leading-relaxed text-muted">
                {new Date(last.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · started {last.started}
                {last.held ? ` · held ${last.held} at the stop threshold` : ''}
                {last.lateMs ? <div>Started {Math.round(last.lateMs / 60_000)} min late: the Mac was asleep or the app was closed.</div> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Picks a chat and lines up a prompt for it. */
function AddWork() {
  const s = useStore()
  const options = useMemo(() => {
    const out: { id: string; label: string }[] = []
    for (const ws of s.workspaces) {
      if (ws.archived) continue
      const repo = s.repos.find((r) => r.id === ws.repoId)
      for (const c of s.chats) {
        if (c.workspaceId !== ws.id || c.remote || c.review) continue
        const name = ws.orchestrator ? `${repo?.name ?? 'Orchestrator'} › ${c.title}` : `${ws.title}${c.title !== ws.title && c.title !== 'New chat' ? ` › ${c.title}` : ''}`
        out.push({ id: c.id, label: name })
      }
    }
    return out
  }, [s.workspaces, s.chats, s.repos])
  const [chatId, setChatId] = useState('')
  const [text, setText] = useState('')
  const pick = chatId || options[0]?.id || ''
  const add = (top: boolean) => {
    if (!pick || !text.trim()) return
    void window.api.continueAdd(pick, text, top).then(() => setText(''), reportError)
  }
  return (
    <div className="rounded-lg border border-line bg-panel p-3.5">
      <div className="mb-2.5 font-semibold">Add work for next window</div>
      <select className="mb-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] outline-none" value={pick} onChange={(e) => setChatId(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <textarea
        rows={3}
        className="w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
        placeholder="What should it do when the window resets?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && add(false)}
      />
      <div className="mt-2 flex gap-2">
        <button className={btn} disabled={!text.trim() || !pick} onClick={() => add(true)}>
          Put at top
        </button>
        <div className="flex-1" />
        <button className="rounded-md bg-fg px-3 py-1 text-[12px] font-semibold text-bg disabled:opacity-40" disabled={!text.trim() || !pick} onClick={() => add(false)}>
          Add to end
        </button>
      </div>
    </div>
  )
}

/** Projects (or repos) in priority order: where newly paused chats land. */
function ProjectPriority() {
  const s = useStore()
  const cs = useContinue()
  const [drag, setDrag] = useState<string | null>(null)
  const all = useMemo(() => {
    const out: { id: string; name: string; kind: 'project' | 'repo' }[] = []
    const grouped = new Set<string>()
    if (s.settings.experimentalProjects)
      for (const g of s.groups) {
        out.push({ id: g.id, name: g.name, kind: 'project' })
        g.repoIds.forEach((r) => grouped.add(r))
      }
    for (const r of s.repos) if (!r.hidden && !grouped.has(r.id)) out.push({ id: r.id, name: r.name, kind: 'repo' })
    const rank = (id: string) => {
      const i = cs.projectOrder.indexOf(id)
      return i < 0 ? 1e9 : i
    }
    return out.sort((a, b) => rank(a.id) - rank(b.id))
  }, [s.groups, s.repos, s.settings.experimentalProjects, cs.projectOrder])
  if (!all.length) return null
  const drop = (to: string) => {
    if (!drag || drag === to) return setDrag(null)
    const ids = all.map((x) => x.id).filter((x) => x !== drag)
    ids.splice(ids.indexOf(to), 0, drag)
    saveContinue(cs, { projectOrder: ids })
    setDrag(null)
  }
  return (
    <div className="rounded-lg border border-line bg-panel p-3.5">
      <div className="mb-1.5 font-semibold">Project priority</div>
      <div className="mb-2.5 text-[12px] text-muted">
        {cs.order === 'project' ? 'New paused chats slot in by project, then by when they stopped. Drag to reorder.' : 'Paused chats go to the end of the list. Turn on project order in Settings.'}
      </div>
      {all.map((p, i) => (
        <div
          key={p.id}
          draggable
          onDragStart={() => setDrag(p.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => drop(p.id)}
          className={`flex cursor-grab items-center gap-2 rounded px-1 py-1 ${drag === p.id ? 'opacity-50' : ''}`}
        >
          <IconGrip width={12} height={12} className="text-faint" />
          <span className="w-4 text-[11px] text-faint">{i + 1}</span>
          <span className="truncate">{p.name}</span>
          {p.kind === 'repo' && <span className="text-[11px] text-faint">repo</span>}
        </div>
      ))}
    </div>
  )
}

/** The Home page card. Shows only while the plan is out of usage for the current window. */
export function ContinueCard() {
  const s = useStore()
  const cs = useContinue()
  useNow()
  const lim = s.usageLimit
  if (!lim) return null
  const count = s.continueQueue.length
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <span className="font-semibold">Continue work</span>
        <span className={`${chip} bg-amber-400/15 text-amber-400`}>
          <IconPause width={10} height={10} /> {limitLabel(lim.kind)}
          {lim.until ? ` · resets ${time(lim.until)}` : ''}
        </span>
        <div className="flex-1" />
        <span className="text-[12px] text-muted">
          {cs.maxConcurrent} at a time, stops at {cs.stopAtPercent}%
        </span>
        <button className={btn} onClick={() => s.set({ selectedWs: null, draftRepo: null, addonPage: null, prsPage: false, automationsPage: false, continuePage: true, panesShown: false })}>
          {count > 3 ? `See all ${count}` : 'Open Up next'}
        </button>
      </div>
      {count ? <QueueList limit={3} compact /> : <div className="px-4 py-3 text-[12px] text-muted">Nothing is waiting. Chats that stop on the limit land in Up next.</div>}
    </div>
  )
}

/** Shown under the last message of a chat that stopped on a usage limit. */
export function PausedBanner({ chat }: { chat: Chat }) {
  const s = useStore()
  useNow()
  const p = chat.paused
  if (!p || chat.status === 'running') return null
  const idx = s.continueQueue.findIndex((q) => q.chatId === chat.id)
  const item = idx >= 0 ? s.continueQueue[idx] : undefined
  const until = p.resetsAt ?? s.usageLimit?.until
  return (
    <div className="my-4 flex items-center gap-3 rounded-lg border border-amber-400/35 bg-amber-400/[0.07] px-3.5 py-3">
      <IconPause width={18} height={18} className="shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Paused at your {limitLabel(p.kind)}</div>
        <div className="mt-0.5 text-[12px] text-muted">
          {item
            ? `Resumes ${until ? `around ${time(until + 60_000)}` : 'when the window resets'}, ${idx === 0 ? 'first in line' : `#${idx + 1} in Up next`}. It will continue where it stopped.`
            : 'Not in Up next, so it will wait for you. Send a message or add it back to continue after the reset.'}
        </div>
      </div>
      {item ? (
        <>
          {idx > 0 && (
            <button className={btn} onClick={() => void window.api.continueMove(item.id, 0).catch(reportError)}>
              Move to top
            </button>
          )}
          <button className={btn} onClick={() => void window.api.continueRemove(item.id).catch(reportError)}>
            Don't resume
          </button>
          <button className={btn} onClick={() => void window.api.continueRunNow(item.id).catch(reportError)} title="Try now, before the reset">
            <span className="inline-flex items-center gap-1">
              <IconPlay width={10} height={10} /> Run now
            </span>
          </button>
        </>
      ) : (
        <button className={btn} onClick={() => void window.api.continueAdd(chat.id, '', true).catch(reportError)}>
          Resume after reset
        </button>
      )}
    </div>
  )
}

/** Settings › Continue work. */
export function ContinueSettingsSection() {
  const cs = useContinue()
  const save = (patch: Partial<ContinueSettings>) => saveContinue(cs, patch)
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  const [prompt, setPrompt] = useState(cs.prompt)
  useEffect(() => setPrompt(cs.prompt), [cs.prompt])
  const row = (label: string, hint: string | undefined, control: React.ReactNode) => (
    <div className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex-1">
        <div>{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
  return (
    <>
      {row('Resume paused chats when the limit resets', 'Chats that stop on your plan\'s usage limit join Up next and continue with the prompt below once the window resets.', <input type="checkbox" checked={cs.enabled} onChange={(e) => save({ enabled: e.target.checked })} />)}
      {row(
        'Start at most',
        'How many Up next items run at once. The next starts when one finishes its turn.',
        <select className={select} value={cs.maxConcurrent} onChange={(e) => save({ maxConcurrent: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} at a time
            </option>
          ))}
        </select>
      )}
      {row(
        'Stop starting new work once the window is at',
        'Keeps a fresh 5-hour window from being spent in the first half hour. Run now always starts an item.',
        <select className={select} value={cs.stopAtPercent} onChange={(e) => save({ stopAtPercent: Number(e.target.value) })}>
          {[40, 50, 60, 70, 80, 90, 100].map((n) => (
            <option key={n} value={n}>
              {n === 100 ? 'Never stop' : `${n}%`}
            </option>
          ))}
        </select>
      )}
      {row(
        'Order new paused chats by',
        'Where a chat lands in Up next when it stops. You can always drag it. Set the project order on the Up next page.',
        <select className={select} value={cs.order} onChange={(e) => save({ order: e.target.value as ContinueSettings['order'] })}>
          <option value="project">Project priority, then time</option>
          <option value="time">When they stopped</option>
        </select>
      )}
      <div className="border-b border-line px-5 py-3.5">
        <div>Continue prompt</div>
        <div className="mt-0.5 mb-2 text-[12px] text-faint">Sent to a paused chat when it resumes.</div>
        <textarea
          rows={2}
          className="w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== cs.prompt && save({ prompt })}
        />
      </div>
      {row('Also wait for weekly limits', 'Only when the weekly reset is less than a day away, as Claude Code does.', <input type="checkbox" checked={cs.weekly} onChange={(e) => save({ weekly: e.target.checked })} />)}
      {row('Keep Mac awake while work is waiting', 'Stops idle sleep until Up next has started. A closed lid still sleeps; the queue then starts when the Mac wakes.', <input type="checkbox" checked={cs.keepAwake} onChange={(e) => save({ keepAwake: e.target.checked })} />)}
      {row('Notify me when Up next starts after a reset', undefined, <input type="checkbox" checked={cs.notify} onChange={(e) => save({ notify: e.target.checked })} />)}
      <div className="px-5 py-3.5 text-[12px] text-faint">
        Choo Choo only resumes after the reset time Claude gives and after Claude Code's /usage shows the window open again. It never retries a refused window or switches accounts. Codex chats are not paused or resumed yet.
      </div>
    </>
  )
}

// ---- Adding sidebar rows to Up next: drag a project, thread or workspace onto Up next, or right-click › Queue for next window.

/** Opens the "Queue for next window" dialog for a sidebar row. */
export function askToQueue(target: QueueTarget) {
  useStore.getState().set({ queueTarget: target })
}

/** Makes a sidebar row carry a queue target while dragged (on top of whatever else its drag does). */
export function setQueueDrag(e: React.DragEvent, target: QueueTarget) {
  e.dataTransfer.setData(QUEUE_DRAG_TYPE, JSON.stringify(target))
  e.dataTransfer.effectAllowed = 'copyMove'
}

/** Drop handlers for anything that takes a sidebar row into Up next. `over` is true while a row hovers it. */
export function useQueueDrop(): { over: boolean; props: Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'> } {
  const [over, setOver] = useState(false)
  const ours = (e: React.DragEvent) => e.dataTransfer.types.includes(QUEUE_DRAG_TYPE)
  return {
    over,
    props: {
      onDragEnter: (e) => ours(e) && setOver(true),
      onDragOver: (e) => {
        if (!ours(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e) => {
        setOver(false)
        const t = parseQueueTarget(e.dataTransfer.getData(QUEUE_DRAG_TYPE))
        if (!t) return
        e.preventDefault()
        e.stopPropagation()
        useStore.getState().set({ drag: null })
        askToQueue(t)
      }
    }
  }
}

/** The chat a target resolves to now, and how to name it. A project's orchestrator chat may not exist until it's opened. */
function resolveTarget(s: ReturnType<typeof useStore.getState>, t: QueueTarget): { label: string; kind: string; chat?: Chat } {
  if (t.kind === 'thread') {
    const chat = s.chats.find((c) => c.id === t.chatId)
    return { label: chat?.title ?? 'Thread', kind: 'Project thread', chat }
  }
  if (t.kind === 'project') {
    const g = s.groups.find((x) => x.id === t.groupId)
    const orch = s.workspaces.find((w) => w.orchestrator && w.groupId === t.groupId && !w.archived)
    return { label: g?.name ?? 'Project', kind: 'Project orchestrator', chat: orch ? routerChat(s.chats, orch.id) : undefined }
  }
  const ws = s.workspaces.find((w) => w.id === t.wsId)
  const chats = s.chats.filter((c) => c.workspaceId === t.wsId && !c.review && !c.remote)
  const chat = chats.find((c) => c.id === s.activeChat[t.wsId]) ?? [...chats].sort((a, b) => b.createdAt - a.createdAt)[0]
  return { label: ws?.title ?? 'Workspace', kind: ws?.orchestrator ? 'Orchestrator' : 'Workspace', chat }
}

/** Asks what a dropped or right-clicked row should do when the window resets. */
export function QueueDialog() {
  const s = useStore()
  const t = s.queueTarget
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setText(''), [t])
  if (!t) return null
  const { label, kind, chat } = resolveTarget(s, t)
  const close = () => s.set({ queueTarget: null })
  const blankMeans = t.kind === 'project' ? 'Leave empty to have the orchestrator keep going on the project\'s open work.' : 'Leave empty to continue where it left off.'
  const add = async (top: boolean) => {
    setBusy(true)
    try {
      let id = chat?.id
      if (!id && t.kind === 'project') {
        const opened = await window.api.openGroupOrchestrator(t.groupId)
        id = opened.chat.id
      }
      if (!id) throw new Error('This workspace has no chat to continue')
      const prompt = text.trim() || (t.kind === 'project' ? PROJECT_CONTINUE_PROMPT : '')
      await window.api.continueAdd(id, prompt, top)
      close()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const limited = !!s.usageLimit
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-[480px] rounded-xl border border-line bg-panel p-4 shadow-2xl">
        <div className="mb-0.5 flex items-center gap-2 font-semibold">
          <IconUpNext width={15} height={15} /> Queue for next window
        </div>
        <div className="mb-3 text-[12px] text-muted">
          {kind}: <span className="text-fg">{label}</span>
          {chat && t.kind === 'ws' && chat.title !== label && chat.title !== 'New chat' ? ` › ${chat.title}` : ''}
        </div>
        <textarea
          autoFocus
          rows={3}
          className="w-full resize-none rounded-md border border-line bg-bg px-2.5 py-2 text-[12.5px] outline-none focus:border-accent"
          placeholder={t.kind === 'project' ? 'What should the orchestrator work on? e.g. Finish the open threads, then start the next milestone.' : 'What should it do? e.g. Address the review comments and push.'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(false)
          }}
        />
        <div className="mt-1.5 text-[11.5px] text-faint">
          {blankMeans} {limited ? 'It starts after your usage window resets, in its place in Up next.' : 'You have usage left, so it starts soon, in its place in Up next.'}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className={btn} onClick={close}>
            Cancel
          </button>
          <div className="flex-1" />
          <button className={btn} disabled={busy} onClick={() => void add(true)}>
            Put at top
          </button>
          <button className="rounded-md bg-fg px-3 py-1 text-[12px] font-semibold text-bg disabled:opacity-40" disabled={busy} onClick={() => void add(false)}>
            Add to Up next
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
