import { useEffect } from 'react'
import { useStore, refreshState, refreshStats, addRepository, newWorkspace, newChatTab, closeChatTab, goToNextUnread, addPermission, removePermission, openPalette, loadModelDetails, refreshAddons, refreshPrInbox, loadStack, splitPane, closePane, toggleMaximize, focusDir, openWorkspaceBeside } from './store'
import { Sidebar } from './components/Sidebar'
import { Panes } from './components/Panes'
import { RightPanel } from './components/RightPanel'
import { Home } from './components/Home'
import { PrInboxPage } from './components/PrInbox'
import { NewWorkspace } from './components/NewWorkspace'
import { Modals } from './components/Modals'
import { TitleTips } from './components/Tip'
import { useAppearance } from './appearance'
import { useShareRefresh } from './components/ShareModals'

export function App() {
  const s = useStore()
  useAppearance()
  const ws = s.workspaces.find((w) => w.id === s.selectedWs && !w.archived) ?? null
  // While an add-on page or empty pane has focus, the right panel keeps showing the last workspace, so the panes don't jump.
  const rightWs = s.workspaces.find((w) => w.id === s.rightWs && !w.archived) ?? null
  useShareRefresh(ws)

  // A project added later may pin add-ons too.
  const repoCount = s.repos.length
  useEffect(() => {
    if (repoCount) void refreshAddons()
  }, [repoCount])

  useEffect(() => {
    void window.api.pendingPermissions().then((list) => list.forEach(addPermission))
    void loadModelDetails()
    void refreshAddons()
    // The PRs count in the sidebar stays current in the background; the PRs page reloads more often.
    void refreshPrInbox()
    const prTimer = setInterval(() => void refreshPrInbox(), 5 * 60_000)
    const offAddons = window.api.onAddonsChanged(() => void refreshAddons())
    void refreshState().then(() => {
      for (const w of useStore.getState().workspaces) if (!w.archived) void refreshStats(w.id)
    })
    const offChat = window.api.onChatEvent((e) => {
      const st = useStore.getState()
      if (e.item) st.upsertItem(e.chatId, e.item)
      if (e.permission) addPermission(e.permission)
      if (e.permissionDone) removePermission(e.permissionDone)
      if (e.tasks) st.set({ tasks: { ...st.tasks, [e.chatId]: e.tasks } })
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
          return openPalette('all')
        case 'file-picker':
          return openPalette('files')
        case 'search-files':
          return openPalette('grep')
        case 'settings':
          return st.set({ modal: 'settings' })
        case 'comment-mode':
          return void window.dispatchEvent(new Event('choo:comment-mode'))
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
        case 'split-right':
          return st.panesShown && splitPane('right')
        case 'split-down':
          return st.panesShown && splitPane('bottom')
        case 'close-pane':
          return st.panesShown && closePane()
        case 'maximize-pane':
          return st.panesShown && toggleMaximize()
        case 'focus-left':
        case 'focus-right':
        case 'focus-top':
        case 'focus-bottom':
          return st.panesShown && focusDir(action.slice(6) as 'left' | 'right' | 'top' | 'bottom')
      }
    })
    const offState = window.api.onStateChanged(() => void refreshState())
    const offPr = window.api.onPrChanged((wsId) => {
      const st = useStore.getState()
      st.set({ prVersion: { ...st.prVersion, [wsId]: (st.prVersion[wsId] ?? 0) + 1 } })
    })
    const offStack = window.api.onStackChanged((wsId) => void loadStack(wsId))
    const offLink = window.api.onOpenShareLink((link) => useStore.getState().set({ modal: 'open-share', shareLinkDraft: link }))
    const offNav = window.api.onNavigate((wsId, chatId, beside) => {
      if (beside) return openWorkspaceBeside(wsId, chatId, beside)
      useStore.getState().setActiveChat(wsId, chatId)
      useStore.getState().selectWorkspace(wsId)
    })
    return () => {
      offStack()
      clearInterval(prTimer)
      offAddons()
      offLink()
      offState()
      offPr()
      offNav()
      offChat()
      offMenu()
    }
  }, [])

  return (
    <div className="flex h-full">
      {s.sidebarOpen && <Sidebar />}
      <div className="flex min-w-0 flex-1">
        {s.panesShown && s.layout ? (
          <>
            <Panes />
            {s.rightOpen && rightWs && !rightWs.orchestrator && <RightPanel ws={rightWs} />}
          </>
        ) : s.prsPage ? (
          <PrInboxPage />
        ) : s.draftRepo ? (
          <NewWorkspace repoId={s.draftRepo} />
        ) : (
          <Home />
        )}
      </div>
      <Modals />
      <TitleTips />
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
