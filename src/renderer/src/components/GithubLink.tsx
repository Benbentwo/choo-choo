import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { githubLinkLabel, isBareLink, parseGithubLink, previewDot, shortAge, type GithubLink, type LinkPreview } from '@shared/githubLink'
import { prBranch, type InboxPr } from '@shared/prInbox'
import { workspaceForIssue, workspaceForPr } from '@shared/workspaceFor'
import type { LinkPreviewResult } from '@shared/types'
import { openPrWorkspace, refreshState, reportError, useStore } from '../store'
import { IconCheck, IconCopy, IconFile, IconGithub, IconMerged, IconPR, IconRefresh, IconRepo } from '../icons'

/**
 * GitHub links in chat: a short pill (`repo#12 ●`) in place of a bare URL, and a small card that
 * floats beside any GitHub link after a short hover. Nothing moves until you hover; the card stays
 * open while the pointer is on it. Data comes from gh through the main process (cached there).
 */

const HOVER_DELAY = 400
const CLOSE_DELAY = 180
const CARD_WIDTH = 320
/** Results the renderer has already seen, so pills of the same link share one ask. */
const TTL = 3 * 60_000

type Slot = { at: number; result?: LinkPreviewResult; error?: string; pending?: Promise<void> }
const slots = new Map<string, Slot>()
const listeners = new Map<string, Set<() => void>>()

function notify(url: string) {
  listeners.get(url)?.forEach((f) => f())
}

function load(url: string, fresh = false) {
  const s = slots.get(url)
  if (!fresh && s && (s.pending || Date.now() - s.at < TTL)) return
  if (!window.api?.linkPreview) return
  const pending = window.api.linkPreview(url, fresh).then(
    (result) => void slots.set(url, { at: Date.now(), result }),
    (e) => void slots.set(url, { at: Date.now(), error: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  )
  slots.set(url, { ...(s ?? { at: 0 }), pending: pending.finally(() => notify(url)) })
  notify(url)
}

/** The preview for a link, asked for once `active` turns true. */
function usePreview(url: string, active: boolean): Slot | undefined {
  const [, bump] = useState(0)
  useEffect(() => {
    const set = listeners.get(url) ?? new Set()
    const f = () => bump((n) => n + 1)
    set.add(f)
    listeners.set(url, set)
    return () => void set.delete(f)
  }, [url])
  useEffect(() => {
    if (active) load(url)
  }, [url, active])
  return slots.get(url)
}

function textOf(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (children && typeof children === 'object' && 'props' in children) return textOf((children as { props: { children?: ReactNode } }).props.children)
  return ''
}

const DOT: Record<string, string> = {
  open: 'bg-add',
  draft: 'bg-faint',
  merged: 'bg-violet-400',
  closed: 'bg-del',
  completed: 'bg-violet-400',
  not_planned: 'bg-faint',
}
const STATE_TEXT: Record<string, string> = {
  open: 'text-add border-add/40 bg-add/10',
  draft: 'text-muted border-line bg-raised',
  merged: 'text-violet-400 border-violet-400/40 bg-violet-400/10',
  closed: 'text-del border-del/40 bg-del/10',
  completed: 'text-violet-400 border-violet-400/40 bg-violet-400/10',
  not_planned: 'text-muted border-line bg-raised',
}
const STATE_LABEL: Record<string, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed', completed: 'Closed', not_planned: 'Not planned' }

const IconIssue = (p: ComponentProps<'svg'>) => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
)
const IconCommit = (p: ComponentProps<'svg'>) => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M3 12h5.5M15.5 12H21" />
  </svg>
)

function KindIcon({ link, preview, className }: { link: GithubLink; preview?: LinkPreview; className?: string }) {
  const p = { width: 13, height: 13, className }
  if (link.kind === 'pr' || preview?.kind === 'pr') return preview?.kind === 'pr' && preview.state === 'merged' ? <IconMerged {...p} /> : <IconPR {...p} />
  if (link.kind === 'issue') return <IconIssue {...p} />
  if (link.kind === 'commit') return <IconCommit {...p} />
  if (link.kind === 'file') return <IconFile {...p} />
  return <IconRepo {...p} />
}

/** react-markdown's `a`: GitHub links get the pill and the hover card; every other link is left alone. */
export function ChatLink(props: ComponentProps<'a'> & { node?: unknown }) {
  const { node: _node, href, children, ...rest } = props
  const enabled = useStore((s) => s.settings.githubLinkPreviews !== false)
  const link = enabled ? parseGithubLink(href) : null
  if (!link || !href) return <a href={href} {...rest}>{children}</a>
  return <GithubAnchor link={link} href={href} bare={isBareLink(textOf(children), href)} rest={rest}>{children}</GithubAnchor>
}

function GithubAnchor({ link, href, bare, rest, children }: { link: GithubLink; href: string; bare: boolean; rest: ComponentProps<'a'>; children: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [visible, setVisible] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const openTimer = useRef<number>(0)
  const closeTimer = useRef<number>(0)
  // Pills show a state dot, so PRs and issues load once they scroll into view; other links on hover.
  const wantsDot = bare && (link.kind === 'pr' || link.kind === 'issue')
  const slot = usePreview(href, visible || !!anchor)
  const preview = slot?.result?.preview

  useEffect(() => {
    if (!wantsDot || !ref.current) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setVisible(true), io.disconnect()))
    io.observe(ref.current)
    return () => io.disconnect()
  }, [wantsDot])

  useEffect(() => () => (clearTimeout(openTimer.current), clearTimeout(closeTimer.current)), [])

  const enter = (e: React.MouseEvent) => {
    clearTimeout(closeTimer.current)
    if (anchor) return
    const x = e.clientX
    const y = e.clientY
    load(href)
    openTimer.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      // A link that wraps has a box per line; place the card by the line under the pointer.
      const rects = Array.from(el.getClientRects())
      setAnchor(rects.find((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) ?? el.getBoundingClientRect())
    }, HOVER_DELAY)
  }
  const leave = () => {
    clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(() => setAnchor(null), CLOSE_DELAY)
  }

  const dot = previewDot(preview)
  return (
    <>
      <a
        ref={ref}
        href={href}
        {...rest}
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={bare ? 'gh-pill' : undefined}
        title={undefined}
        data-gh-link={link.kind}
      >
        {bare ? (
          <>
            <KindIcon link={link} preview={preview} className="gh-pill-icon" />
            <span>{githubLinkLabel(link)}</span>
            {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[dot]}`} aria-label={STATE_LABEL[dot]} />}
          </>
        ) : (
          children
        )}
      </a>
      {anchor &&
        createPortal(
          <PreviewCard
            link={link}
            href={href}
            slot={slot}
            anchor={anchor}
            onEnter={() => clearTimeout(closeTimer.current)}
            onLeave={leave}
            onClose={() => setAnchor(null)}
          />,
          document.body
        )}
    </>
  )
}

function PreviewCard({ link, href, slot, anchor, onEnter, onLeave, onClose }: { link: GithubLink; href: string; slot?: Slot; anchor: DOMRect; onEnter: () => void; onLeave: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const result = slot?.result
  const p = result?.preview

  // Below the link when it fits, above otherwise; never past the window's edges.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 160
    const below = anchor.bottom + 6
    const top = below + h > window.innerHeight - 8 && anchor.top - 6 - h > 8 ? anchor.top - 6 - h : Math.min(below, window.innerHeight - 8 - h)
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - 8))
    setPos({ left, top: Math.max(8, top) })
  }, [anchor, p, slot?.error])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // The card is placed for where the link was; scrolling the chat moves the link away from it.
    const scroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Link preview"
      className="gh-card fixed z-[1000] rounded-lg border border-line bg-panel text-[12.5px] leading-snug text-fg shadow-2xl"
      style={{ width: CARD_WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="px-3 pt-2.5 pb-2">
        {p ? <Body p={p} /> : slot?.error ? <Failed link={link} error={slot.error} /> : <Loading link={link} />}
      </div>
      <Actions link={link} href={href} result={result} onDone={onClose} />
    </div>
  )
}

function Header({ icon, repo, id, state }: { icon: ReactNode; repo: string; id?: string; state?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
      {icon}
      <span className="min-w-0 truncate">
        {repo}
        {id && <span className="text-faint"> {id}</span>}
      </span>
      {state && <span className={`ml-auto shrink-0 rounded-full border px-1.5 py-px text-[10.5px] font-medium ${STATE_TEXT[state]}`}>{STATE_LABEL[state]}</span>}
    </div>
  )
}

function Byline({ who, avatar, when, verb }: { who: string; avatar?: string; when: string; verb: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
      {avatar && <img src={`${avatar}${avatar.includes('?') ? '&' : '?'}s=32`} alt="" className="h-4 w-4 rounded-full" />}
      <span className="text-muted">{who}</span>
      {when && <span>· {verb} {shortAge(when)}</span>}
    </div>
  )
}

function Stat({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}>{children}</span>
}

function Body({ p }: { p: LinkPreview }) {
  switch (p.kind) {
    case 'pr': {
      const c = p.checks
      return (
        <>
          <Header icon={p.state === 'merged' ? <IconMerged width={13} height={13} className="text-violet-400" /> : <IconPR width={13} height={13} className={p.state === 'open' ? 'text-add' : p.state === 'closed' ? 'text-del' : 'text-faint'} />} repo={p.repo} id={`#${p.number}`} state={p.state} />
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold">{p.title}</div>
          <Byline who={p.author} avatar={p.avatar} when={p.updatedAt} verb="updated" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            {c && (
              <Stat className={c.state === 'success' ? 'text-add' : c.state === 'failure' ? 'text-del' : 'text-amber-400'}>
                <span className={`h-1.5 w-1.5 rounded-full ${c.state === 'success' ? 'bg-add' : c.state === 'failure' ? 'bg-del' : 'animate-pulse bg-amber-400'}`} />
                {c.state === 'success' ? `${c.passed} checks passed` : c.state === 'failure' ? `${c.failed} of ${c.total} checks failed` : `${c.pending} of ${c.total} checks running`}
              </Stat>
            )}
            {p.review && (
              <Stat className={p.review === 'approved' ? 'text-add' : p.review === 'changes_requested' ? 'text-del' : ''}>
                {p.review === 'approved' ? 'Approved' : p.review === 'changes_requested' ? 'Changes requested' : 'Review requested'}
              </Stat>
            )}
            <Stat>
              <span className="text-add">+{p.additions}</span>
              <span className="text-del">−{p.deletions}</span>
              <span className="text-faint">· {p.changedFiles} {p.changedFiles === 1 ? 'file' : 'files'}</span>
            </Stat>
          </div>
          <div className="mt-1.5 truncate font-mono text-[10.5px] text-faint" title={`${p.head} → ${p.base}`}>
            {p.head} → {p.base}
          </div>
        </>
      )
    }
    case 'issue':
      return (
        <>
          <Header icon={<IconIssue width={13} height={13} className={p.state === 'open' ? 'text-add' : p.state === 'completed' ? 'text-violet-400' : 'text-faint'} />} repo={p.repo} id={`#${p.number}`} state={p.state} />
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold">{p.title}</div>
          <Byline who={p.author} avatar={p.avatar} when={p.updatedAt} verb="updated" />
          {(p.labels.length > 0 || p.assignees.length > 0 || p.comments > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              {p.labels.slice(0, 4).map((l) => (
                <span key={l.name} className="rounded-full border px-1.5 py-px" style={{ borderColor: `#${l.color}80`, color: `color-mix(in srgb, #${l.color} 70%, var(--color-fg))`, background: `#${l.color}1f` }}>
                  {l.name}
                </span>
              ))}
              {p.labels.length > 4 && <span className="text-faint">+{p.labels.length - 4}</span>}
              {p.assignees.length > 0 && <span className="ml-auto text-faint">→ {p.assignees.slice(0, 2).join(', ')}{p.assignees.length > 2 ? ` +${p.assignees.length - 2}` : ''}</span>}
            </div>
          )}
        </>
      )
    case 'commit': {
      const [subject, ...more] = p.message.split('\n')
      return (
        <>
          <Header icon={<IconCommit width={13} height={13} className="text-muted" />} repo={p.repo} id={p.sha.slice(0, 7)} />
          <div className="mt-1 line-clamp-2 text-[13px] font-semibold">{subject}</div>
          {more.join('\n').trim() && <div className="mt-0.5 line-clamp-2 text-[11.5px] whitespace-pre-line text-muted">{more.join('\n').trim()}</div>}
          <Byline who={p.author} avatar={p.avatar} when={p.date} verb="committed" />
          <div className="mt-2 flex gap-2 text-[11.5px]">
            <span className="text-add">+{p.additions}</span>
            <span className="text-del">−{p.deletions}</span>
            <span className="text-faint">· {p.files} {p.files === 1 ? 'file' : 'files'}</span>
          </div>
        </>
      )
    }
    case 'file':
      return (
        <>
          <Header icon={<IconFile width={13} height={13} className="text-muted" />} repo={p.repo} id={`@ ${p.ref.length > 12 && /^[0-9a-f]+$/.test(p.ref) ? p.ref.slice(0, 7) : p.ref}`} />
          <div className="mt-1 truncate font-mono text-[11.5px] font-medium" title={p.path}>
            {p.path}
          </div>
          <pre className="mt-1.5 max-h-40 overflow-hidden rounded-md border border-line bg-code px-0 py-1 font-mono text-[11px] leading-[1.45]">
            {p.lines.map((l, i) => (
              <div key={i} className="flex">
                <span className="w-8 shrink-0 pr-2 text-right text-faint select-none">{p.start + i}</span>
                <span className="min-w-0 truncate whitespace-pre">{l || ' '}</span>
              </div>
            ))}
            {p.truncated && <div className="pl-8 text-faint">…</div>}
          </pre>
        </>
      )
    case 'repo':
      return (
        <>
          <Header icon={<IconRepo width={13} height={13} className="text-muted" />} repo={p.repo} id={p.isPrivate ? '· private' : undefined} />
          {p.description && <div className="mt-1 line-clamp-3 text-[12.5px]">{p.description}</div>}
          <div className="mt-2 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
            {p.language && <span>{p.language}</span>}
            <span>★ {p.stars}</span>
            <span>{p.openIssues} open issues and PRs</span>
            {p.updatedAt && <span className="text-faint">pushed {shortAge(p.updatedAt)}</span>}
          </div>
        </>
      )
  }
}

function Loading({ link }: { link: GithubLink }) {
  return (
    <>
      <Header icon={<KindIcon link={link} className="text-faint" />} repo={`${link.owner}/${link.repo}`} id={link.kind === 'pr' || link.kind === 'issue' ? `#${link.number}` : undefined} />
      <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded bg-raised" />
      <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-raised" />
    </>
  )
}

function Failed({ link, error }: { link: GithubLink; error: string }) {
  return (
    <>
      <Header icon={<KindIcon link={link} className="text-faint" />} repo={`${link.owner}/${link.repo}`} id={link.kind === 'pr' || link.kind === 'issue' ? `#${link.number}` : undefined} />
      <div className="mt-1.5 text-[12px] text-muted">No preview: {error}</div>
    </>
  )
}

function Actions({ link, href, result, onDone }: { link: GithubLink; href: string; result?: LinkPreviewResult; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const p = result?.preview
  const canOpen = p?.kind === 'pr' || p?.kind === 'issue'
  // Looked up live, so a workspace opened a moment ago counts even though the preview is cached.
  const workspaces = useStore((s) => s.workspaces)
  const existing = !result?.repoId
    ? undefined
    : p?.kind === 'pr'
      ? workspaceForPr(workspaces, result.repoId, { number: p.number, branch: prBranch({ number: p.number, headRefName: p.head, isCrossRepository: p.isCrossRepository }) })
      : p?.kind === 'issue'
        ? workspaceForIssue(workspaces, result.repoId, p.number)
        : undefined
  const openHint = existing
    ? `Go to ${existing.title}, which already has this ${p?.kind === 'pr' ? 'PR' : 'issue'}`
    : p?.kind === 'pr'
      ? result?.repoId
        ? 'No workspace has this PR yet: open one on the Review tab'
        : `Clone ${p.repo} and open a workspace on this PR`
      : p?.kind === 'issue'
        ? result?.repoId
          ? 'No workspace has this issue yet: start one from it'
          : `Clone ${p.repo} and start a workspace from this issue`
        : ''
  const open = async () => {
    if (!p || busy) return
    setBusy(true)
    try {
      if (existing) {
        const st = useStore.getState()
        if (p.kind === 'pr') st.set({ rightOpen: true, rightTab: 'review' })
        st.selectWorkspace(existing.id)
      } else if (p.kind === 'pr') await openPrWorkspace(inboxPr(p, result!))
      else if (p.kind === 'issue') await openIssueWorkspace(p.repo, p.number, result?.repoId)
      onDone()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const btn = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50'
  return (
    <div className="flex items-center gap-0.5 border-t border-line px-1.5 py-1">
      {canOpen && (
        <button className={`${btn} text-fg`} title={openHint} disabled={busy} onClick={() => void open()}>
          {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-accent" /> : <KindIcon link={link} preview={p} />}
          Open in Choo Choo
          {existing && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Already open in a workspace" />}
        </button>
      )}
      <button className={btn} title="Open on GitHub" onClick={() => (void window.api.openExternal(href), onDone())}>
        <IconGithub width={12} height={12} />
        GitHub
      </button>
      <button
        className={btn}
        title="Copy link"
        onClick={() =>
          void navigator.clipboard.writeText(href).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }
      >
        {copied ? <IconCheck width={12} height={12} className="text-add" /> : <IconCopy width={12} height={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button className={`${btn} ml-auto px-1.5`} title="Refresh preview" onClick={() => load(href, true)}>
        <IconRefresh width={12} height={12} />
      </button>
    </div>
  )
}

function inboxPr(p: Extract<LinkPreview, { kind: 'pr' }>, r: LinkPreviewResult): InboxPr {
  return {
    repo: p.repo,
    number: p.number,
    title: p.title,
    url: p.url,
    author: p.author,
    isDraft: p.state === 'draft',
    headRefName: p.head,
    baseRefName: p.base,
    isCrossRepository: p.isCrossRepository,
    updatedAt: p.updatedAt,
    additions: p.additions,
    deletions: p.deletions,
    reviewDecision: null,
    checks: null,
    roles: [],
    ...(r.repoId ? { repoId: r.repoId } : {}),
    ...(r.workspaceId ? { workspaceId: r.workspaceId } : {}),
  }
}

/** The workspace started from a GitHub issue, or a new one, cloning its repo first when it isn't in Choo Choo yet. */
async function openIssueWorkspace(repo: string, number: number, repoId?: string) {
  const st = useStore.getState()
  if (!repoId || !st.repos.some((r) => r.id === repoId)) repoId = (await window.api.cloneRepo(repo)).id
  const held = workspaceForIssue(useStore.getState().workspaces, repoId, number)
  if (held) return useStore.getState().selectWorkspace(held.id)
  const { workspace, chat } = await window.api.createWorkspace(repoId, { kind: 'issue', number })
  await refreshState()
  const now = useStore.getState()
  now.setActiveChat(workspace.id, chat.id)
  now.selectWorkspace(workspace.id)
}
