import { useEffect, useMemo, useRef, useState } from 'react'
import { groupByRepo, isReviewing, matchesFilter, orgsAndRepos, visiblePrs, type InboxPr, type PrFilter } from '@shared/prInbox'
import { addQuickFilter, applyQuickFilters, parseQuickFilter, quickFilterLabel, suggestQuickFilters, type QuickFilter } from '@shared/prFilters'
import { useStore, refreshPrInbox, openPrWorkspace, reportError, setPrReposCollapsed } from '../store'
import { IconDown, IconGithub, IconPR, IconRight, IconSidebar } from '../icons'

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
  const quick = s.prsQuick
  const prs = useMemo(() => applyQuickFilters(shown, quick), [shown, quick])
  const setQuick = (next: QuickFilter[]) => s.set({ prsQuick: next })
  const [filterMenu, setFilterMenu] = useState(false)
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
        </div>
        <RepoBar prs={allPrs} hidden={hidden} menu={filterMenu} setMenu={setFilterMenu} />
        <QuickBar prs={shown} quick={quick} setQuick={setQuick} />
        {s.prInboxError && (
          <div className="selectable mb-3 rounded-lg border border-del/40 px-3 py-2 text-[12px] text-muted">
            {s.prInboxError}
            {s.prInbox && <div className="mt-0.5 text-faint">Showing the list from {new Date(s.prInbox.fetchedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</div>}
          </div>
        )}
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8 outline-none" tabIndex={0} onKeyDown={onKey}>
          {!s.prInbox && s.prInboxLoading && <div className="py-10 text-center text-muted">Loading pull requests…</div>}
          {s.prInbox && groups.length === 0 && quick.length > 0 && (
            <div className="py-10 text-center text-muted">
              No pull requests match these filters.{' '}
              <button className="text-accent hover:underline" onClick={() => setQuick([])}>
                Reset filters
              </button>
            </div>
          )}
          {s.prInbox && groups.length === 0 && !quick.length && (
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
                  <PrRow key={key(p)} pr={p} selected={selected === key(p)} opening={opening === key(p)} onSelect={() => setSelected(key(p))} onOpen={() => void open(p)} onAuthor={() => setQuick(addQuickFilter(quick, { kind: 'author', value: p.author }))} />
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
function RepoFilter({ prs, hidden, onClose }: { prs: InboxPr[]; hidden: string[]; onClose: () => void }) {
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
    <div className="absolute top-8 right-0 z-30 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-line bg-raised p-2 text-[12px] shadow-xl" onMouseLeave={onClose}>
      <div className="mb-1.5 px-1 text-faint">Show PRs from. Saved on this computer only.</div>
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

/**
 * The saved org and repo hiding (Settings.prsHidden), shown on the page: a pill per org to hide or show
 * it, a chip per hidden repo, and Edit for the full list.
 */
function RepoBar({ prs, hidden, menu, setMenu }: { prs: InboxPr[]; hidden: string[]; menu: boolean; setMenu: (on: boolean) => void }) {
  const orgs = useMemo(() => orgsAndRepos(prs), [prs])
  const lower = hidden.map((h) => h.toLowerCase())
  const save = async (next: string[]) => {
    try {
      useStore.getState().set({ settings: await window.api.saveSettings({ prsHidden: next }) })
    } catch (e) {
      reportError(e)
    }
  }
  const hiddenRepos = hidden.filter((h) => h.includes('/'))
  if (!orgs.length && !hidden.length) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]" title="Orgs and repos to show here. Saved on this computer only.">
      <span className="mr-0.5 text-faint">Repos</span>
      {orgs.map((o) => {
        const off = lower.includes(o.org.toLowerCase())
        return (
          <button
            key={o.org}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${off ? 'border-dashed border-line text-faint line-through hover:text-muted' : 'border-line text-muted hover:bg-hover hover:text-fg'}`}
            title={off ? `Show PRs from ${o.org} again` : `Hide PRs from ${o.org} on this computer`}
            onClick={() => void save(off ? hidden.filter((h) => h.toLowerCase() !== o.org.toLowerCase()) : [...hidden, o.org])}
          >
            <img src={`https://avatars.githubusercontent.com/${o.org}?s=40`} alt="" className={`h-3.5 w-3.5 rounded-[3px] bg-raised ${off ? 'opacity-40' : ''}`} />
            {o.org}
            <span className="text-faint no-underline">{o.count}</span>
          </button>
        )
      })}
      {hiddenRepos.map((r) => (
        <button key={r} className="rounded-full border border-dashed border-line px-2 py-0.5 text-faint hover:text-fg" title={`Show PRs from ${r} again`} onClick={() => void save(hidden.filter((h) => h !== r))}>
          <span className="line-through">{r}</span> ×
        </button>
      ))}
      <div className="relative">
        <button className="rounded-full px-2 py-0.5 text-muted hover:bg-hover hover:text-fg" onClick={() => setMenu(!menu)}>
          Edit…
        </button>
        {menu && <RepoFilter prs={prs} hidden={hidden} onClose={() => setMenu(false)} />}
      </div>
    </div>
  )
}

/**
 * Temporary filters: chips plus a box that takes "by alice", "repo:web", "drafts" or any words
 * from a title. Kept in memory while you switch pages; Reset clears them.
 */
function QuickBar({ prs, quick, setQuick }: { prs: InboxPr[]; quick: QuickFilter[]; setQuick: (f: QuickFilter[]) => void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const suggestions = useMemo(() => {
    const typed = parseQuickFilter(text, prs)
    const list = suggestQuickFilters(text, prs).filter((f) => !quick.some((q) => q.kind === f.kind && q.value === f.value))
    if (typed && !list.some((f) => f.kind === typed.kind && f.value.toLowerCase() === typed.value.toLowerCase())) list.unshift(typed)
    return text.trim() ? list : list.slice(0, 8)
  }, [text, prs, quick])
  const add = (f: QuickFilter | null | undefined) => {
    if (!f) return
    setQuick(addQuickFilter(quick, f))
    setText('')
    setActive(0)
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.max(0, Math.min(suggestions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      add(open && suggestions[active] ? suggestions[active] : parseQuickFilter(text, prs))
    } else if (e.key === 'Backspace' && !text && quick.length) {
      setQuick(quick.slice(0, -1))
    } else if (e.key === 'Escape') {
      if (text) setText('')
      else {
        setOpen(false)
        input.current?.blur()
      }
    }
  }
  const kindLabel: Record<QuickFilter['kind'], string> = { author: 'Author', repo: 'Repo', status: 'Status', text: 'Title has' }
  return (
    <div className="relative mb-3 flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] focus-within:border-muted" onClick={() => input.current?.focus()}>
      {quick.map((f, i) => (
        <span key={`${f.kind}:${f.value}`} className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 py-0.5 pr-1 pl-2 text-accent">
          {quickFilterLabel(f)}
          <button className="rounded-full px-1 hover:bg-accent/20" title="Remove this filter" onClick={() => setQuick(quick.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <input
        ref={input}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        placeholder={quick.length ? 'Add a filter…' : 'Filter for now: by a person, repo:name, drafts, failing, or words in a title'}
        className="min-w-[10rem] flex-1 bg-transparent py-0.5 outline-none placeholder:text-faint"
      />
      {quick.length > 0 && (
        <button className="shrink-0 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-fg" title="Clear the temporary filters" onClick={() => setQuick([])}>
          Reset
        </button>
      )}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-line bg-raised p-1 shadow-xl">
          {suggestions.map((f, i) => (
            <button
              key={`${f.kind}:${f.value}`}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${i === active ? 'bg-hover text-fg' : 'text-muted'}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                add(f)
              }}
            >
              <span className="w-16 shrink-0 text-faint">{kindLabel[f.kind]}</span>
              <span className="truncate">{f.kind === 'status' ? quickFilterLabel(f) : f.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
