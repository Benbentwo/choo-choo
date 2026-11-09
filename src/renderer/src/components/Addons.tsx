import { useEffect, useRef } from 'react'
import { ADDON_API_VERSION, ADDON_SCHEME, isAddonRequest, type AddonContext, type AddonInfo, type AddonReply, type AddonSlot, type AddonView } from '@shared/addons'
import { monoFontStack, uiFontStack, type AppearanceSettings } from '@shared/themes'
import { useStore, type AddonPage as Page } from '../store'
import { APPEARANCE_EVENT, resolved } from '../appearance'
import { IconAddon, IconRight, IconSidebar } from '../icons'

/** The views running add-ons contribute to a slot. */
export function addonViews(addons: AddonInfo[], slot: AddonSlot): { addon: AddonInfo; view: AddonView }[] {
  return addons.filter((a) => a.state === 'on').flatMap((a) => (a.manifest?.views ?? []).filter((v) => v.slot === slot).map((view) => ({ addon: a, view })))
}

export const addonTabId = (addon: AddonInfo, view: AddonView) => `addon:${addon.key}/${view.id}` as const

/** Theme colors and fonts a view gets as `--choo-*` CSS variables. */
function viewTheme(a: AppearanceSettings): { theme: Record<string, string>; dark: boolean } {
  const { theme, accent } = resolved(a)
  return { theme: { ...theme.tokens, accent, 'font-sans': uiFontStack(a.uiFont), 'font-mono': monoFontStack(a.monoFont) }, dark: theme.dark }
}

/**
 * One add-on view: a sandboxed frame with no access to the app, plus the bridge that answers its
 * `window.choo` calls. The frame is identified by its window, never by what it says about itself,
 * and every call goes to the main process, which checks the add-on's permissions.
 */
export function AddonFrame({ addon, view, repoId, workspaceId }: { addon: AddonInfo; view: AddonView; repoId?: string; workspaceId?: string }) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    const context: AddonContext = { viewId: view.id, repoId, workspaceId }
    const post = (m: AddonReply) => frame.contentWindow?.postMessage(m, '*')
    // Nothing is sent until the view says hello, so a frame that failed to load gets no data.
    let live = false

    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !isAddonRequest(e.data)) return
      const m = e.data
      if (m.type === 'hello') {
        live = true
        post({ choo: 1, type: 'init', context, apiVersion: ADDON_API_VERSION, ...viewTheme(useStore.getState().settings) })
        return
      }
      void window.api.addonCall(addon.key, m.method, m.args, context).then(
        (r) => post({ choo: 1, type: 'result', id: m.id, ...r }),
        (err) => post({ choo: 1, type: 'result', id: m.id, ok: false, error: String(err instanceof Error ? err.message : err) })
      )
    }
    window.addEventListener('message', onMessage)

    // A ping with no data: the view asks for what it's allowed to see.
    let timer: number | undefined
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.workspaces === prev.workspaces && s.chats === prev.chats && s.permissions === prev.permissions) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => live && post({ choo: 1, type: 'event', name: 'workspaces' }), 250)
    })
    const onTheme = () => live && post({ choo: 1, type: 'event', name: 'theme', ...viewTheme(useStore.getState().settings) })
    window.addEventListener(APPEARANCE_EVENT, onTheme)

    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener(APPEARANCE_EVENT, onTheme)
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [addon.key, addon.version, view.id, repoId, workspaceId])

  const query = new URLSearchParams({ view: view.id, ...(repoId ? { repo: repoId } : {}), ...(workspaceId ? { workspace: workspaceId } : {}) })
  return (
    <iframe
      ref={ref}
      // A new frame per place it is mounted, so one view never shows another context's state.
      key={`${addon.key}/${view.id}/${repoId ?? ''}/${workspaceId ?? ''}/${addon.version}`}
      title={`${addon.name}: ${view.title}`}
      src={`${ADDON_SCHEME}://${addon.key}/${view.entry}?${query}`}
      sandbox="allow-scripts allow-forms"
      className="h-full w-full flex-1 border-0 bg-bg"
    />
  )
}

/** An add-on view filling the center, opened from the sidebar. */
export function AddonPage({ page }: { page: Page }) {
  const s = useStore()
  const addon = s.addons.find((a) => a.key === page.key && a.state === 'on')
  const view = addon?.manifest?.views.find((v) => v.id === page.viewId)
  const repo = page.repoId ? s.repos.find((r) => r.id === page.repoId) : undefined

  // The add-on was turned off or removed while its view was open.
  useEffect(() => {
    if (!addon || !view) useStore.getState().set({ addonPage: null })
  }, [addon, view])
  if (!addon || !view) return null

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg">
      <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        {!s.sidebarOpen && (
          <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
        {repo && (
          <>
            <span className="text-muted">{repo.name}</span>
            <IconRight className="text-faint" />
          </>
        )}
        <span className="truncate">{view.title}</span>
        <div className="flex-1" />
        <button
          className="no-drag flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] text-faint hover:bg-hover hover:text-fg"
          title={`This view comes from the ${addon.name} add-on. Click to manage add-ons.`}
          onClick={() => s.set({ modal: 'settings', settingsTab: 'addons' })}
        >
          <IconAddon />
          {addon.name}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <AddonFrame addon={addon} view={view} repoId={page.repoId} />
      </div>
    </main>
  )
}
