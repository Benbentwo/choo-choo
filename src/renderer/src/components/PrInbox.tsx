import { useEffect, useMemo, useRef, useState } from 'react'
import { groupByRepo, isReviewing, matchesFilter, orgsAndRepos, visiblePrs, type InboxPr, type PrFilter } from '@shared/prInbox'
import { createPortal } from 'react-dom'
import { NO_FILTERS, REVIEW, STATUS, UPDATED, activeCount, applyPrFilters, buttonLabel, toggleValue, valuesWithCounts, type Option, type PrFilters } from '@shared/prFilters'
import { useStore, refreshPrInbox, openPrWorkspace, reportError, setPrReposCollapsed } from '../store'
import { IconDown, IconGear, IconGithub, IconPR, IconRight, IconSidebar } from '../icons'

const FILTER_KEY = 'prs-filter'
const FILTERS: { id: PrFilter; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'updated', label: 'Updated for you' },
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
  const allPrs = s.prInbox?.prs ?? []
  const hidden = s.settings.prsHidden ?? []
  const shown = useMemo(() => visiblePrs(allPrs, hidden), [allPrs, hidden])
  const filters = s.prsFilters
  const prs = useMemo(() => applyPrFilters(shown, filters), [shown, filters])
  const setFilters = (next: Partial<PrFilters>) => s.set({ prsFilters: { ...useStore.getState().prsFilters, ...next } })
  const filtering = activeCount(filters) > 0
  const groups = useMemo(() => groupByRepo(prs, filter), [prs, filter])
  const collapsed = s.settings.prsCollapsed ?? []
  const flat = groups.filter((g) => !collapsed.includes(g.repo)).flatMap((g) => g.prs)
  const folded = (repo: string) => collapsed.includes(repo)
  const key = (p: InboxPr) => `${p.repo}#${p.number}`
  const counts: Record<PrFilter, number> = { review: prs.filter(isReviewing).length, updated: prs.filter((p) => matchesFilter(p, 'updated')).length, mine: prs.filter((p) => p.roles.includes('mine')).length, all: prs.length }
  const fresh = prs.filter((p) => p.update?.fresh)

  // Keep the list live while the page is open, and look at GitHub as soon as it opens.
  useEffect(() => {
    void refreshPrInbox()
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
      <div className="mx-auto flex min-h-0 w-full max-w-[52rem] flex-1 flex-col px-6 pt-6">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="flex-1 text-[20px] font-[650] tracking-[-0.02em] whitespace-nowrap">Pull requests</h1>
          <div className="flex shrink-0 rounded-md border border-line text-[12px] whitespace-nowrap">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => pick(f.id)} className={`px-2.5 py-1 first:rounded-l-md last:rounded-r-md ${filter === f.id ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}>
                {f.label}
                <span className={`ml-1.5 ${f.id === 'updated' && counts.updated ? 'text-accent' : 'text-faint'}`}>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {fresh.length > 0 && (
            <button className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] whitespace-nowrap text-muted hover:bg-hover hover:text-fg" title="Clear the marks on PRs that changed for you" onClick={() => void markSeen(fresh)}>
              Mark all seen
            </button>
          )}
          <button className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50" disabled={s.prInboxLoading} onClick={() => void refreshPrInbox()} title="Reload from GitHub">
            {s.prInboxLoading ? 'Loading…' : 'Refresh'}
          </button>
          <WatchSettings prs={allPrs} hidden={hidden} />
        </div>
        <FilterRow prs={shown} filters={filters} setFilters={setFilters} />
        {s.prInboxError && (
          <div className="selectable mb-3 rounded-lg border border-del/40 px-3 py-2 text-[12px] text-muted">
            {s.prInboxError}
            {s.prInbox && <div className="mt-0.5 text-faint">Showing the list from {new Date(s.prInbox.fetchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</div>}
          </div>
        )}
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8 outline-none" tabIndex={0} onKeyDown={onKey}>
          {!s.prInbox && s.prInboxLoading && <div className="py-10 text-center text-muted">Loading pull requests…</div>}
          {s.prInbox && groups.length === 0 && filtering && (
            <div className="py-10 text-center text-muted">
              No pull requests match these filters.{' '}
              <button className="text-accent hover:underline" onClick={() => s.set({ prsFilters: NO_FILTERS })}>
                Reset filters
              </button>
            </div>
          )}
          {s.prInbox && groups.length === 0 && !filtering && (
            <div className="py-10 text-center text-muted">{filter === 'review' ? 'Nothing waiting on your review.' : filter === 'updated' ? 'Nothing changed for you since you last looked.' : filter === 'mine' ? 'You have no open pull requests.' : 'No open pull requests.'}</div>
          )}
          {groups.map((g) => (
            <section key={g.repo} className={folded(g.repo) ? 'mb-1' : 'mb-5'}>
              <button
                className="group/repo mb-1 flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-[12px] font-medium text-faint hover:bg-hover"
                aria-expanded={!folded(g.repo)}
                title={`${folded(g.repo) ? 'Show' : 'Hide'} this repo's PRs. Option-click to ${folded(g.repo) ? 'show' : 'hide'} every repo.`}
                onClick={(e) => setPrReposCollapsed(e.altKey ? groups.map((x) => x.repo) : g.repo, !folded(g.repo))}
              >
                <IconDown width={12} height={12} className={`-ml-0.5 shrink-0 text-muted transition-transform ${folded(g.repo) ? '-rotate-90' : ''}`} />
                <img src={`https://avatars.githubusercontent.com/${g.repo.split('/')[0]}?s=40`} alt="" className="h-4 w-4 rounded-[4px] bg-raised" />
                <span className="text-muted group-hover/repo:text-fg">{g.repo}</span>
                <span className={folded(g.repo) && g.prs.some((p) => p.update?.fresh) ? 'text-accent' : ''} title={folded(g.repo) && g.prs.some((p) => p.update?.fresh) ? 'Some of these PRs changed for you' : undefined}>
                  {g.prs.length}
                </span>
                {!g.prs[0].repoId && <span className="rounded border border-line px-1 text-[10px] font-normal" title="Opening a PR clones this repo and adds it as a project">not added</span>}
              </button>
              {!folded(g.repo) &&
                g.prs.map((p) => (
                  <PrRow key={key(p)} pr={p} selected={selected === key(p)} opening={opening === key(p)} onSelect={() => setSelected(key(p))} onOpen={() => void open(p)} onAuthor={() => setFilters({ authors: filters.authors.includes(p.author) ? filters.authors : [...filters.authors, p.author] })} />
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function PrRow({ pr, selected, opening, onSelect, onOpen, onAuthor }: { pr: InboxPr; selected: boolean; opening: boolean; onSelect: () => void; onOpen: () => void; onAuthor: () => void }) {
  const ws = useStore((s) => (pr.workspaceId ? s.workspaces.find((w) => w.id === pr.workspaceId) : undefined))
  const openLabel = ws ? `Go to workspace ${ws.title}` : pr.repoId ? 'Open a workspace on this PR' : `Clone ${pr.repo} and open a workspace on this PR`
  const u = pr.update
  const fresh = !!u?.fresh
  const quiet = !!u && !u.reasons.length && !!u.quiet
  return (
    <div
      id={`pr-${pr.repo}#${pr.number}`}
      role="button"
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group relative flex items-center gap-3 rounded-md px-2 py-2 ${selected ? 'bg-raised' : 'hover:bg-hover'}`}
    >
      {fresh && <span className="absolute top-[13px] -left-2.5 h-1.5 w-1.5 rounded-full bg-accent" title="Changed for you since you last looked" />}
      <IconPR className={`shrink-0 ${pr.isDraft ? 'text-faint' : 'text-add'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate ${fresh ? 'font-semibold' : quiet ? 'text-muted' : ''}`}>{pr.title}</span>
          {pr.isDraft && <span className="shrink-0 rounded border border-line px-1 text-[10px] text-faint">Draft</span>}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-faint">
          <span>#{pr.number}</span>
          <span>·</span>
          <button
            className="hover:text-fg hover:underline"
            title={`Show only PRs by ${pr.author} for now`}
            onClick={(e) => {
              e.stopPropagation()
              onAuthor()
            }}
          >
            {pr.author}
          </button>
          <span>·</span>
          <span>{ago(pr.updatedAt)}</span>
          <span>·</span>
          <span className="text-add">+{pr.additions}</span>
          <span className="text-del">−{pr.deletions}</span>
          <Checks state={pr.checks} />
          <Decision value={pr.reviewDecision} />
          {u?.myReview && <span>· {MY_REVIEW[u.myReview] ?? 'You reviewed'}</span>}
          {pr.roles.includes('review') && pr.roles.includes('mine') && <span>· yours, review requested</span>}
          {ws && (
            <span className="text-accent" title={`Open in workspace ${ws.title}`}>
              · workspace open
            </span>
          )}
        </div>
        {u && (u.reasons.length > 0 || u.quiet) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {u.reasons.map((r) => (
              <span key={r.kind} className={`rounded-full px-2 text-[11px] leading-[18px] ${r.kind === 'reply' ? 'bg-sky-400/15 text-sky-400' : 'bg-accent/15 text-accent'}`}>
                {r.label}
              </span>
            ))}
            {!u.reasons.length && u.quiet && <span className="rounded-full bg-raised px-2 text-[11px] leading-[18px] text-faint">quiet update: {u.quiet}</span>}
          </div>
        )}
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
        className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[12px] disabled:opacity-50 ${fresh ? 'border-fg bg-fg font-semibold text-bg hover:opacity-90' : `border-line hover:bg-hover ${selected || opening ? 'text-fg' : 'invisible text-muted group-hover:visible'}`}`}
        title={openLabel}
        disabled={opening}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {opening ? 'Opening…' : fresh ? 'Review changes' : ws ? 'Go' : 'Open'}
        <IconRight width={14} height={14} />
      </button>
    </div>
  )
}

const MY_REVIEW: Record<string, string> = { APPROVED: 'You approved', CHANGES_REQUESTED: 'You requested changes', COMMENTED: 'You commented', DISMISSED: 'Your review was dismissed' }

/** Clears the "changed for you" mark on these PRs. */
async function markSeen(prs: InboxPr[]) {
  try {
    await window.api.reviewsSeen(prs.map((p) => `${p.repo}#${p.number}`))
  } catch (e) {
    reportError(e)
  }
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

/** Tick boxes for each org and its repos. Unticking hides them from the PRs page on this computer. */
function RepoFilter({ prs, hidden }: { prs: InboxPr[]; hidden: string[] }) {
  const orgs = useMemo(() => orgsAndRepos(prs), [prs])
  const lower = new Set(hidden.map((h) => h.toLowerCase()))
  const save = async (next: string[]) => {
    try {
      useStore.getState().set({ settings: await window.api.saveSettings({ prsHidden: next }) })
    } catch (e) {
      reportError(e)
    }
  }
  const toggle = (name: string, show: boolean) => {
    const others = hidden.filter((h) => h.toLowerCase() !== name.toLowerCase())
    void save(show ? others : [...others, name])
  }
  const toggleOrg = (org: string, repos: string[], show: boolean) => {
    // Showing an org also clears hides on its repos; hiding it needs only the org entry.
    const inOrg = new Set([org, ...repos].map((x) => x.toLowerCase()))
    const others = hidden.filter((h) => !inOrg.has(h.toLowerCase()))
    void save(show ? others : [...others, org])
  }
  return (
    <div className="max-h-[60vh] w-80 overflow-y-auto p-2 text-[12px]">
      <div className="px-1 font-medium text-fg">Repos to watch</div>
      <div className="mb-2 px-1 text-faint">Unticked orgs and repos never show here or in the sidebar count. Saved on this computer only.</div>
      {orgs.length === 0 && <div className="px-1 py-2 text-faint">No pull requests loaded yet.</div>}
      {orgs.map((o) => {
        const orgShown = !lower.has(o.org.toLowerCase())
        return (
          <div key={o.org} className="mb-1">
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-hover">
              <input type="checkbox" checked={orgShown} onChange={(e) => toggleOrg(o.org, o.repos.map((r) => r.repo), e.target.checked)} />
              <span className="flex-1 font-medium">{o.org}</span>
              <span className="text-faint">{o.count}</span>
            </label>
            {orgShown &&
              o.repos.map((r) => (
                <label key={r.repo} className="flex cursor-pointer items-center gap-2 rounded py-0.5 pr-1 pl-6 hover:bg-hover">
                  <input type="checkbox" checked={!lower.has(r.repo.toLowerCase())} onChange={(e) => toggle(r.repo, e.target.checked)} />
                  <span className="flex-1 truncate text-muted">{r.repo.split('/')[1]}</span>
                  <span className="text-faint">{r.count}</span>
                </label>
              ))}
          </div>
        )
      })}
      {hidden.length > 0 && (
        <button className="mt-1 w-full rounded px-1 py-1 text-left text-muted hover:bg-hover hover:text-fg" onClick={() => void save([])}>
          Show everything
        </button>
      )}
    </div>
  )
}


/** A menu drawn on top of everything, under its button, closed by a click outside or Escape. */
function Popover({ anchor, align = 'left', onClose, children }: { anchor: HTMLElement; align?: 'left' | 'right'; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const r = anchor.getBoundingClientRect()
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])
  return createPortal(
    <div
      ref={box}
      className="no-drag fixed z-50 rounded-lg border border-line bg-raised shadow-xl"
      style={{ top: r.bottom + 4, ...(align === 'right' ? { right: window.innerWidth - r.right } : { left: r.left }) }}
    >
      {children}
    </div>,
    document.body
  )
}

/** The cogwheel at the top right: which orgs and repos this computer watches (Settings.prsHidden). */
function WatchSettings({ prs, hidden }: { prs: InboxPr[]; hidden: string[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        className={`relative rounded-md border border-line p-1.5 hover:bg-hover hover:text-fg ${anchor ? 'bg-hover text-fg' : 'text-muted'}`}
        title={hidden.length ? `Repos to watch on this computer (${hidden.length} hidden)` : 'Repos to watch on this computer'}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <IconGear width={14} height={14} />
        {hidden.length > 0 && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
      {anchor && (
        <Popover anchor={anchor} align="right" onClose={() => setAnchor(null)}>
          <RepoFilter prs={prs} hidden={hidden} />
        </Popover>
      )}
    </>
  )
}

/** The row of temporary filter dropdowns under the title, with Reset when any is set. */
function FilterRow({ prs, filters, setFilters }: { prs: InboxPr[]; filters: PrFilters; setFilters: (f: Partial<PrFilters>) => void }) {
  const repos = useMemo(() => valuesWithCounts(prs, (p) => p.repo), [prs])
  const authors = useMemo(() => valuesWithCounts(prs, (p) => p.author), [prs])
  const count = (o: Option) => prs.filter((p) => o.test(p, Date.now())).length
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
      <Dropdown label={buttonLabel('Repo', filters.repos)} active={filters.repos.length > 0}>
        {repos.map((r) => (
          <Check key={r.value} on={filters.repos.includes(r.value)} label={r.value} count={r.count} onClick={() => setFilters({ repos: toggleValue(filters.repos, r.value) })} />
        ))}
      </Dropdown>
      <Dropdown label={buttonLabel('Author', filters.authors)} active={filters.authors.length > 0} search>
        {(q: string) =>
          authors
            .filter((a) => a.value.toLowerCase().includes(q.toLowerCase()))
            .map((a) => <Check key={a.value} on={filters.authors.includes(a.value)} label={a.value} count={a.count} onClick={() => setFilters({ authors: toggleValue(filters.authors, a.value) })} />)
        }
      </Dropdown>
      <Dropdown label={buttonLabel('Review', filters.review, REVIEW)} active={filters.review.length > 0}>
        {REVIEW.map((o) => (
          <Check key={o.id} on={filters.review.includes(o.id)} label={o.label} count={count(o)} onClick={() => setFilters({ review: toggleValue(filters.review, o.id) })} />
        ))}
      </Dropdown>
      <Dropdown label={buttonLabel('Status', filters.status, STATUS)} active={filters.status.length > 0}>
        {STATUS.map((o) => (
          <Check key={o.id} on={filters.status.includes(o.id)} label={o.label} count={count(o)} onClick={() => setFilters({ status: toggleValue(filters.status, o.id) })} />
        ))}
      </Dropdown>
      <Dropdown label={buttonLabel('Updated', filters.updated ? [filters.updated] : [], UPDATED)} active={!!filters.updated}>
        {UPDATED.map((o) => (
          <Check key={o.id} radio on={filters.updated === o.id} label={o.label} count={count(o)} onClick={() => setFilters({ updated: filters.updated === o.id ? null : o.id })} />
        ))}
      </Dropdown>
      {activeCount(filters) > 0 && (
        <button className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg" title="Clear the filters" onClick={() => setFilters(NO_FILTERS)}>
          Reset
        </button>
      )}
    </div>
  )
}

function Dropdown({ label, active, search, children }: { label: string; active: boolean; search?: boolean; children: React.ReactNode | ((q: string) => React.ReactNode) }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [q, setQ] = useState('')
  return (
    <>
      <button
        className={`flex items-center gap-1 rounded-md border px-2 py-1 whitespace-nowrap ${active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg'} ${anchor ? 'bg-hover' : ''}`}
        onClick={(e) => {
          setQ('')
          setAnchor(anchor ? null : e.currentTarget)
        }}
      >
        {label}
        <IconDown width={12} height={12} className="opacity-70" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="max-h-[50vh] w-60 overflow-y-auto p-1 text-[12px]">
            {search && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person…" className="mb-1 w-full rounded border border-line bg-transparent px-2 py-1 outline-none placeholder:text-faint focus:border-muted" />}
            {typeof children === 'function' ? children(q) : children}
          </div>
        </Popover>
      )}
    </>
  )
}

function Check({ on, label, count, radio, onClick }: { on: boolean; label: string; count: number; radio?: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover" onClick={onClick}>
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border text-[10px] ${radio ? 'rounded-full' : 'rounded-[3px]'} ${on ? 'border-accent bg-accent text-bg' : 'border-line'}`}>{on ? (radio ? '•' : '✓') : ''}</span>
      <span className={`flex-1 truncate ${on ? 'text-fg' : 'text-muted'}`}>{label}</span>
      <span className="text-faint">{count}</span>
    </button>
  )
}
