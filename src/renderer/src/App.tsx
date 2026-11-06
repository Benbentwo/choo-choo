import { useEffect } from 'react'
import { useStore, refreshState, refreshStats, addRepository, newWorkspace, newChatTab, closeChatTab, goToNextUnread, addPermission, removePermission } from './store'
import { Sidebar } from './components/Sidebar'
import { Center } from './components/Center'
import { RightPanel } from './components/RightPanel'
import { Home } from './components/Home'
import { NewWorkspace } from './components/NewWorkspace'
import { Modals } from './components/Modals'
import { useAppearance } from './appearance'
import { useShareRefresh } from './components/ShareModals'

export function App() {
  const s = useStore()
  useAppearance()
  const ws = s.workspaces.find((w) => w.id === s.selectedWs && !w.archived) ?? null
  useShareRefresh(ws)

  useEffect(() => {
    void window.api.pendingPermissions().then((list) => list.forEach(addPermission))
    void refreshState().then(() => {
      for (const w of useStore.getState().workspaces) if (!w.archived) void refreshStats(w.id)
    })
    const offChat = window.api.onChatEvent((e) => {
      const st = useStore.getState()
      if (e.item) st.upsertItem(e.chatId, e.item)
      if (e.permission) addPermission(e.permission)
      if (e.permissionDone) removePermission(e.permissionDone)
      if (e.chat) {
        st.upsertChat(e.chat)
        if (e.chat.status !== 'running') void refreshStats(e.chat.workspaceId)
      }
      if (e.item?.kind === 'tool') {
        const chat = st.chats.find((c) => c.id === e.chatId)
        if (chat) void refreshStats(chat.workspaceId)
      }
    })
    const offMenu = window.api.onMenu((action) => {
      const st = useStore.getState()
      const cur = st.selectedWs
      const curWs = st.workspaces.find((w) => w.id === cur)
      switch (action) {
        case 'add-repo':
          return void addRepository()
        case 'search':
          return st.set({ modal: st.modal === 'palette' ? null : 'palette' })
        case 'settings':
          return st.set({ modal: 'settings' })
        case 'open-share':
          return st.set({ modal: 'open-share' })
        case 'new-workspace':
          if (curWs) newWorkspace(curWs.repoId)
          return
        case 'new-chat':
          if (cur) void newChatTab(cur)
          return
        case 'close-chat':
          if (cur && st.activeChat[cur]) void closeChatTab(st.activeChat[cur])
          return
        case 'next-unread':
          return goToNextUnread()
        case 'toggle-sidebar':
          return st.set({ sidebarOpen: !st.sidebarOpen })
        case 'toggle-right':
          return st.set({ rightOpen: !st.rightOpen })
        case 'toggle-terminal':
          return st.set({ bottomOpen: !st.bottomOpen, rightOpen: true })
      }
    })
    const offState = window.api.onStateChanged(() => void refreshState())
    const offLink = window.api.onOpenShareLink((link) => useStore.getState().set({ modal: 'open-share', shareLinkDraft: link }))
    const offNav = window.api.onNavigate((wsId, chatId) => {
      useStore.getState().setActiveChat(wsId, chatId)
      useStore.getState().selectWorkspace(wsId)
    })
    return () => {
      offLink()
      offState()
      offNav()
      offChat()
      offMenu()
    }
  }, [])

  return (
    <div className="flex h-full">
      {s.sidebarOpen && <Sidebar />}
      <div className="flex min-w-0 flex-1">
        {ws ? (
          <>
            <Center ws={ws} />
            {s.rightOpen && !ws.orchestrator && <RightPanel ws={ws} />}
          </>
        ) : s.draftRepo ? (
          <NewWorkspace repoId={s.draftRepo} />
        ) : (
          <Home />
        )}
      </div>
      <Modals />
      {s.error && (
        <div className="anim-toast fixed right-4 bottom-4 z-50 max-w-md rounded-lg border border-del/40 bg-raised px-4 py-3 text-[12px] shadow-xl">
          <div className="mb-1 font-medium text-del">Something went wrong</div>
          <div className="selectable text-muted whitespace-pre-wrap">{s.error}</div>
          <button className="mt-2 text-muted hover:text-fg" onClick={() => s.set({ error: null })}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
