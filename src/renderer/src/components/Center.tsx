import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { ProjectIcon } from './ProjectIcon'
import { useStore, openGroupOrchestrator, openDoc, newChatTab, closeChatTab, refreshState, reportError, nextUnread, goToNextUnread, closeReflect } from '../store'
import { IconDots, IconPanelRight, IconPlus, IconRight, IconSidebar, IconX, IconChart, IconPhone } from '../icons'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { DiffView } from './DiffView'
import { FileView } from './FileView'
import { ReflectView, SessionFeedback } from './Reflect'
import { PhonePanel } from './PhonePanel'
import { CloudPanel, RunInCloudDialog } from './CloudPanel'
import { StackSwitcher } from './Stack'
import { ThreadsPanel } from './Projects'
import { routerChat } from '@shared/projects'
import { isTheirs, prOwnerLabel } from '@shared/prReview'
import { usePrReview } from '../prReview'
import { IconPR } from '../icons'

export function Center({ ws }: { ws: Workspace }) {
  const s = useStore()
  const repo = s.repos.find((r) => r.id === ws.repoId)
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const activeId = s.activeChat[ws.id] && chats.some((c) => c.id === s.activeChat[ws.id]) ? s.activeChat[ws.id] : chats[0]?.id
  const active = chats.find((c) => c.id === activeId)
  const doc = s.openDoc[ws.id] ?? null
  const diffFile = doc && doc.kind !== 'reflect' ? doc.path : null
  const reflect = s.reflects[ws.id]
  const [menu, setMenu] = useState(false)
  const [reflecting, setReflecting] = useState(false)
  const [cloudDialog, setCloudDialog] = useState(false)
  // A project's orchestrator: one chat at a time, picked from the Threads panel instead of tabs.
  const project = !!ws.orchestrator && !!ws.groupId && !!s.settings.experimentalProjects
  const [threadsOpen, setThreadsOpen] = useState(() => localStorage.getItem('threads-panel') !== 'closed')
  const toggleThreads = (open: boolean) => {
    setThreadsOpen(open)
    try {
      localStorage.setItem('threads-panel', open ? 'open' : 'closed')
    } catch {
      /* storage unavailable */
    }
  }
  const isRouter = project && active?.id === routerChat(s.chats, ws.id)?.id
  // A workspace a project started shows the project before its repo.
  const partOf = s.settings.experimentalProjects && !ws.orchestrator ? s.groups.find((g) => g.id === ws.orchestratorId) : undefined

  useEffect(() => {
    if (chats.length === 0) void newChatTab(ws.id)
  }, [ws.id, chats.length])

  useEffect(() => {
    if (activeId && !s.items[activeId]) {
      void window.api.getChatItems(activeId).then((items) => useStore.getState().setItems(activeId, items))
    }
  }, [activeId])

  // Looking at a chat marks it read.
  useEffect(() => {
    if (active?.unread && !doc && active.status !== 'running') {
      void window.api.updateChat(active.id, { unread: false }).then((c) => useStore.getState().upsertChat(c))
    }
  }, [active?.id, active?.unread, doc])

  const hasNextUnread = !!nextUnread()

  const archive = async () => {
    setMenu(false)
    try {
      await window.api.archiveWorkspace(ws.id)
      await refreshState()
      if (useStore.getState().selectedWs === ws.id) s.selectWorkspace(null)
    } catch (e) {
      reportError(e)
    }
  }

  const main = (
    <main className="flex min-w-0 flex-1 flex-col bg-bg">
      <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
        {partOf && (
          <>
            <button className="no-drag text-muted hover:text-fg" onClick={() => void openGroupOrchestrator(partOf.id)} title="Open the project's orchestrator chat">
              <ProjectIcon group={partOf} size={12} className="mr-1 inline align-[-1px]" />
              {partOf.name}
            </button>
            <IconRight className="text-faint" />
          </>
        )}
        <span className="text-muted">{project ? ws.title : repo?.name}</span>
        <IconRight className="text-faint" />
        {ws.stack ? (
          <>
            <span className="truncate">{ws.title}</span>
            <IconRight className="text-faint" />
            <StackSwitcher ws={ws} />
          </>
        ) : (
          <span className="no-drag selectable truncate">
            {project ? (isRouter ? 'Orchestrator chat' : `# ${active?.title ?? ''}`) : ws.orchestrator ? (ws.groupId ? `Orchestrator · ${ws.title}` : 'Orchestrator') : ws.branch}
          </span>
        )}
        <div className="no-drag relative">
          <button title="Workspace actions" className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => setMenu(!menu)}>
            <IconDots />
          </button>
          {menu && (
            <div className="absolute top-7 left-0 z-20 w-56 rounded-lg border border-line bg-raised p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
              <MenuItem label="Reveal in Finder" onClick={() => { setMenu(false); void window.api.revealInFinder(ws.path) }} />
              <MenuItem label="Copy path" onClick={() => { setMenu(false); void navigator.clipboard.writeText(ws.path) }} />
              <MenuItem label="Copy branch name" onClick={() => { setMenu(false); void navigator.clipboard.writeText(ws.branch) }} />
              {active?.sdkSessionId && (
                <MenuItem
                  label="Copy resume command"
                  title="Reopen this chat in Claude Code from a terminal, e.g. if Choo Choo crashes"
                  onClick={() => {
                    setMenu(false)
                    void navigator.clipboard.writeText(`cd '${ws.path.replace(/'/g, `'\\''`)}' && claude --resume ${active.sdkSessionId}`)
                  }}
                />
              )}
              <MenuItem label="Reflect on this session…" onClick={() => { setMenu(false); setReflecting(true) }} />
              <MenuItem label={ws.share ? 'Sharing with coworkers…' : 'Share with coworkers…'} onClick={() => { setMenu(false); s.set({ modal: 'share' }) }} />
              {!ws.orchestrator && active && !active.remote && active.status !== 'running' && (
                <MenuItem label="Run in the cloud…" onClick={() => { setMenu(false); setCloudDialog(true) }} />
              )}
              <div className="my-1 border-t border-line" />
              <MenuItem label={ws.orchestrator ? 'Hide orchestrator' : 'Archive workspace'} danger={!ws.orchestrator} onClick={() => void archive()} />
            </div>
          )}
        </div>
        {!ws.orchestrator && <PrOwnerPill ws={ws} />}
        {ws.importedShare && <span className="text-[12px] text-faint">Shared by {ws.importedShare.sharedBy}</span>}
        {ws.share && (
          <button className="no-drag rounded px-1.5 py-0.5 text-[12px] text-add hover:bg-hover" onClick={() => s.set({ modal: 'share' })} title="Shared with coworkers">
            Shared
          </button>
        )}
        <div className="flex-1" />
        {project && (
          <button
            className={`no-drag flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[12px] ${threadsOpen ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
            onClick={() => toggleThreads(!threadsOpen)}
            title="Show this project's threads"
          >
            Threads <span className="text-faint">{chats.filter((c) => c.thread).length}</span>
          </button>
        )}
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ rightOpen: !s.rightOpen })} title="Toggle right panel">
          <IconPanelRight width={16} height={16} />
        </button>
      </header>

      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-line px-4">
        {(project ? chats.filter((c) => c.id === activeId) : chats).map((c) => {
          const on = !doc && c.id === activeId
          return (
            <div key={c.id} className={`group flex h-10 max-w-[220px] items-center gap-2 border-b-2 px-3 ${on ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              <button className="truncate" onClick={() => s.setActiveChat(ws.id, c.id)}>
                {c.status === 'running' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-add align-middle" />}
                {c.status !== 'running' && c.unread && c.id !== activeId && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" />}
                {project && !c.thread ? 'Orchestrator chat' : c.title}
              </button>
              {chats.length > 1 && !project && (
                <button title="Close chat" className="invisible rounded text-faint group-hover:visible hover:text-fg" onClick={() => void closeChatTab(c.id)}>
                  <IconX width={12} height={12} />
                </button>
              )}
            </div>
          )
        })}
        {reflect && (
          <div className={`flex h-10 items-center gap-2 border-b-2 px-3 ${doc?.kind === 'reflect' ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
            <button onClick={() => openDoc(ws.id, { kind: 'reflect', path: 'Reflect' })}>Reflect</button>
            <button title="Close Reflect" className="text-faint hover:text-fg" onClick={() => closeReflect(ws.id)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        )}
        {diffFile && (
          <div className="flex h-10 max-w-[260px] items-center gap-2 border-b-2 border-fg px-3">
            <span className="truncate font-mono text-[12px]">{diffFile.split('/').pop()}</span>
            {doc?.kind === 'file' && <span className="text-[11px] text-faint">file</span>}
            <button title="Close file" className="text-faint hover:text-fg" onClick={() => openDoc(ws.id, null)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        )}
        <button className="mb-2.5 ml-1 rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => void newChatTab(ws.id)} title={project ? 'New thread' : 'New chat (⌘T)'}>
          <IconPlus />
        </button>
        <div className="flex-1" />
        {active && active.model !== 'codex' && !ws.orchestrator && !active.remote && (
          <button
            className="mb-2.5 rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
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
        {active && active.model !== 'codex' && (
          <button className="mb-2.5 rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ modal: 'usage', usageChat: active.id })} title="Usage and context graphs">
            <IconChart />
          </button>
        )}
      </div>

      {/* An open diff or file takes the place of the chat history; the composer stays below it. */}
      {doc?.kind === 'diff' ? (
        <DiffView ws={ws} file={doc.path} line={doc.line} />
      ) : doc?.kind === 'file' ? (
        <FileView ws={ws} file={doc.path} line={doc.line} />
      ) : doc?.kind === 'reflect' && reflect ? (
        <ReflectView ws={ws} feedback={reflect.feedback} archiveAfter={reflect.archiveAfter} />
      ) : active ? (
        <ChatView chat={active} />
      ) : null}
      {active && doc?.kind !== 'reflect' ? (
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
      {reflecting && <SessionFeedback ws={ws} archive={false} onClose={() => setReflecting(false)} />}
      {cloudDialog && active && <RunInCloudDialog chat={active} ws={ws} onClose={() => setCloudDialog(false)} />}
    </main>
  )
  if (!project || !threadsOpen) return main
  return (
    <div className="flex min-w-0 flex-1">
      {main}
      <ThreadsPanel ws={ws} activeId={activeId} onClose={() => toggleThreads(false)} />
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

function MenuItem(p: { label: string; title?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={p.onClick} title={p.title} className={`block w-full rounded px-2 py-1.5 text-left hover:bg-hover ${p.danger ? 'text-del' : ''}`}>
      {p.label}
    </button>
  )
}

/** Says whose PR this workspace is on, so someone else's code never looks like yours. */
function PrOwnerPill({ ws }: { ws: Workspace }) {
  const review = usePrReview(ws)
  if (!review) return null
  const theirs = isTheirs(review.info)
  return (
    <button
      className={`no-drag flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] ${theirs ? 'border-sky-400/40 bg-sky-400/10 text-sky-400 hover:bg-sky-400/20' : 'border-line text-muted hover:bg-hover hover:text-fg'}`}
      title={theirs ? `${review.info.author}'s PR. Line comments go to your GitHub review by default.` : 'Your PR. Line comments go to the agent by default.'}
      onClick={() => useStore.getState().set({ rightTab: 'review' })}
    >
      <IconPR width={12} height={12} /> {prOwnerLabel(review.pr, review.info)}
    </button>
  )
}
