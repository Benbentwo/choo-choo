import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore, openDoc, newChatTab, closeChatTab, refreshState, reportError, nextUnread, goToNextUnread } from '../store'
import { IconDots, IconPanelRight, IconPlus, IconRight, IconSidebar, IconX } from '../icons'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { DiffView } from './DiffView'
import { FileView } from './FileView'
import { MergedBar, ReflectModal } from './Reflect'

export function Center({ ws }: { ws: Workspace }) {
  const s = useStore()
  const repo = s.repos.find((r) => r.id === ws.repoId)
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const activeId = s.activeChat[ws.id] && chats.some((c) => c.id === s.activeChat[ws.id]) ? s.activeChat[ws.id] : chats[0]?.id
  const active = chats.find((c) => c.id === activeId)
  const doc = s.openDoc[ws.id] ?? null
  const diffFile = doc?.path ?? null
  const [menu, setMenu] = useState(false)
  const [reflecting, setReflecting] = useState(false)

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
    if (active?.unread && !diffFile && active.status !== 'running') {
      void window.api.updateChat(active.id, { unread: false }).then((c) => useStore.getState().upsertChat(c))
    }
  }, [active?.id, active?.unread, diffFile])

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

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg">
      <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        {!s.sidebarOpen && (
          <button className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
        <span className="text-muted">{repo?.name}</span>
        <IconRight className="text-faint" />
        <span className="no-drag selectable truncate">{ws.orchestrator ? 'Orchestrator' : ws.branch}</span>
        <div className="no-drag relative">
          <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => setMenu(!menu)}>
            <IconDots />
          </button>
          {menu && (
            <div className="absolute top-7 left-0 z-20 w-56 rounded-lg border border-line bg-raised p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
              <MenuItem label="Reveal in Finder" onClick={() => { setMenu(false); void window.api.revealInFinder(ws.path) }} />
              <MenuItem label="Copy path" onClick={() => { setMenu(false); void navigator.clipboard.writeText(ws.path) }} />
              <MenuItem label="Copy branch name" onClick={() => { setMenu(false); void navigator.clipboard.writeText(ws.branch) }} />
              <MenuItem label="Reflect on this session…" onClick={() => { setMenu(false); setReflecting(true) }} />
              <MenuItem label={ws.share ? 'Sharing with coworkers…' : 'Share with coworkers…'} onClick={() => { setMenu(false); s.set({ modal: 'share' }) }} />
              <div className="my-1 border-t border-line" />
              <MenuItem label={ws.orchestrator ? 'Hide orchestrator' : 'Archive workspace'} danger={!ws.orchestrator} onClick={() => void archive()} />
            </div>
          )}
        </div>
        {ws.importedShare && <span className="text-[12px] text-faint">Shared by {ws.importedShare.sharedBy}</span>}
        {ws.share && (
          <button className="no-drag rounded px-1.5 py-0.5 text-[12px] text-add hover:bg-hover" onClick={() => s.set({ modal: 'share' })} title="Shared with coworkers">
            Shared
          </button>
        )}
        <div className="flex-1" />
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ rightOpen: !s.rightOpen })} title="Toggle right panel">
          <IconPanelRight width={16} height={16} />
        </button>
      </header>

      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-line px-4">
        {chats.map((c) => {
          const on = !diffFile && c.id === activeId
          return (
            <div key={c.id} className={`group flex h-10 max-w-[220px] items-center gap-2 border-b-2 px-3 ${on ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              <button className="truncate" onClick={() => s.setActiveChat(ws.id, c.id)}>
                {c.status === 'running' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-add align-middle" />}
                {c.status !== 'running' && c.unread && c.id !== activeId && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" />}
                {c.title}
              </button>
              {chats.length > 1 && (
                <button className="invisible rounded text-faint group-hover:visible hover:text-fg" onClick={() => void closeChatTab(c.id)}>
                  <IconX width={12} height={12} />
                </button>
              )}
            </div>
          )
        })}
        {diffFile && (
          <div className="flex h-10 max-w-[260px] items-center gap-2 border-b-2 border-fg px-3">
            <span className="truncate font-mono text-[12px]">{diffFile.split('/').pop()}</span>
            {doc?.kind === 'file' && <span className="text-[11px] text-faint">file</span>}
            <button className="text-faint hover:text-fg" onClick={() => openDoc(ws.id, null)}>
              <IconX width={12} height={12} />
            </button>
          </div>
        )}
        <button className="mb-2.5 ml-1 rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => void newChatTab(ws.id)} title="New chat (⌘T)">
          <IconPlus />
        </button>
      </div>

      {doc?.kind === 'diff' ? (
        <DiffView ws={ws} file={doc.path} />
      ) : doc?.kind === 'file' ? (
        <FileView ws={ws} file={doc.path} />
      ) : active ? (
        <>
          <ChatView chat={active} />
          {hasNextUnread && (
            <div className="mx-auto -mb-1 flex w-full max-w-3xl justify-end px-8">
              <button className="flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1 text-[12px] hover:bg-hover" onClick={goToNextUnread}>
                Next unread <IconRight />
              </button>
            </div>
          )}
          <MergedBar ws={ws} onArchive={archive} />
          <Composer chat={active} ws={ws} />
        </>
      ) : null}
      {reflecting && <ReflectModal ws={ws} archiveAfter={false} onClose={() => setReflecting(false)} onArchive={archive} />}
    </main>
  )
}

function MenuItem(p: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={p.onClick} className={`block w-full rounded px-2 py-1.5 text-left hover:bg-hover ${p.danger ? 'text-del' : ''}`}>
      {p.label}
    </button>
  )
}
