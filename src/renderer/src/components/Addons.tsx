import { useEffect, useRef, useState } from 'react'
import { ADDON_API_VERSION, ADDON_SCHEME, BACKGROUND_VIEW, isAddonRequest, type AddonContext, type AddonInfo, type AddonReply, type AddonSlot, type AddonToolCall, type AddonView } from '@shared/addons'
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

/** How long a tool call waits for its add-on's background page to come up. */
const TOOL_START_MS = 20_000

/**
 * One add-on frame: a sandboxed page with no access to the app, plus the bridge that answers its
 * `window.choo` calls. The frame is identified by its window, never by what it says about itself,
 * and every call goes to the main process, which checks the add-on's permissions.
 *
 * With `background`, the frame is the add-on's background page: it lives in a window nobody sees
 * and also takes the orchestrator's tool calls.
 */
export function AddonFrame({ addon, view, repoId, workspaceId, background }: { addon: AddonInfo; view: Pick<AddonView, 'id' | 'entry' | 'title'>; repoId?: string; workspaceId?: string; background?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const prs = !!addon.manifest?.permissions.includes('prs:read')

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    const context: AddonContext = { viewId: view.id, repoId, workspaceId }
    const post = (m: AddonReply) => frame.contentWindow?.postMessage(m, '*')
    // Nothing is sent until the page says hello, so a frame that failed to load gets no data.
    let live = false
    // Tool calls this frame was given and hasn't answered, and ones waiting for it to say hello.
    const open = new Set<string>()
    let early: AddonToolCall[] = []
    const giveTool = (c: AddonToolCall) => {
      open.add(c.callId)
      post({ choo: 1, type: 'tool', id: c.callId, name: c.name, input: c.input, context: c.context })
    }

    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !isAddonRequest(e.data)) return
      const m = e.data
      if (m.type === 'hello') {
        live = true
        post({ choo: 1, type: 'init', context, apiVersion: ADDON_API_VERSION, ...viewTheme(useStore.getState().settings) })
        early.forEach(giveTool)
        early = []
        return
      }
      if (m.type === 'tool-result') {
        // Only an answer to a call this frame was actually given goes anywhere.
        if (open.delete(m.id)) void window.api.addonToolResult(m.id, { ok: m.ok, result: m.result, error: m.error })
        return
      }
      void window.api.addonCall(addon.key, m.method, m.args, context).then(
        (r) => post({ choo: 1, type: 'result', id: m.id, ...r }),
        (err) => post({ choo: 1, type: 'result', id: m.id, ok: false, error: String(err instanceof Error ? err.message : err) })
      )
    }
    window.addEventListener('message', onMessage)

    // Pings with no data: the page asks for what it's allowed to see.
    let timer: number | undefined
    const pingWorkspaces = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => live && post({ choo: 1, type: 'event', name: 'workspaces' }), 250)
    }
    // A view hears about workspaces from this window's state. The background window has none, so the app tells it.
    const unsubscribe = background
      ? () => {}
      : useStore.subscribe((s, prev) => {
          if (s.workspaces !== prev.workspaces || s.chats !== prev.chats || s.permissions !== prev.permissions) pingWorkspaces()
        })
    const offEvents = window.api.onAddonEvent((e) => {
      if (!live) return
      if (e.name === 'workspaces') background && pingWorkspaces()
      else if (e.name === 'prs') prs && post({ choo: 1, type: 'event', name: 'prs', workspaceId: e.workspaceId })
      else if (e.name === 'store' && e.addon === addon.key) post({ choo: 1, type: 'event', name: 'store', key: e.key })
    })
    const offTools = background
      ? window.api.onAddonTool((c) => {
          if (c.addon !== addon.key) return
          if (live) return giveTool(c)
          early.push(c)
          window.setTimeout(() => {
            if (!early.includes(c)) return
            early = early.filter((x) => x !== c)
            void window.api.addonToolResult(c.callId, { ok: false, error: `${addon.name}'s background page didn't start` })
          }, TOOL_START_MS)
        })
      : () => {}
    const onTheme = () => live && post({ choo: 1, type: 'event', name: 'theme', ...viewTheme(useStore.getState().settings) })
    window.addEventListener(APPEARANCE_EVENT, onTheme)

    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener(APPEARANCE_EVENT, onTheme)
      window.clearTimeout(timer)
      unsubscribe()
      offEvents()
      offTools()
      // The page is going away: don't leave the orchestrator waiting for it.
      for (const id of [...open, ...early.map((c) => c.callId)]) void window.api.addonToolResult(id, { ok: false, error: `${addon.name} was restarted before it answered` })
    }
  }, [addon.key, addon.version, view.id, view.entry, repoId, workspaceId, background, prs])

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

/**
 * All there is in the unseen background window: one frame for each add-on that is on and has a
 * background page. The window is opened and closed by the main process (addonHost.ts).
 */
export function AddonBackgrounds() {
  const [addons, setAddons] = useState<AddonInfo[]>([])
  useEffect(() => {
    const load = () => void window.api.addonsList().then(setAddons, () => {})
    load()
    return window.api.onAddonsChanged(load)
  }, [])
  return (
    <>
      {addons
        .filter((a) => a.state === 'on' && a.manifest?.background)
        .map((a) => (
          <AddonFrame key={`${a.key}/${a.version}`} addon={a} view={{ id: BACKGROUND_VIEW, entry: a.manifest!.background!, title: 'Background' }} background />
        ))}
    </>
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
