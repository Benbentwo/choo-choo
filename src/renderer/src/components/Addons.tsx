import { useEffect, useRef, useState } from 'react'
import { ADDON_API_VERSION, ADDON_SCHEME, BACKGROUND_VIEW, addonActions, isAddonRequest, type AddonActionContext, type AddonActionIcon, type AddonActionPlace, type AddonActionPress, type AddonContext, type AddonInfo, type AddonReply, type AddonSlot, type AddonToolCall, type AddonView } from '@shared/addons'
import { monoFontStack, uiFontStack, type AppearanceSettings } from '@shared/themes'
import { runAddonAction, useStore } from '../store'
import { APPEARANCE_EVENT, resolved } from '../appearance'
import { IconAddon, IconBranch, IconChart, IconCheck, IconComment, IconEye, IconFile, IconFolder, IconImport, IconPlay, IconPlus, IconPR, IconRefresh, IconRight, IconSearch, IconSidebar, IconTool } from '../icons'

/** The views running add-ons contribute to a slot. */
export function addonViews(addons: AddonInfo[], slot: AddonSlot): { addon: AddonInfo; view: AddonView }[] {
  return addons.filter((a) => a.state === 'on').flatMap((a) => (a.manifest?.views ?? []).filter((v) => v.slot === slot).map((view) => ({ addon: a, view })))
}

export const ACTION_ICON: Record<AddonActionIcon, typeof IconPlus> = {
  plus: IconPlus,
  import: IconImport,
  refresh: IconRefresh,
  search: IconSearch,
  play: IconPlay,
  check: IconCheck,
  branch: IconBranch,
  pr: IconPR,
  file: IconFile,
  folder: IconFolder,
  chart: IconChart,
  comment: IconComment,
  eye: IconEye,
  tool: IconTool
}

/**
 * The buttons add-ons asked for in one place of the app. The app draws them from the manifest's
 * words and its own icons: nothing of the add-on's runs here. `view` narrows it to the buttons on
 * that view's own row.
 */
export function AddonActions({ place, repoId, workspaceId, view, className = 'p-1 text-muted hover:bg-raised', before }: AddonActionContext & { place: AddonActionPlace; view?: { key: string; viewId: string }; className?: string; before?: () => void }) {
  const addons = useStore((s) => s.addons)
  const ctx = { ...(repoId ? { repoId } : {}), ...(workspaceId ? { workspaceId } : {}) }
  const list = addonActions(addons, place, ctx, view)
  if (!list.length) return null
  return (
    <>
      {list.map(({ addon, action }) => {
        const Icon = ACTION_ICON[action.icon]
        const press = (e: { stopPropagation(): void; preventDefault(): void }) => {
          e.stopPropagation()
          e.preventDefault()
          before?.()
          runAddonAction(addon, action, ctx)
        }
        return (
          // Not a <button>: some of these sit on rows that are buttons themselves.
          <span
            key={`${addon.key}/${action.id}`}
            role="button"
            tabIndex={0}
            title={`${action.title} (${addon.name} add-on)`}
            aria-label={action.title}
            data-addon-action={`${addon.key}/${action.id}`}
            className={`no-drag shrink-0 cursor-default rounded hover:text-fg ${className}`}
            onClick={press}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && press(e)}
          >
            <Icon width={15} height={15} />
          </span>
        )
      })}
    </>
  )
}

export const addonTabId = (addon: AddonInfo, view: AddonView) => `addon:${addon.key}/${view.id}` as const

/** Theme colors and fonts a view gets as `--choo-*` CSS variables. */
function viewTheme(a: AppearanceSettings): { theme: Record<string, string>; dark: boolean } {
  const { theme, accent } = resolved(a)
  return { theme: { ...theme.tokens, accent, 'font-sans': uiFontStack(a.uiFont), 'font-mono': monoFontStack(a.monoFont) }, dark: theme.dark }
}

/** How long a button press waits for the view it opened to come up. */
const PRESS_KEPT_MS = 15_000

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
  // A button press meant for this frame. It is handed over once the page is up, then forgotten.
  const waiting = useStore((s) => (!background && s.addonPress && s.addonPress.key === addon.key && s.addonPress.viewId === view.id && s.addonPress.repoId === repoId && s.addonPress.workspaceId === workspaceId ? s.addonPress : null))
  const liveRef = useRef(false)
  const sayPress = (press: AddonActionPress) => ref.current?.contentWindow?.postMessage({ choo: 1, type: 'event', name: 'action', ...press } satisfies AddonReply, '*')
  const handOver = () => {
    const p = useStore.getState().addonPress
    if (!p || !liveRef.current || p.key !== addon.key || p.viewId !== view.id || p.repoId !== repoId || p.workspaceId !== workspaceId) return
    useStore.getState().set({ addonPress: null })
    // A press nobody could take in time is dropped: it must not fire when the view is opened later.
    if (Date.now() - p.at < PRESS_KEPT_MS) sayPress(p.press)
  }
  useEffect(() => {
    if (!background) handOver()
  }, [waiting?.n])
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
    // Presses for a background page that came before it said hello.
    let earlyPresses: AddonActionPress[] = []
    const giveTool = (c: AddonToolCall) => {
      open.add(c.callId)
      post({ choo: 1, type: 'tool', id: c.callId, name: c.name, input: c.input, context: c.context })
    }

    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !isAddonRequest(e.data)) return
      const m = e.data
      if (m.type === 'hello') {
        live = true
        liveRef.current = true
        post({ choo: 1, type: 'init', context, apiVersion: ADDON_API_VERSION, ...viewTheme(useStore.getState().settings) })
        earlyPresses.forEach(sayPress)
        earlyPresses = []
        if (!background) handOver()
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
    // Not behind `live`: a press must not be lost because the background page was still starting.
    const offPresses = background
      ? window.api.onAddonEvent((e) => {
          if (e.name !== 'action' || e.addon !== addon.key) return
          if (live) sayPress(e.press)
          else earlyPresses = [...earlyPresses, e.press].slice(-20)
        })
      : () => {}
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
      liveRef.current = false
      offPresses()
      window.removeEventListener('message', onMessage)
      window.removeEventListener(APPEARANCE_EVENT, onTheme)
      window.clearTimeout(timer)
      unsubscribe()
      offEvents()
      offTools()
      // The page is going away: don't leave the orchestrator waiting for it.
      for (const id of [...open, ...early.map((c) => c.callId)]) void window.api.addonToolResult(id, { ok: false, error: `${addon.name} was restarted before it answered` })
    }
  }, [addon.key, addon.version, addon.rev, view.id, view.entry, repoId, workspaceId, background, prs])

  const query = new URLSearchParams({ view: view.id, ...(repoId ? { repo: repoId } : {}), ...(workspaceId ? { workspace: workspaceId } : {}) })
  return (
    <iframe
      ref={ref}
      // A new frame per place it is mounted, so one view never shows another context's state.
      key={`${addon.key}/${view.id}/${repoId ?? ''}/${workspaceId ?? ''}/${addon.version}/${addon.rev ?? 0}`}
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
          <AddonFrame key={`${a.key}/${a.version}/${a.rev ?? 0}`} addon={a} view={{ id: BACKGROUND_VIEW, entry: a.manifest!.background!, title: 'Background' }} background />
        ))}
    </>
  )
}

