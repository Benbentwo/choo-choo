import { useEffect, useState } from 'react'
import type { Chat, PrInfo, RepoGroup, Workspace } from '@shared/types'
import { foldKey, parseAutoUpdate, projectArchived, projectThreads, projectTree, routerChat, stripRouted } from '@shared/projects'
import { useStore, openGroupOrchestrator, editGroup, setRepoCollapsed, newChatTab, archiveWorkspace, restoreWorkspace, showView, viewFor } from '../store'
import { IconArchive, IconBranch, IconDown, IconPlus, IconX } from '../icons'
import { Menu, type MenuItem } from './Menu'
import { ProjectIcon } from './ProjectIcon'

/**
 * Projects (Settings › Experimental): the sidebar tree project › active repos › workspaces, shown
 * by PR once one exists, and the Threads panel beside a project's orchestrator. See docs/prd/projects.md.
 */

export function ProjectsSection() {
  const s = useStore()
  const folded = (key: string) => (s.settings.sidebarCollapsed ?? []).includes(key)
  const sectionFolded = folded(foldKey.section)
  return (
    <div className="mb-3">
      <div className="group mb-1 flex items-center px-2 text-[11px] font-medium text-faint">
        <button className="flex flex-1 items-center gap-1 text-left hover:text-fg" onClick={() => setRepoCollapsed(foldKey.section, !sectionFolded)} title={sectionFolded ? 'Show projects' : 'Fold projects'}>
          <IconDown width={12} height={12} className={sectionFolded ? '-rotate-90' : ''} />
          Projects
        </button>
        <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="New project" onClick={() => editGroup(null)}>
          <IconPlus />
        </button>
      </div>
      {!sectionFolded && s.groups.length === 0 && (
        <button className="mx-2 w-[calc(100%-16px)] rounded-md border border-dashed border-line px-3 py-2 text-left text-[12px] text-muted hover:border-faint hover:text-fg" onClick={() => editGroup(null)}>
          New project: one goal across one or more repos
        </button>
      )}
      {!sectionFolded && s.groups.map((g) => <ProjectNode key={g.id} group={g} folded={folded} />)}
    </div>
  )
}

function ProjectNode({ group, folded }: { group: RepoGroup; folded: (key: string) => boolean }) {
  const s = useStore()
  const [showAll, setShowAll] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const archived = projectArchived(group, s.workspaces)
  const orch = s.workspaces.find((w) => w.orchestrator && w.groupId === group.id && !w.archived)
  const chats = orch ? s.chats.filter((c) => c.workspaceId === orch.id) : []
  const running = chats.some((c) => c.status === 'running')
  const unread = chats.some((c) => c.unread)
  const active = !!orch && s.selectedWs === orch.id
  const tree = projectTree(group, s.repos, s.workspaces, showAll)
  const all = projectTree(group, s.repos, s.workspaces, true)
  const count = tree.reduce((n, t) => n + t.workspaces.length, 0)
  const isFolded = folded(foldKey.project(group.id))
  return (
    <div>
      <div className={`group flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1.5 ${active ? 'bg-raised' : 'hover:bg-hover'}`} onClick={() => void openGroupOrchestrator(group.id)} title="Open the orchestrator chat">
        <button
          className="rounded p-0.5 text-faint hover:text-fg"
          title={isFolded ? 'Unfold' : 'Fold'}
          onClick={(e) => {
            e.stopPropagation()
            setRepoCollapsed(foldKey.project(group.id), !isFolded)
          }}
        >
          <IconDown width={12} height={12} className={isFolded ? '-rotate-90' : ''} />
        </button>
        {running ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-accent" /> : <ProjectIcon group={group} />}
        <span className={`flex-1 truncate ${unread ? 'font-semibold' : 'font-medium'}`}>{group.name}</span>
        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        {count > 0 && <span className="text-[11px] text-faint group-hover:hidden">{count}</span>}
        <button
          className="hidden rounded px-1 text-[11px] text-faint group-hover:block hover:text-fg"
          onClick={(e) => {
            e.stopPropagation()
            editGroup(group.id)
          }}
        >
          Edit
        </button>
      </div>
      {!isFolded && (
        <div>
          {tree.map(({ repo, workspaces }) => {
            const key = foldKey.projectRepo(group.id, repo.id)
            const repoFolded = folded(key)
            return (
              <div key={repo.id}>
                <button className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 pl-6 text-left text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => setRepoCollapsed(key, !repoFolded)}>
                  <IconDown width={11} height={11} className={`text-faint ${repoFolded ? '-rotate-90' : ''}`} />
                  <span className="flex-1 truncate font-mono">{repo.name}</span>
                  {repoFolded && workspaces.length > 0 && <span className="text-[11px] text-faint">{workspaces.length}</span>}
                </button>
                {!repoFolded && workspaces.map((w) => <ProjectWorkRow key={w.id} ws={w} />)}
              </div>
            )
          })}
          {tree.length === 0 && <div className="py-1 pr-2 pl-7 text-[12px] text-faint">No open work yet. Tell the orchestrator what you want.</div>}
          {archived.length > 0 && (
            <button className="block py-0.5 pl-7 text-[11px] text-faint hover:text-fg" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? 'Hide archived' : `Archived (${archived.length})`}
            </button>
          )}
          {showArchived &&
            archived.map((w) => (
              <div key={w.id} className="group flex h-8 items-center gap-2 rounded-md pr-2 pl-7 text-faint hover:bg-hover">
                <IconBranch className="shrink-0" />
                <span className="flex-1 truncate" title={w.branch}>
                  {w.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] group-hover:hidden">{s.repos.find((r) => r.id === w.repoId)?.name}</span>
                <button className="hidden rounded px-1.5 text-[11px] text-muted group-hover:block hover:bg-raised hover:text-fg" onClick={() => void restoreWorkspace(w.id)}>
                  Restore
                </button>
              </div>
            ))}
          {(showAll || all.length > tree.length) && (
            <button className="py-0.5 pl-7 text-[11px] text-faint hover:text-fg" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Only repos with work' : `Show all repos (${all.length - tree.length} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** PRs looked up for project rows, so folding and re-rendering don't ask GitHub again. */
const prCache = new Map<string, { version: number; branch: string; pr: PrInfo | null }>()

/** One piece of a project's work: its PR number and title once there is a PR, else the workspace name. */
function ProjectWorkRow({ ws }: { ws: Workspace }) {
  const s = useStore()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // The same actions as a workspace row in the plain repo list.
  const menuItems: MenuItem[] = [
    { label: 'Open to the side', hint: '⌘-click', onClick: () => showView(viewFor(ws.id), 'right') },
    { kind: 'sep' },
    { label: 'Reveal in Finder', onClick: () => void window.api.revealInFinder(ws.path) },
    { label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(ws.branch) },
    { kind: 'sep' },
    { label: 'Archive workspace', onClick: () => void archiveWorkspace(ws.id) }
  ]
  const version = s.prVersion[ws.id] ?? 0
  const cached = prCache.get(ws.id)
  const [pr, setPr] = useState<PrInfo | null>(cached?.pr ?? null)
  useEffect(() => {
    const c = prCache.get(ws.id)
    if (c && c.version === version && c.branch === ws.branch) return setPr(c.pr)
    let live = true
    void window.api.getPr(ws.id).then(
      (p) => {
        prCache.set(ws.id, { version, branch: ws.branch, pr: p })
        if (live) setPr(p)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [ws.id, ws.branch, version])
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const running = chats.some((c) => c.status === 'running')
  const asking = chats.some((c) => (s.permissions[c.id]?.length ?? 0) > 0)
  const unread = chats.some((c) => c.unread)
  const selected = s.selectedWs === ws.id
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => (e.metaKey ? showView(viewFor(ws.id), 'right') : s.selectWorkspace(ws.id))}
      onKeyDown={(e) => e.key === 'Enter' && s.selectWorkspace(ws.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      title={ws.branch}
      className={`group flex h-8 items-center gap-2 rounded-md pr-2 pl-10 ${selected ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${asking ? 'bg-amber-400' : running ? 'animate-pulse bg-add' : pr?.state === 'MERGED' ? 'bg-violet-400' : 'bg-faint'}`} />
      {pr && <span className="shrink-0 font-mono text-[11.5px] text-sky-400">#{pr.number}</span>}
      <span className={`flex-1 truncate ${unread ? 'font-semibold text-fg' : ''}`}>{pr?.title ?? ws.title}</span>
      {asking ? (
        <span className="shrink-0 rounded bg-accent/20 px-1 text-[10px] text-accent">needs you</span>
      ) : pr ? (
        pr.state !== 'OPEN' && <span className="shrink-0 rounded bg-raised px-1 text-[10px] text-faint">{pr.state.toLowerCase()}</span>
      ) : (
        <span className="shrink-0 rounded bg-raised px-1 text-[10px] text-faint">no PR</span>
      )}
      <button
        className="hidden shrink-0 rounded p-0.5 text-faint group-hover:block hover:bg-raised hover:text-fg"
        title="Archive workspace"
        onClick={(e) => {
          e.stopPropagation()
          void archiveWorkspace(ws.id)
        }}
      >
        <IconArchive width={15} height={15} />
      </button>
      {/* React events bubble out of the portal; keep menu clicks from also selecting the row. */}
      {menuAt && (
        <span onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <Menu anchor={null} at={menuAt} items={menuItems} onClose={() => setMenuAt(null)} />
        </span>
      )}
    </div>
  )
}

/** The list of a project's conversations: its orchestrator chat, then threads, newest first. */
export function ThreadsPanel({ ws, activeId, onClose }: { ws: Workspace; activeId?: string; onClose: () => void }) {
  const s = useStore()
  const router = routerChat(s.chats, ws.id)
  const threads = projectThreads(s.chats, ws.id)
  const list: Chat[] = [...(router ? [router] : []), ...threads]
  // Load each thread's transcript once, for the last-line preview.
  const ids = list.map((c) => c.id).join(',')
  useEffect(() => {
    for (const c of list) {
      if (useStore.getState().items[c.id]) continue
      void window.api.getChatItems(c.id).then((items) => useStore.getState().items[c.id] || useStore.getState().setItems(c.id, items), () => {})
    }
  }, [ids])
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="font-medium">Threads</span>
        <span className="text-[12px] text-faint">{threads.length}</span>
        <span className="flex-1" />
        <button className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-hover" onClick={() => void newChatTab(ws.id)} title="Start a new thread">
          <IconPlus width={12} height={12} /> New
        </button>
        <button className="rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={onClose} title="Hide threads">
          <IconX width={12} height={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {list.map((c) => (
          <ThreadRow key={c.id} chat={c} group={s.groups.find((g) => g.id === ws.groupId)} router={c.id === router?.id} active={c.id === activeId} onClick={() => s.setActiveChat(ws.id, c.id)} />
        ))}
        {threads.length === 0 && <div className="px-2.5 py-3 text-[12px] text-faint">No threads yet. Messages to the orchestrator chat start them, or press New.</div>}
      </div>
    </aside>
  )
}

function ThreadRow({ chat, group, router, active, onClick }: { chat: Chat; group?: RepoGroup; router: boolean; active: boolean; onClick: () => void }) {
  const items = useStore((s) => s.items[chat.id])
  const last = lastLine(items)
  return (
    <button onClick={onClick} className={`mb-0.5 flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left ${active ? 'bg-raised' : 'hover:bg-hover'}`}>
      <span className="flex items-center gap-1.5">
        {router ? <ProjectIcon group={group} size={13} /> : <span className="w-3 shrink-0 text-center text-faint">#</span>}
        <span className={`flex-1 truncate ${chat.unread && !active ? 'font-semibold' : 'font-medium'}`}>{router ? 'Orchestrator chat' : chat.title}</span>
        {chat.status === 'running' && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-add" />}
        {chat.status !== 'running' && chat.unread && !active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
      </span>
      {last && <span className="truncate pl-[18px] text-[12px] text-faint">{last}</span>}
    </button>
  )
}

function lastLine(items: ReturnType<typeof useStore.getState>['items'][string] | undefined): string {
  if (!items) return ''
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'assistant' && it.text.trim()) return plain(it.text)
    const auto = it.kind === 'user' ? parseAutoUpdate(it.text) : null
    if (auto) return `Update: ${auto.map((d) => d.title).join(', ') || 'workspaces finished'}`
    if (it.kind === 'user' && it.text.trim()) return `You: ${plain(stripRouted(it.text).text)}`
  }
  return ''
}

/** First line of a message without markdown marks. */
const plain = (t: string) => t.trim().split('\n')[0].replace(/[*_`#>]/g, '')

/** A send_to_thread call in the orchestrator chat: where the message went, with a way to open it. */
export function RouteItem({ input, result, wsId }: { input: unknown; result?: string; wsId: string }) {
  const s = useStore()
  const i = (input ?? {}) as { thread_id?: string; new_thread_title?: string }
  let out: { thread_id?: string; title?: string; created?: boolean } = {}
  try {
    out = result ? JSON.parse(result) : {}
  } catch {
    /* an error message */
  }
  const id = out.thread_id ?? i.thread_id
  const chat = id ? s.chats.find((c) => c.id === id) : undefined
  const title = chat?.title ?? out.title ?? i.new_thread_title ?? 'a thread'
  const failed = result !== undefined && !out.thread_id
  return (
    <div className="my-1.5 inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px]">
      <span className={out.created ? 'text-accent' : 'text-faint'}>{out.created ? '+' : '↪'}</span>
      <span className="text-muted">{failed ? 'Could not send to' : result === undefined ? 'Sending to' : out.created ? 'New thread' : 'Sent to'}</span>
      <span className="font-medium"># {title}</span>
      {chat && (
        <button className="text-sky-400 hover:underline" onClick={() => s.setActiveChat(wsId, chat.id)}>
          Open thread
        </button>
      )}
    </div>
  )
}
