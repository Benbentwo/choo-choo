import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Workspace } from '@shared/types'
import * as L from '@shared/layout'
import {
  useStore,
  newChatTab,
  closeChatTab,
  refreshState,
  reportError,
  nextUnread,
  goToNextUnread,
  closeReflect,
  focusGroup,
  setGroupActive,
  setGroupDoc,
  splitDocOut,
  addTerminalTab,
  closeTerminalTab,
  mergeGroups,
  splitPane,
  closePane,
  dropTab,
  type DragItem
} from '../store'
import { IconDots, IconPanelRight, IconPlus, IconRight, IconSidebar, IconX, IconChart, IconPhone, IconTerminal, IconSplitRight, IconBranch } from '../icons'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { DiffView } from './DiffView'
import { FileView } from './FileView'
import { ReflectView, SessionFeedback } from './Reflect'
import { PhonePanel } from './PhonePanel'
import { CloudPanel, RunInCloudDialog } from './CloudPanel'
import { StackSwitcher } from './Stack'
import { TerminalView } from './TerminalView'
import { Stats } from './Stats'
import { PaneGrip, RepoChip, PaneMenuItems, DropOverlay, Dividers } from './Panes'

/**
 * One workspace in a pane: a header, then its groups of chat tabs. Alone in the window it looks
 * like it always did (`framed` false); beside other panes it gets a pane header that names its
 * repo and workspace plainly.
 */
export function Center({ ws, leaf, framed, focused }: { ws: Workspace; leaf: L.Leaf; framed: boolean; focused: boolean }) {
  const s = useStore()
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const active = chats.find((c) => c.id === s.activeChat[ws.id]) ?? chats[0]
  const [reflecting, setReflecting] = useState(false)
  const [cloudDialog, setCloudDialog] = useState(false)
  const view = leaf.view.kind === 'workspace' ? leaf.view : null

  useEffect(() => {
    if (chats.length === 0) void newChatTab(ws.id)
  }, [ws.id, chats.length])

  if (!view) return null
  const groups = L.leavesOf(view.inner)
  const { leaves: boxes, dividers } = L.boxes(view.inner)
  const multiGroup = groups.length > 1

  const menu = (close: () => void) => (
    <WorkspaceMenu ws={ws} close={close} onReflect={() => setReflecting(true)} onCloud={() => setCloudDialog(true)} leaf={leaf} framed={framed} multiGroup={multiGroup} />
  )

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-bg">
      {framed ? <WorkspacePaneHeader ws={ws} leaf={leaf} focused={focused} menu={menu} /> : <ClassicHeader ws={ws} menu={menu} />}
      <div className="relative min-h-0 flex-1">
        {groups.map((g) => {
          const b = boxes.get(g.id)!
          return (
            <div
              key={g.id}
              className={`absolute flex flex-col ${b.x > 0 ? 'border-l border-line' : ''} ${b.y > 0 ? 'border-t border-line' : ''}`}
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
              onMouseDownCapture={() => focusGroup(leaf.id, g.id)}
            >
              <GroupView ws={ws} leaf={leaf} group={g} focused={focused && view.focusGroup === g.id} accent={multiGroup && view.focusGroup === g.id} />
            </div>
          )
        })}
        <Dividers dividers={dividers} leafId={leaf.id} inner />
      </div>
      {reflecting && <SessionFeedback ws={ws} archive={false} onClose={() => setReflecting(false)} />}
      {cloudDialog && active && <RunInCloudDialog chat={active} ws={ws} onClose={() => setCloudDialog(false)} />}
    </main>
  )
}

/** The header the center always had: breadcrumb, workspace menu, and the right panel toggle. It's the window's title bar, so it drags the window. */
function ClassicHeader({ ws, menu }: { ws: Workspace; menu: (close: () => void) => ReactNode }) {
  const s = useStore()
  const repo = s.repos.find((r) => r.id === ws.repoId)
  return (
    <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      {!s.sidebarOpen && (
        <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
          <IconSidebar width={16} height={16} />
        </button>
      )}
      <span className="text-muted">{repo?.name}</span>
      <IconRight className="text-faint" />
      {ws.stack ? (
        <>
          <span className="truncate">{ws.title}</span>
          <IconRight className="text-faint" />
          <StackSwitcher ws={ws} />
        </>
      ) : (
        <span className="no-drag selectable truncate">{ws.orchestrator ? (ws.groupId ? `Orchestrator · ${ws.title}` : 'Orchestrator') : ws.branch}</span>
      )}
      <DotsMenu menu={menu} />
      <ShareBadges ws={ws} />
      <div className="flex-1" />
      <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => splitPane('right')} title="Split right (⌘\)">
        <IconSplitRight width={16} height={16} />
      </button>
      <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ rightOpen: !s.rightOpen })} title="Toggle right panel">
        <IconPanelRight width={16} height={16} />
      </button>
    </header>
  )
}

/** A workspace pane's header beside other panes: repo chip / workspace name, then its branch, which gives way first when space is short. */
function WorkspacePaneHeader({ ws, leaf, focused, menu }: { ws: Workspace; leaf: L.Leaf; focused: boolean; menu: (close: () => void) => ReactNode }) {
  const s = useStore()
  const repo = s.repos.find((r) => r.id === ws.repoId)
  const name = ws.orchestrator ? (ws.groupId ? `Orchestrator · ${ws.title}` : 'Orchestrator') : ws.title
  const showBranch = !ws.orchestrator && ws.branch && ws.branch !== ws.title
  return (
    <header className={`flex h-[42px] shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-1 ${focused ? 'bg-accent/[0.07]' : 'bg-panel'}`}>
      <PaneGrip leafId={leaf.id} />
      {repo && <RepoChip name={repo.name} />}
      <span className="shrink-0 text-[15px] text-faint">/</span>
      <StatusDot ws={ws} />
      <span className="shrink-0 text-[15px] font-bold whitespace-nowrap text-fg" title={name}>
        {name}
      </span>
      {ws.stack && <StackSwitcher ws={ws} />}
      {showBranch && (
        <span className="flex min-w-0 shrink-[1000] items-center gap-1 overflow-hidden font-mono text-[11px] whitespace-nowrap text-faint" title={ws.branch}>
          <IconBranch width={11} height={11} className="shrink-0" />
          <span className="truncate">{ws.branch}</span>
        </span>
      )}
      <ShareBadges ws={ws} />
      <div className="min-w-0 flex-1" />
      {!ws.orchestrator && (
        <span className="shrink-0">
          <Stats stats={s.stats[ws.id]} />
        </span>
      )}
      <DotsMenu menu={menu} align="right" />
      <button className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Close pane (⌘⌥W). The workspace keeps running." onClick={() => closePane(leaf.id)}>
        <IconX />
      </button>
    </header>
  )
}

/** Green while an agent runs, amber when one needs you, blue with unread replies. */
export function StatusDot({ ws }: { ws: Workspace }) {
  const s = useStore()
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const running = chats.some((c) => c.status === 'running')
  const asking = chats.some((c) => (s.permissions[c.id]?.length ?? 0) > 0)
  const unread = chats.some((c) => c.unread)
  const cls = asking ? 'bg-amber-400' : running ? 'animate-pulse bg-add' : unread ? 'bg-sky-400' : 'bg-faint'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={asking ? 'Needs you' : running ? 'Running' : unread ? 'Unread' : 'Idle'} />
}

function ShareBadges({ ws }: { ws: Workspace }) {
  const s = useStore()
  return (
    <>
      {ws.importedShare && <span className="shrink-0 text-[12px] text-faint">Shared by {ws.importedShare.sharedBy}</span>}
      {ws.share && (
        <button className="no-drag shrink-0 rounded px-1.5 py-0.5 text-[12px] text-add hover:bg-hover" onClick={() => s.set({ modal: 'share' })} title="Shared with coworkers">
          Shared
        </button>
      )}
    </>
  )
}

export function DotsMenu({ menu, title = 'Workspace actions', align = 'left' }: { menu: (close: () => void) => ReactNode; title?: string; align?: 'left' | 'right' }) {
  // Where the menu opens, in window pixels. It's portaled to the body so a pane's border doesn't clip it.
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = !!at
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node) && setAt(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    if (open) return setAt(null)
    const r = ref.current!.getBoundingClientRect()
    // Start from the button's left or right edge, flipping when the menu wouldn't fit on screen.
    const W = window.innerWidth
    const right = align === 'right' ? r.right - 248 > 8 : r.left + 248 > W - 8
    setAt(right ? { top: r.bottom + 4, right: Math.max(8, W - r.right) } : { top: r.bottom + 4, left: Math.max(8, r.left) })
  }
  return (
    <div ref={ref} className="no-drag relative shrink-0">
      <button title={title} className={`rounded p-1 text-muted hover:bg-hover hover:text-fg ${open ? 'bg-hover text-fg' : ''}`} onClick={toggle}>
        <IconDots />
      </button>
      {at &&
        createPortal(
          <div
            ref={menuRef}
            className="no-drag fixed z-50 max-h-[calc(100vh-16px)] w-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-xl"
            style={{ top: Math.min(at.top, window.innerHeight - 120), left: at.left, right: at.right }}
          >
            {menu(() => setAt(null))}
          </div>,
          document.body
        )}
    </div>
  )
}

function WorkspaceMenu(p: { ws: Workspace; leaf: L.Leaf; framed: boolean; multiGroup: boolean; close: () => void; onReflect: () => void; onCloud: () => void }) {
  const { ws, close } = p
  const s = useStore()
  const active = s.chats.find((c) => c.id === s.activeChat[ws.id]) ?? s.chats.find((c) => c.workspaceId === ws.id)
  const archive = async () => {
    close()
    try {
      await window.api.archiveWorkspace(ws.id)
      await refreshState()
      if (useStore.getState().selectedWs === ws.id) s.selectWorkspace(null)
    } catch (e) {
      reportError(e)
    }
  }
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <>
      <MenuItem label="Reveal in Finder" onClick={run(() => void window.api.revealInFinder(ws.path))} />
      <MenuItem label="Copy path" onClick={run(() => void navigator.clipboard.writeText(ws.path))} />
      <MenuItem label="Copy branch name" onClick={run(() => void navigator.clipboard.writeText(ws.branch))} />
      {active?.sdkSessionId && (
        <MenuItem
          label="Copy resume command"
          title="Reopen this chat in Claude Code from a terminal, e.g. if Choo Choo crashes"
          onClick={run(() => void navigator.clipboard.writeText(`cd '${ws.path.replace(/'/g, `'\\''`)}' && claude --resume ${active.sdkSessionId}`))}
        />
      )}
      <MenuItem label="Reflect on this session…" onClick={run(p.onReflect)} />
      <MenuItem label={ws.share ? 'Sharing with coworkers…' : 'Share with coworkers…'} onClick={run(() => s.set({ modal: 'share' }))} />
      {!ws.orchestrator && active && !active.remote && active.status !== 'running' && <MenuItem label="Run in the cloud…" onClick={run(p.onCloud)} />}
      <MenuItem label="Open a terminal here" onClick={run(() => addTerminalTab(p.leaf.id))} />
      {p.multiGroup && <MenuItem label="Merge chats into one pane" onClick={run(() => mergeGroups(p.leaf.id))} />}
      <div className="my-1 border-t border-line" />
      <PaneMenuItems leafId={p.leaf.id} close={close} />
      <div className="my-1 border-t border-line" />
      <MenuItem label={ws.orchestrator ? 'Hide orchestrator' : 'Archive workspace'} danger={!ws.orchestrator} onClick={() => void archive()} />
    </>
  )
}

/** One group of tabs inside a workspace pane: chat and terminal tabs, plus a diff, file or Reflect shown in place of the chat. */
function GroupView({ ws, leaf, group, focused, accent }: { ws: Workspace; leaf: L.Leaf; group: L.Group; focused: boolean; accent: boolean }) {
  const s = useStore()
  const chats = group.chats.map((id) => s.chats.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c)
  const activeTerm = group.active && group.terms.includes(group.active) ? group.active : null
  const active = activeTerm ? undefined : (chats.find((c) => c.id === group.active) ?? chats[0])
  const doc = group.doc
  const diffFile = doc && doc.kind !== 'reflect' ? doc.path : null
  const reflect = s.reflects[ws.id]
  const groups = leaf.view.kind === 'workspace' ? L.leavesOf(leaf.view.inner) : [group]
  const showReflectTab = reflect && (doc?.kind === 'reflect' || (!groups.some((g) => g.doc?.kind === 'reflect') && groups[0].id === group.id))
  const drag = s.drag
  const tabDrag = drag?.kind === 'tab' && drag.leafId === leaf.id ? drag : null

  useEffect(() => {
    if (active && !s.items[active.id]) {
      void window.api.getChatItems(active.id).then((items) => useStore.getState().setItems(active.id, items))
    }
  }, [active?.id])

  // Looking at a chat marks it read.
  useEffect(() => {
    if (active?.unread && !doc && active.status !== 'running') {
      void window.api.updateChat(active.id, { unread: false }).then((c) => useStore.getState().upsertChat(c))
    }
  }, [active?.id, active?.unread, doc])

  const hasNextUnread = focused && !!nextUnread()
  const underline = accent ? 'border-accent' : 'border-fg'
  const startTabDrag = (tabId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
    s.set({ drag: { kind: 'tab', leafId: leaf.id, tabId } satisfies DragItem })
  }
  const endDrag = () => useStore.getState().set({ drag: null })

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none]">
        {chats.map((c) => {
          const on = !doc && !activeTerm && c.id === active?.id
          return (
            <div
              key={c.id}
              draggable
              onDragStart={startTabDrag(c.id)}
              onDragEnd={endDrag}
              className={`group flex h-10 max-w-[220px] shrink-0 items-center gap-2 border-b-2 px-3 ${on ? `${underline} text-fg` : 'border-transparent text-muted hover:text-fg'}`}
            >
              <button className="truncate" onClick={() => setGroupActive(leaf.id, group.id, c.id)}>
                {c.status === 'running' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-add align-middle" />}
                {c.status !== 'running' && c.unread && c.id !== active?.id && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" />}
                {c.title}
              </button>
              {s.chats.filter((x) => x.workspaceId === ws.id).length > 1 && (
                <button title="Close chat" className="invisible rounded text-faint group-hover:visible hover:text-fg" onClick={() => void closeChatTab(c.id)}>
                  <IconX width={12} height={12} />
                </button>
              )}
            </div>
          )
        })}
        {group.terms.map((t, i) => {
          const on = !doc && activeTerm === t
          return (
            <div
              key={t}
              draggable
              onDragStart={startTabDrag(t)}
              onDragEnd={endDrag}
              className={`group flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 ${on ? `${underline} text-fg` : 'border-transparent text-muted hover:text-fg'}`}
            >
              <button className="flex items-center gap-1.5" onClick={() => setGroupActive(leaf.id, group.id, t)}>
                <IconTerminal width={12} height={12} />
                Terminal{group.terms.length > 1 ? ` ${i + 1}` : ''}
              </button>
              <button title="Close terminal" className="invisible rounded text-faint group-hover:visible hover:text-fg" onClick={() => closeTerminalTab(leaf.id, t)}>
                <IconX width={12} height={12} />
              </button>
            </div>
          )
        })}
        {showReflectTab && (
          <div className={`flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 ${doc?.kind === 'reflect' ? `${underline} text-fg` : 'border-transparent text-muted hover:text-fg'}`}>
            <button onClick={() => setGroupDoc(leaf.id, group.id, { kind: 'reflect', path: 'Reflect' })}>Reflect</button>
            <button title="Close Reflect" className="text-faint hover:text-fg" onClick={() => closeReflect(ws.id)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        )}
        {diffFile && (
          <div className={`flex h-10 max-w-[260px] shrink-0 items-center gap-2 border-b-2 ${underline} px-3`}>
            <span className="truncate font-mono text-[12px]">{diffFile.split('/').pop()}</span>
            <span className="text-[11px] text-faint">{doc?.kind === 'file' ? 'file' : 'diff'}</span>
            {(chats.length > 0 || group.terms.length > 0) && (
              <button title="Open beside the chat" className="text-faint hover:text-fg" onClick={() => splitDocOut(leaf.id, group.id, 'right')}>
                <IconSplitRight width={12} height={12} />
              </button>
            )}
            <button title="Close file" className="text-faint hover:text-fg" onClick={() => setGroupDoc(leaf.id, group.id, null)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        )}
        {(chats.length > 0 || groups.length === 1) && (
          <button
            className="mb-2.5 ml-1 shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg"
            onClick={() => {
              focusGroup(leaf.id, group.id)
              void newChatTab(ws.id)
            }}
            title="New chat (⌘T)"
          >
            <IconPlus />
          </button>
        )}
        <div className="flex-1" />
        {active && !activeTerm && active.model !== 'codex' && !ws.orchestrator && !active.remote && (
          <button
            className="mb-2.5 shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!active.sdkSessionId || active.status === 'running'}
            onClick={() => void continueOnPhone(active.id)}
            title={
              !active.sdkSessionId
                ? 'Send a message first, then continue this chat on your phone'
                : active.status === 'running'
                  ? 'Wait for the agent to finish, then continue on your phone'
                  : 'Continue on phone: steer this chat from the Claude app or claude.ai/code'
            }
          >
            <IconPhone />
          </button>
        )}
        {active && !activeTerm && active.model !== 'codex' && (
          <button className="mb-2.5 shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ modal: 'usage', usageChat: active.id })} title="Usage and context graphs">
            <IconChart />
          </button>
        )}
      </div>

      {/* An open diff or file takes the place of the chat history; the composer stays below it. */}
      {doc?.kind === 'diff' ? (
        <DiffView ws={ws} file={doc.path} />
      ) : doc?.kind === 'file' ? (
        <FileView ws={ws} file={doc.path} line={doc.line} />
      ) : doc?.kind === 'reflect' && reflect ? (
        <ReflectView ws={ws} feedback={reflect.feedback} archiveAfter={reflect.archiveAfter} />
      ) : activeTerm ? (
        <div className="min-h-0 flex-1 bg-code p-2">
          <TerminalView key={activeTerm} id={activeTerm} workspaceId={ws.id} />
        </div>
      ) : active ? (
        <ChatView chat={active} />
      ) : (
        <div className="flex-1" />
      )}
      {active && !activeTerm && doc?.kind !== 'reflect' && (doc === null || chats.length > 0) ? (
        <>
          {!doc && hasNextUnread && (
            <div className="mx-auto -mb-1 flex w-full max-w-3xl justify-end px-8">
              <button className="flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 text-[12px] hover:bg-hover" onClick={goToNextUnread}>
                Next unread <IconRight />
              </button>
            </div>
          )}
          {active.remote?.kind === 'phone' ? (
            <PhonePanel chat={active} ws={ws} />
          ) : active.remote?.kind === 'cloud' ? (
            <CloudPanel chat={active} ws={ws} />
          ) : (
            <Composer chat={active} ws={ws} />
          )}
        </>
      ) : null}
      {tabDrag && <DropOverlay inner onDrop={(side) => dropTab(leaf.id, tabDrag.tabId, group.id, side)} canDrop={(side) => side !== undefined || L.groupOf(leaf.view.kind === 'workspace' ? leaf.view.inner : group, tabDrag.tabId)?.id !== group.id} />}
    </div>
  )
}

async function continueOnPhone(chatId: string) {
  try {
    useStore.getState().upsertChat(await window.api.continueOnPhone(chatId))
  } catch (e) {
    reportError(e)
  }
}

export function MenuItem(p: { label: string; title?: string; danger?: boolean; hint?: string; icon?: ReactNode; onClick: () => void }) {
  return (
    <button onClick={p.onClick} title={p.title} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${p.danger ? 'text-del' : ''}`}>
      {p.icon && <span className="text-muted">{p.icon}</span>}
      <span className="flex-1">{p.label}</span>
      {p.hint && <span className="text-[11px] text-faint">{p.hint}</span>}
    </button>
  )
}

