import { useEffect, useMemo, useState } from 'react'
import { groupByRepo, type InboxPr, type PrFilter } from '@shared/prInbox'
import { useStore, refreshPrInbox, openPrWorkspace, reportError } from '../store'
import { IconGithub, IconPR, IconRight, IconSidebar } from '../icons'

const FILTER_KEY = 'prs-filter'
const FILTERS: { id: PrFilter; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'mine', label: 'Mine' },
  { id: 'all', label: 'All' }
]

/** Live list of PRs waiting on the person's review, or opened by them, grouped by repo. Like Arc's GitHub live folder. */
export function PrInboxPage() {
  const s = useStore()
  const [filter, setFilter] = useState<PrFilter>(() => {
    try {
      return (localStorage.getItem(FILTER_KEY) as PrFilter) || 'review'
    } catch {
      return 'review'
    }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const prs = s.prInbox?.prs ?? []
  const groups = useMemo(() => groupByRepo(prs, filter), [prs, filter])
  const flat = groups.flatMap((g) => g.prs)
  const key = (p: InboxPr) => `${p.repo}#${p.number}`
  const counts = { review: prs.filter((p) => p.roles.includes('review')).length, mine: prs.filter((p) => p.roles.includes('mine')).length, all: prs.length }

  // Keep the list live while the page is open.
  useEffect(() => {
    const t = setInterval(() => void refreshPrInbox(), 60_000)
    const onFocus = () => void refreshPrInbox()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const pick = (f: PrFilter) => {
    setFilter(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* storage unavailable */
    }
  }

  const open = async (p: InboxPr) => {
    setOpening(key(p))
    try {
      await openPrWorkspace(p)
    } catch (e) {
      reportError(e)
    } finally {
      setOpening(null)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!flat.length) return
    const i = flat.findIndex((p) => key(p) === selected)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = flat[Math.max(0, Math.min(flat.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))]
      setSelected(key(next))
      document.getElementById(`pr-${key(next)}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault()
      void open(flat[i])
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="drag flex h-11 shrink-0 items-center gap-2 px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pt-6">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="flex-1 text-[20px] font-[650] tracking-[-0.02em]">Pull requests</h1>
          <div className="flex rounded-md border border-line text-[12px]">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => pick(f.id)} className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md ${filter === f.id ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}>
                {f.label}
                <span className="ml-1.5 text-faint">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <button className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50" disabled={s.prInboxLoading} onClick={() => void refreshPrInbox()} title="Reload from GitHub">
            {s.prInboxLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {s.prInboxError && (
          <div className="selectable mb-3 rounded-lg border border-del/40 px-3 py-2 text-[12px] text-muted">
            {s.prInboxError}
            {s.prInbox && <div className="mt-0.5 text-faint">Showing the list from {new Date(s.prInbox.fetchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</div>}
          </div>
        )}
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8 outline-none" tabIndex={0} onKeyDown={onKey}>
          {!s.prInbox && s.prInboxLoading && <div className="py-10 text-center text-muted">Loading pull requests…</div>}
          {s.prInbox && groups.length === 0 && (
            <div className="py-10 text-center text-muted">{filter === 'review' ? 'Nothing waiting on your review.' : filter === 'mine' ? 'You have no open pull requests.' : 'No open pull requests.'}</div>
          )}
          {groups.map((g) => (
            <section key={g.repo} className="mb-5">
              <div className="mb-1 flex items-center gap-2 px-2 text-[12px] font-medium text-faint">
                <img src={`https://avatars.githubusercontent.com/${g.repo.split('/')[0]}?s=40`} alt="" className="h-4 w-4 rounded-[4px] bg-raised" />
                <span className="text-muted">{g.repo}</span>
                <span>{g.prs.length}</span>
                {!g.prs[0].repoId && <span className="rounded border border-line px-1 text-[10px] font-normal" title="Opening a PR clones this repo and adds it as a project">not added</span>}
              </div>
              {g.prs.map((p) => (
                <PrRow key={key(p)} pr={p} selected={selected === key(p)} opening={opening === key(p)} onSelect={() => setSelected(key(p))} onOpen={() => void open(p)} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function PrRow({ pr, selected, opening, onSelect, onOpen }: { pr: InboxPr; selected: boolean; opening: boolean; onSelect: () => void; onOpen: () => void }) {
  const ws = useStore((s) => (pr.workspaceId ? s.workspaces.find((w) => w.id === pr.workspaceId) : undefined))
  const openLabel = ws ? `Go to workspace ${ws.title}` : pr.repoId ? 'Open a workspace on this PR' : `Clone ${pr.repo} and open a workspace on this PR`
  return (
    <div
      id={`pr-${pr.repo}#${pr.number}`}
      role="button"
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group flex items-center gap-3 rounded-md px-2 py-2 ${selected ? 'bg-raised' : 'hover:bg-hover'}`}
    >
      <IconPR className={`shrink-0 ${pr.isDraft ? 'text-faint' : 'text-add'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate">{pr.title}</span>
          {pr.isDraft && <span className="shrink-0 rounded border border-line px-1 text-[10px] text-faint">Draft</span>}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-faint">
          <span>#{pr.number}</span>
          <span>·</span>
          <span>{pr.author}</span>
          <span>·</span>
          <span>{ago(pr.updatedAt)}</span>
          <span>·</span>
          <span className="text-add">+{pr.additions}</span>
          <span className="text-del">−{pr.deletions}</span>
          <Checks state={pr.checks} />
          <Decision value={pr.reviewDecision} />
          {pr.roles.includes('review') && pr.roles.includes('mine') && <span>· yours, review requested</span>}
          {ws && (
            <span className="text-accent" title={`Open in workspace ${ws.title}`}>
              · workspace open
            </span>
          )}
        </div>
      </div>
      <button
        className={`shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg ${selected ? '' : 'invisible group-hover:visible'}`}
        title="Open on GitHub"
        onClick={(e) => {
          e.stopPropagation()
          void window.api.openExternal(pr.url)
        }}
      >
        <IconGithub />
      </button>
      <button
        className={`flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-50 ${selected || opening ? 'text-fg' : 'invisible text-muted group-hover:visible'}`}
        title={openLabel}
        disabled={opening}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {opening ? 'Opening…' : ws ? 'Go' : 'Open'}
        <IconRight width={14} height={14} />
      </button>
    </div>
  )
}

function Checks({ state }: { state: string | null }) {
  if (!state) return null
  const [cls, label] = state === 'SUCCESS' ? ['bg-add', 'Checks passed'] : state === 'FAILURE' || state === 'ERROR' ? ['bg-del', 'Checks failed'] : ['bg-amber-400', 'Checks running']
  return (
    <span className="flex items-center gap-1" title={label}>
      <span>·</span>
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
    </span>
  )
}

function Decision({ value }: { value: string | null }) {
  if (value === 'APPROVED') return <span className="text-add">· Approved</span>
  if (value === 'CHANGES_REQUESTED') return <span className="text-del">· Changes requested</span>
  return null
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
