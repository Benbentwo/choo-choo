import { useEffect, useState } from 'react'
import { prMenuItems } from '../prState'
import type { Chat, PrInfo, RepoGroup, Workspace } from '@shared/types'
import { foldKey, parseAutoUpdate, projectArchived, projectThreads, projectTree, routerChat, stripRouted, threadKey, type ThreadNode } from '@shared/projects'
import { useStore, setProjectWorkSort, openGroupOrchestrator, editGroup, setRepoCollapsed, newChatTab, archiveWorkspace, restoreWorkspace, showView, viewFor } from '../store'
import { IconArchive, IconBranch, IconDown, IconPlus, IconSort, IconX } from '../icons'
import { Menu, type MenuItem } from './Menu'
import { ProjectIcon } from './ProjectIcon'
import { sortProjectWork, type ProjectWorkSort } from '@shared/sidebarOrder'
import { askToQueue, setQueueDrag } from './ContinueWork'

/**
 * Projects (Settings › Experimental): the sidebar tree project › thread › repo › workspace, each
 * workspace shown by its PR once one exists, and the Threads panel beside a project's orchestrator. See docs/prd/projects.md.
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
  const [showArchived, setShowArchived] = useState(false)
  const archived = projectArchived(group, s.workspaces)
  const orch = s.workspaces.find((w) => w.orchestrator && w.groupId === group.id && !w.archived)
  const chats = orch ? s.chats.filter((c) => c.workspaceId === orch.id) : []
  const running = chats.some((c) => c.status === 'running')
  const unread = chats.some((c) => c.unread)
  const router = orch ? routerChat(s.chats, orch.id) : undefined
  const active = !!orch && s.selectedWs === orch.id && (s.activeChat[orch.id] ?? router?.id) === router?.id
  const tree = projectTree(group, s.repos, s.workspaces, s.chats, orch?.id)
  const count = tree.reduce((n, t) => n + t.repos.reduce((m, r) => m + r.workspaces.length, 0), 0)
  const isFolded = folded(foldKey.project(group.id))
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <div>
      <div
        className={`group flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1.5 ${active ? 'bg-raised' : 'hover:bg-hover'}`}
        onClick={() => void openGroupOrchestrator(group.id)}
        title="Open the orchestrator chat. Drag onto Up next to queue the project for the next window."
        draggable
        onDragStart={(e) => setQueueDrag(e, { kind: 'project', groupId: group.id })}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuAt({ x: e.clientX, y: e.clientY })
        }}
      >
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
        {menuAt && (
          <span onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <Menu
              anchor={null}
              at={menuAt}
              items={[
                { label: 'Open orchestrator', onClick: () => void openGroupOrchestrator(group.id) },
                { label: 'Edit project…', onClick: () => editGroup(group.id) },
                { kind: 'sep' },
                { label: 'Queue for next window…', hint: 'Up next', onClick: () => askToQueue({ kind: 'project', groupId: group.id }) }
              ]}
              onClose={() => setMenuAt(null)}
            />
          </span>
        )}
      </div>
      {!isFolded && (
        <div>
          {tree.map((node) => (
            <ThreadNodeView key={threadKey(node)} group={group} node={node} orchId={orch?.id} folded={folded} />
          ))}
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
        </div>
      )}
    </div>
  )
}

/** A thread and the work it owns, by repo. Clicking the thread opens it; work no thread owns sits under "No thread". */
function ThreadNodeView({ group, node, orchId, folded }: { group: RepoGroup; node: ThreadNode; orchId?: string; folded: (key: string) => boolean }) {
  const s = useStore()
  const { thread, repos } = node
  const tKey = foldKey.projectThread(group.id, threadKey(node))
  const isFolded = folded(tKey)
  const count = repos.reduce((n, r) => n + r.workspaces.length, 0)
  const active = !!thread && !!orchId && s.selectedWs === orchId && s.activeChat[orchId] === thread.id
  const unread = !!thread?.unread && !active
  const toggle = () => setRepoCollapsed(tKey, !isFolded)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [sortAt, setSortAt] = useState<{ x: number; y: number } | null>(null)
  const sort = s.settings.projectWorkSort ?? 'newest'
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        draggable={!!thread}
        onDragStart={(e) => thread && setQueueDrag(e, { kind: 'thread', chatId: thread.id })}
        onContextMenu={(e) => {
          if (!thread) return
          e.preventDefault()
          setMenuAt({ x: e.clientX, y: e.clientY })
        }}
        className={`group flex h-8 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-5 ${active ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
        onClick={() => (thread ? void openGroupOrchestrator(group.id, thread.id) : toggle())}
        onKeyDown={(e) => e.key === 'Enter' && (thread ? void openGroupOrchestrator(group.id, thread.id) : toggle())}
        title={thread ? 'Open this thread' : 'Work no thread owns: started before threads, or its thread was deleted'}
      >
        <button
          className="rounded p-0.5 text-faint hover:text-fg"
          title={isFolded ? 'Unfold' : 'Fold'}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
        >
          <IconDown width={11} height={11} className={isFolded ? '-rotate-90' : ''} />
        </button>
        <span className="w-3 shrink-0 text-center text-faint">#</span>
        <span className={`flex-1 truncate ${unread ? 'font-semibold text-fg' : ''} ${thread ? '' : 'italic'}`}>{thread?.title ?? 'No thread'}</span>
        {thread?.status === 'running' ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-add" /> : unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
        {isFolded ? (
          <span className="text-[11px] text-faint">{count}</span>
        ) : (
          count > 1 && (
            <button
              title={`Sort work: ${WORK_SORTS.find((o) => o.id === sort)?.label}`}
              className={`shrink-0 rounded p-0.5 text-faint hover:text-fg ${sortAt ? 'block' : 'hidden group-hover:block'}`}
              onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                setSortAt({ x: r.left, y: r.bottom + 2 })
              }}
            >
              <IconSort width={11} height={11} />
            </button>
          )
        )}
        {sortAt && (
          <span onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <Menu
              anchor={null}
              at={sortAt}
              items={[{ kind: 'label', label: 'Sort by' }, ...WORK_SORTS.map((o): MenuItem => ({ label: o.label, checked: sort === o.id, onClick: () => setProjectWorkSort(o.id) }))]}
              onClose={() => setSortAt(null)}
            />
          </span>
        )}
        {menuAt && thread && (
          <span onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <Menu
              anchor={null}
              at={menuAt}
              items={[
                { label: 'Open thread', onClick: () => void openGroupOrchestrator(group.id, thread.id) },
                { kind: 'sep' },
                { label: 'Queue for next window…', hint: 'Up next', onClick: () => askToQueue({ kind: 'thread', chatId: thread.id }) }
              ]}
              onClose={() => setMenuAt(null)}
            />
          </span>
        )}
      </div>
      {!isFolded &&
        repos.map(({ repo, workspaces }) => {
          const key = foldKey.projectRepo(group.id, threadKey(node), repo.id)
          return <ProjectRepoWork key={repo.id} name={repo.name} workspaces={workspaces} folded={folded(key)} onFold={(f) => setRepoCollapsed(key, f)} />
        })}
    </div>
  )
}

/** PRs looked up for project rows, so folding and re-rendering don't ask GitHub again. */
const prCache = new Map<string, { version: number; branch: string; pr: PrInfo | null }>()

/** The PR of each workspace, by id, looked up once per PR change. */
function useWorkPrs(workspaces: Workspace[]): Record<string, PrInfo | null> {
  const versions = useStore((s) => s.prVersion)
  const fresh = () => Object.fromEntries(workspaces.map((w) => [w.id, prCache.get(w.id)?.pr ?? null]))
  const [prs, setPrs] = useState(fresh)
  const sig = workspaces.map((w) => `${w.id}:${w.branch}:${versions[w.id] ?? 0}`).join(',')
  useEffect(() => {
    let live = true
    setPrs(fresh())
    for (const w of workspaces) {
      const version = versions[w.id] ?? 0
      const c = prCache.get(w.id)
      if (c && c.version === version && c.branch === w.branch) continue
      void window.api.getPr(w.id).then(
        (p) => {
          prCache.set(w.id, { version, branch: w.branch, pr: p })
          if (live) setPrs((cur) => ({ ...cur, [w.id]: p }))
        },
        () => {}
      )
    }
    return () => {
      live = false
    }
  }, [sig])
  return prs
}

const WORK_SORTS: { id: ProjectWorkSort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'pr', label: 'PR number' },
  { id: 'title', label: 'Title' }
]

/** A repo under a project thread and its work, in the order picked with the thread's sort arrow. */
function ProjectRepoWork({ name, workspaces, folded, onFold }: { name: string; workspaces: Workspace[]; folded: boolean; onFold: (folded: boolean) => void }) {
  const sort = useStore((s) => s.settings.projectWorkSort ?? 'newest')
  const prs = useWorkPrs(workspaces)
  return (
    <div>
      <button className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 pl-10 text-left text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => onFold(!folded)}>
        <IconDown width={11} height={11} className={`text-faint ${folded ? '-rotate-90' : ''}`} />
        <span className="flex-1 truncate font-mono">{name}</span>
        {folded && <span className="text-[11px] text-faint">{workspaces.length}</span>}
      </button>
      {!folded && sortProjectWork(workspaces, sort, prs).map((w) => <ProjectWorkRow key={w.id} ws={w} pr={prs[w.id] ?? null} />)}
    </div>
  )
}

/** One piece of a project's work: its PR number and title once there is a PR, else the workspace name. */
function ProjectWorkRow({ ws, pr }: { ws: Workspace; pr: PrInfo | null }) {
  const s = useStore()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // The same actions as a workspace row in the plain repo list.
  const menuItems: MenuItem[] = [
    { label: 'Open to the side', hint: '⌘-click', onClick: () => showView(viewFor(ws.id), 'right') },
    { kind: 'sep' },
    { label: 'Reveal in Finder', onClick: () => void window.api.revealInFinder(ws.path) },
    { label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(ws.branch) },
    { kind: 'sep' },
    { label: 'Queue for next window…', hint: 'Up next', onClick: () => askToQueue({ kind: 'ws', wsId: ws.id }) },
    { kind: 'sep' },
    { label: 'Archive workspace', onClick: () => void archiveWorkspace(ws.id) }
  ]
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
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData('text/plain', ws.id)
        useStore.getState().set({ drag: { kind: 'ws', wsId: ws.id } })
        setQueueDrag(e, { kind: 'ws', wsId: ws.id })
      }}
      onDragEnd={() => useStore.getState().set({ drag: null })}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      title={ws.branch}
      className={`group flex h-8 items-center gap-2 rounded-md pr-2 pl-14 ${selected ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
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
          <Menu anchor={null} at={menuAt} items={[...prMenuItems(pr), ...menuItems]} onClose={() => setMenuAt(null)} />
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
