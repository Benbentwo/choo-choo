import { useEffect, useMemo, useRef, useState } from 'react'
import * as L from '@shared/layout'
import {
  useStore,
  focusLeaf,
  splitPane,
  closePane,
  toggleMaximize,
  setPaneSizes,
  setGroupSizes,
  dropOnLeaf,
  applyPreset,
  saveLayoutAs,
  openSavedLayout,
  deleteSavedLayout,
  showView,
  viewFor,
  newWorkspace,
  type DragItem
} from '../store'
import { IconAddon, IconFolder, IconGrip, IconMaximize, IconPanelRight, IconSearch, IconSidebar, IconSingle, IconSplitDown, IconSplitRight, IconX, IconDown, IconPlus } from '../icons'
import { Center, DotsMenu, MenuItem, StatusDot } from './Center'
import { AddonFrame, addonViews } from './Addons'

/**
 * The center of the window, split into panes (docs/prd/split-panels.md). Every pane is drawn at
 * the same place in the React tree whatever the shape of the layout, so splitting, moving or
 * resizing never remounts a pane: chats keep their scroll, add-on pages don't reload.
 */
export function Panes() {
  const s = useStore()
  const layout = s.layout
  if (!layout) return null
  const all = L.leaves(layout)
  const multi = all.length > 1
  const max = multi ? layout.maximized : null
  const { leaves: boxes, dividers } = L.boxes(layout.root)
  const outer = s.drag && s.drag.kind !== 'tab' ? s.drag : null

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-bg">
      {multi ? <PanesTitleBar layout={layout} /> : null}
      <div className={`relative min-h-0 flex-1 ${multi ? 'm-[3px]' : ''}`}>
        {all.map((l) => {
          const b = max ? (l.id === max ? { x: 0, y: 0, w: 1, h: 1 } : null) : boxes.get(l.id)
          const focused = l.id === layout.focus
          return (
            <div
              key={l.id}
              data-pane={l.id}
              className="absolute"
              style={b ? { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` } : { display: 'none' }}
              onMouseDownCapture={() => focusLeaf(l.id)}
            >
              <div className={`h-full ${multi ? 'p-[3px]' : ''}`}>
                <div
                  className={`flex h-full flex-col overflow-hidden ${
                    multi ? `rounded-[9px] border bg-bg ${focused ? 'border-accent/70 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : 'border-line'}` : ''
                  }`}
                >
                  <LeafView leaf={l} framed={multi} focused={multi && focused} />
                </div>
              </div>
              {outer && (
                <DropOverlay
                  canDrop={(side) => !(outer.kind === 'leaf' && outer.leafId === l.id) && !(side === undefined && outer.kind !== 'leaf' && showsItem(l, outer))}
                  labels={outer.kind === 'leaf' ? { center: 'Swap panes' } : undefined}
                  onDrop={(side) => dropOnLeaf(outer, l.id, side)}
                />
              )}
            </div>
          )
        })}
        {!max && multi && <Dividers dividers={dividers} />}
      </div>
    </div>
  )
}

const showsItem = (l: L.Leaf, d: DragItem) =>
  (d.kind === 'ws' && l.view.kind === 'workspace' && l.view.wsId === d.wsId) || (d.kind === 'addon' && l.view.kind === 'addon' && l.view.key === d.key && l.view.viewId === d.viewId)

function LeafView({ leaf, framed, focused }: { leaf: L.Leaf; framed: boolean; focused: boolean }) {
  const ws = useStore((s) => (leaf.view.kind === 'workspace' ? s.workspaces.find((w) => w.id === (leaf.view as { wsId: string }).wsId) : undefined))
  if (leaf.view.kind === 'workspace') return ws ? <Center ws={ws} leaf={leaf} framed={framed} focused={focused} /> : null
  if (leaf.view.kind === 'addon') return <AddonPane leaf={leaf} view={leaf.view} framed={framed} focused={focused} />
  return <EmptyPane leaf={leaf} framed={framed} focused={focused} />
}

/** The bar above the panes when there are several: the layout menu, what's open, and split buttons. It's the window's title bar. */
function PanesTitleBar({ layout }: { layout: L.Layout }) {
  const s = useStore()
  const all = L.leaves(layout)
  const wsIds = all.flatMap((l) => (l.view.kind === 'workspace' ? [l.view.wsId] : []))
  const repos = new Set(wsIds.map((id) => s.workspaces.find((w) => w.id === id)?.repoId).filter(Boolean))
  const pages = all.filter((l) => l.view.kind === 'addon').length
  const parts = [
    wsIds.length ? `${wsIds.length} workspace${wsIds.length === 1 ? '' : 's'}` : '',
    repos.size > 1 ? `${repos.size} repos` : '',
    pages ? `${pages} page${pages === 1 ? '' : 's'}` : '',
    `${all.length} panes`
  ].filter(Boolean)
  return (
    <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      {!s.sidebarOpen && (
        <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
          <IconSidebar width={16} height={16} />
        </button>
      )}
      <LayoutPill layout={layout} />
      <span className="truncate text-[12px] text-faint">{parts.join(' · ')}</span>
      <div className="flex-1" />
      {layout.maximized && (
        <button className="no-drag flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg" onClick={() => toggleMaximize(layout.maximized!)}>
          <IconMaximize width={12} height={12} /> Show all panes
        </button>
      )}
      <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => splitPane('right')} title="Split right (⌘\)">
        <IconSplitRight width={16} height={16} />
      </button>
      <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => splitPane('bottom')} title="Split down (⌘⇧\)">
        <IconSplitDown width={16} height={16} />
      </button>
      <button className={`no-drag rounded p-1 hover:bg-hover hover:text-fg ${s.rightOpen ? 'bg-hover text-fg' : 'text-muted'}`} onClick={() => s.set({ rightOpen: !s.rightOpen })} title="Toggle right panel">
        <IconPanelRight width={16} height={16} />
      </button>
    </header>
  )
}

function LayoutPill({ layout }: { layout: L.Layout }) {
  const name = useStore((s) => s.layoutName)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  const root = layout.root
  const icon = L.leaves(layout).length === 1 ? <IconSingle width={14} height={14} /> : L.isSplit(root) && root.dir === 'col' ? <IconSplitDown width={14} height={14} /> : <IconSplitRight width={14} height={14} />
  return (
    <div ref={ref} className="no-drag relative">
      <button
        className={`flex items-center gap-1.5 rounded-md border bg-panel px-2.5 py-1 text-[12.5px] text-fg hover:bg-hover ${open ? 'border-accent' : 'border-line'}`}
        onClick={() => setOpen(!open)}
        title="Layouts"
      >
        {icon}
        {name ?? L.layoutLabel(layout)}
        <IconDown width={12} height={12} className="text-faint" />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-40 w-64 rounded-lg border border-line bg-raised p-1 shadow-xl">
          <LayoutItems close={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** Items for a pane's ⋯ menu: split, maximize, close, and the layout presets. */
export function PaneMenuItems({ leafId, close }: { leafId: string; close: () => void }) {
  const layout = useStore((s) => s.layout)
  const many = !!layout && L.leaves(layout).length > 1
  const run = (fn: () => void) => () => {
    close()
    focusLeaf(leafId)
    fn()
  }
  return (
    <>
      <div className="px-2 pt-1 pb-0.5 text-[11px] text-faint">This pane</div>
      <MenuItem icon={<IconSplitRight />} label="Split right" hint="⌘\" onClick={run(() => splitPane('right'))} />
      <MenuItem icon={<IconSplitDown />} label="Split down" hint="⌘⇧\" onClick={run(() => splitPane('bottom'))} />
      {many && <MenuItem icon={<IconMaximize />} label={layout?.maximized === leafId ? 'Show all panes' : 'Maximize pane'} hint="⌘⇧↩" onClick={run(() => toggleMaximize(leafId))} />}
      {many && <MenuItem icon={<IconX />} label="Close pane" hint="⌘⌥W" onClick={run(() => closePane(leafId))} />}
      <div className="my-1 border-t border-line" />
      <LayoutItems close={close} />
    </>
  )
}

const PRESETS: { id: L.Preset; title: string; cells: string }[] = [
  { id: 'single', title: 'One pane', cells: 'row:1' },
  { id: 'columns-2', title: 'Two side by side', cells: 'row:2' },
  { id: 'rows-2', title: 'Two stacked', cells: 'col:2' },
  { id: 'columns-3', title: 'Three side by side', cells: 'row:3' }
]

function LayoutItems({ close }: { close: () => void }) {
  const s = useStore()
  const layout = s.layout
  const saved = s.settings.savedLayouts ?? []
  const [naming, setNaming] = useState(false)
  const cur = layout ? L.leaves(layout) : []
  const presetNow = !layout
    ? null
    : cur.length === 1
      ? 'single'
      : L.isSplit(layout.root) && layout.root.children.every((c) => c.kind === 'leaf')
        ? layout.root.dir === 'col' && cur.length === 2
          ? 'rows-2'
          : layout.root.dir === 'row' && cur.length <= 3
            ? (`columns-${cur.length}` as L.Preset)
            : null
        : null
  return (
    <>
      <div className="px-2 pt-1 pb-0.5 text-[11px] text-faint">Layouts</div>
      <div className="grid grid-cols-4 gap-1.5 px-1.5 pt-1 pb-1.5">
        {PRESETS.map((p) => {
          const [dir, n] = p.cells.split(':')
          const on = presetNow === p.id
          return (
            <button
              key={p.id}
              title={p.title}
              onClick={() => {
                close()
                applyPreset(p.id)
                useStore.getState().set({ layoutName: null })
              }}
              className={`flex h-[30px] gap-[2px] rounded border-[1.4px] p-[2px] hover:border-fg ${dir === 'col' ? 'flex-col' : ''} ${on ? 'border-accent' : 'border-faint'}`}
            >
              {Array.from({ length: Number(n) }, (_, i) => (
                <i key={i} className={`flex-1 rounded-[2px] ${on ? 'bg-accent/30' : 'bg-hover'}`} />
              ))}
            </button>
          )
        })}
      </div>
      {saved.map((x) => (
        <div key={x.name} className="group flex items-center rounded hover:bg-hover">
          <button
            className={`flex-1 truncate px-2 py-1.5 text-left ${s.layoutName === x.name ? 'text-accent' : ''}`}
            onClick={() => {
              close()
              openSavedLayout(x.name)
            }}
          >
            {x.name}
          </button>
          <button title={`Forget "${x.name}"`} className="invisible p-1 text-faint group-hover:visible hover:text-fg" onClick={() => deleteSavedLayout(x.name)}>
            <IconX width={12} height={12} />
          </button>
        </div>
      ))}
      {naming ? (
        <input
          autoFocus
          placeholder="Name this layout"
          maxLength={40}
          className="mx-1 my-1 w-[calc(100%-8px)] rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveLayoutAs(e.currentTarget.value)
              close()
            }
            if (e.key === 'Escape') setNaming(false)
          }}
        />
      ) : (
        layout && <MenuItem label="Save layout as…" onClick={() => setNaming(true)} />
      )}
    </>
  )
}

/** Drag a pane by this handle onto another pane to move or swap it. */
export function PaneGrip({ leafId }: { leafId: string }) {
  return (
    <span
      draggable
      title="Drag to move this pane"
      className="flex shrink-0 cursor-grab items-center rounded px-0.5 py-1 text-faint hover:bg-hover hover:text-muted"
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', leafId)
        useStore.getState().set({ drag: { kind: 'leaf', leafId } })
      }}
      onDragEnd={() => useStore.getState().set({ drag: null })}
    >
      <IconGrip width={14} height={14} />
    </span>
  )
}

/** The repo's name in a box, first in a pane header, so it's always clear which project a pane is from. */
export function RepoChip({ name }: { name: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-0.5 text-[12.5px] font-semibold whitespace-nowrap text-fg">
      <IconFolder width={13} height={13} className="text-muted" />
      {name}
    </span>
  )
}

/** Which part of a pane the pointer is over: an edge (split there) or the middle. */
export function zoneAt(r: DOMRect, x: number, y: number): L.Side | undefined {
  const fx = (x - r.left) / r.width
  const fy = (y - r.top) / r.height
  const edges: [L.Side, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy]
  ]
  const [side, d] = edges.reduce((a, b) => (b[1] < a[1] ? b : a))
  return d < 0.25 ? side : undefined
}

const OUTER_LABELS: Record<L.Side | 'center', string> = { left: 'Open on the left', right: 'Open on the right', top: 'Open above', bottom: 'Open below', center: 'Open here' }
const INNER_LABELS: Record<L.Side | 'center', string> = { left: 'Split left', right: 'Split right', top: 'Split up', bottom: 'Split down', center: 'Move here' }

/** Shown over a pane or group while something is dragged: highlights where it would land. */
export function DropOverlay(p: { onDrop: (side?: L.Side) => void; canDrop?: (side?: L.Side) => boolean; inner?: boolean; labels?: Partial<Record<L.Side | 'center', string>> }) {
  const [zone, setZone] = useState<L.Side | 'center' | null>(null)
  const labels = { ...(p.inner ? INNER_LABELS : OUTER_LABELS), ...p.labels }
  const box =
    zone === 'left'
      ? 'left-1 top-1 bottom-1 w-[calc(50%-4px)]'
      : zone === 'right'
        ? 'right-1 top-1 bottom-1 w-[calc(50%-4px)]'
        : zone === 'top'
          ? 'left-1 right-1 top-1 h-[calc(50%-4px)]'
          : zone === 'bottom'
            ? 'left-1 right-1 bottom-1 h-[calc(50%-4px)]'
            : 'inset-1'
  return (
    <div
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        const side = zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
        if (p.canDrop && !p.canDrop(side)) return setZone(null)
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setZone(side ?? 'center')
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const side = zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
        setZone(null)
        useStore.getState().set({ drag: null })
        p.onDrop(side)
      }}
    >
      {zone && (
        <div className={`pointer-events-none absolute grid place-items-center rounded-lg border-2 border-dashed border-accent bg-accent/15 text-[13px] font-semibold text-accent ${box}`}>
          {labels[zone]}
        </div>
      )}
    </div>
  )
}

/** Handles between panes (or between groups inside one): drag to resize, double-click to even out. */
export function Dividers({ dividers, leafId, inner }: { dividers: L.Divider[]; leafId?: string; inner?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const sizesOf = (splitId: string): number[] | null => {
    const l = useStore.getState().layout
    if (!l) return null
    if (!inner) {
      const n = L.findNode(l.root, splitId)
      return n && L.isSplit(n) ? n.sizes : null
    }
    const leaf = leafId ? (L.findNode(l.root, leafId) as L.Leaf | null) : null
    if (leaf?.view.kind !== 'workspace') return null
    const n = L.findNode(leaf.view.inner, splitId)
    return n && L.isSplit(n) ? n.sizes : null
  }
  const set = (splitId: string, sizes: number[], save: boolean) => (inner ? setGroupSizes(leafId!, splitId, sizes, save) : setPaneSizes(splitId, sizes, save))
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {dividers.map((d) => {
        const row = d.dir === 'row'
        const style = row
          ? { left: `${d.at * 100}%`, top: `${d.parent.y * 100}%`, height: `${d.parent.h * 100}%` }
          : { top: `${d.at * 100}%`, left: `${d.parent.x * 100}%`, width: `${d.parent.w * 100}%` }
        return (
          <div
            key={`${d.splitId}:${d.index}`}
            style={style}
            title="Drag to resize · double-click to even out"
            className={`group pointer-events-auto absolute z-20 flex items-center justify-center ${row ? 'w-2 -translate-x-1/2 cursor-col-resize' : 'h-2 -translate-y-1/2 cursor-row-resize'}`}
            onDoubleClick={() => {
              const sizes = sizesOf(d.splitId)
              if (sizes) set(d.splitId, L.even(sizes.length), true)
            }}
            onPointerDown={(e) => {
              const start = sizesOf(d.splitId)
              const area = ref.current?.getBoundingClientRect()
              if (!start || !area) return
              e.currentTarget.setPointerCapture(e.pointerId)
              const x0 = e.clientX
              const y0 = e.clientY
              const span = row ? d.parent.w * area.width : d.parent.h * area.height
              const min = Math.min(0.45, (inner ? 220 : 340) / Math.max(1, span))
              let last = start
              const move = (ev: PointerEvent) => {
                const delta = ((row ? ev.clientX - x0 : ev.clientY - y0) / span) * 1
                last = L.dragDivider(start, d.index, delta, min)
                set(d.splitId, last, false)
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                set(d.splitId, last, true)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            <span className={`rounded-full bg-line transition-colors group-hover:bg-accent ${row ? 'h-9 w-[3px]' : 'h-[3px] w-9'} ${inner ? 'opacity-0 group-hover:opacity-100' : ''}`} />
          </div>
        )
      })}
    </div>
  )
}

/** A pane with nothing in it yet: pick a workspace or page to show. */
function EmptyPane({ leaf, framed, focused }: { leaf: L.Leaf; framed: boolean; focused: boolean }) {
  const s = useStore()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const items = useMemo(() => {
    const open = new Set(s.layout ? L.leaves(s.layout).flatMap((l) => (l.view.kind === 'workspace' ? [l.view.wsId] : [])) : [])
    const ws = s.workspaces
      .filter((w) => !w.archived && !open.has(w.id))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map((w) => ({ id: w.id, label: w.orchestrator ? 'Orchestrator' : w.title, sub: s.repos.find((r) => r.id === w.repoId)?.name ?? '', ws: w, page: null as null | L.PaneView }))
    const pages = [...addonViews(s.addons, 'app').map((x) => ({ ...x, repoId: undefined as string | undefined })), ...addonViews(s.addons, 'repo').flatMap((x) => s.repos.map((r) => ({ ...x, repoId: r.id as string | undefined })))].map((x) => ({
      id: `${x.addon.key}/${x.view.id}/${x.repoId ?? ''}`,
      label: x.view.title,
      sub: x.repoId ? `${s.repos.find((r) => r.id === x.repoId)?.name ?? ''} · ${x.addon.name}` : x.addon.name,
      ws: null,
      page: { kind: 'addon', key: x.addon.key, viewId: x.view.id, ...(x.repoId ? { repoId: x.repoId } : {}) } as L.PaneView
    }))
    const all = [...ws, ...pages]
    const t = q.trim().toLowerCase()
    return t ? all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(t)) : all
  }, [s.workspaces, s.repos, s.addons, s.layout, q])
  const pick = (i: (typeof items)[number] | undefined) => {
    if (!i) return
    focusLeaf(leaf.id)
    showView(i.ws ? viewFor(i.ws.id) : i.page!)
  }
  const repoForNew = s.workspaces.find((w) => !w.archived)?.repoId ?? s.repos[0]?.id
  return (
    <div className="flex h-full flex-col">
      {framed ? (
        <header className={`flex h-[42px] shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-1 ${focused ? 'bg-accent/[0.07]' : 'bg-panel'}`}>
          <PaneGrip leafId={leaf.id} />
          <span className="text-[15px] font-bold text-muted">Empty pane</span>
          <div className="flex-1" />
          <DotsMenu title="Pane actions" align="right" menu={(close) => <PaneMenuItems leafId={leaf.id} close={close} />} />
          <button className="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Close pane (⌘⌥W)" onClick={() => closePane(leaf.id)}>
            <IconX />
          </button>
        </header>
      ) : (
        <header className="drag flex h-11 shrink-0 items-center border-b border-line px-3 text-muted">Empty pane</header>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-[12vh]">
        <div className="text-[15px] font-semibold text-fg">Pick what to show here</div>
        <div className="mt-1 mb-4 text-center text-muted">A workspace or an add-on page. You can also drag one in from the sidebar.</div>
        <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-raised shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <IconSearch className="text-faint" />
            <input
              autoFocus={focused}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setSel(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setSel((x) => Math.min(items.length - 1, x + 1))
                if (e.key === 'ArrowUp') setSel((x) => Math.max(0, x - 1))
                if (e.key === 'Enter') pick(items[sel])
              }}
              placeholder="Open in this pane…"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[13.5px] outline-none"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {items.length === 0 && <div className="px-4 py-3 text-faint">Nothing else to open</div>}
            {items.map((i, n) => (
              <button
                key={i.id}
                onMouseEnter={() => setSel(n)}
                onClick={() => pick(i)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[12.5px] ${n === sel ? 'bg-hover' : ''}`}
              >
                {i.ws ? <StatusDot ws={i.ws} /> : <IconAddon width={13} height={13} className="shrink-0 text-violet-300" />}
                <span className="truncate text-fg">{i.label}</span>
                <span className="truncate text-faint">{i.sub}</span>
                {n === sel && <span className="ml-auto text-[11px] text-faint">↩</span>}
              </button>
            ))}
          </div>
        </div>
        {repoForNew && (
          <button className="mt-3 flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-fg" onClick={() => newWorkspace(repoForNew)}>
            <IconPlus width={12} height={12} /> New workspace
          </button>
        )}
      </div>
    </div>
  )
}

/** An add-on page in a pane. Its header says it's an add-on, so it never looks like a workspace. */
function AddonPane({ leaf, view, framed, focused }: { leaf: L.Leaf; view: Extract<L.PaneView, { kind: 'addon' }>; framed: boolean; focused: boolean }) {
  const s = useStore()
  const addon = s.addons.find((a) => a.key === view.key && a.state === 'on')
  const v = addon?.manifest?.views.find((x) => x.id === view.viewId)
  const repo = view.repoId ? s.repos.find((r) => r.id === view.repoId) : undefined
  const manage = () => s.set({ modal: 'settings', settingsTab: 'addons' })
  const chip = addon && (
    <button
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-violet-400/45 bg-violet-400/10 px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-violet-200 hover:bg-violet-400/20"
      title={`This page comes from the ${addon.name} add-on. Click to manage add-ons.`}
      onClick={manage}
    >
      <IconAddon width={12} height={12} />
      {addon.name}
    </button>
  )
  return (
    <div className="flex h-full min-w-0 flex-col bg-bg">
      {framed ? (
        <header className={`flex h-[42px] shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-1 ${focused ? 'bg-accent/[0.07]' : 'bg-panel'}`}>
          <PaneGrip leafId={leaf.id} />
          {repo && (
            <>
              <RepoChip name={repo.name} />
              <span className="shrink-0 text-[15px] text-faint">/</span>
            </>
          )}
          <span className="shrink-0 text-[15px] font-bold whitespace-nowrap text-fg">{v?.title ?? 'Add-on page'}</span>
          {chip}
          <div className="min-w-0 flex-1" />
          <DotsMenu title="Pane actions" align="right" menu={(close) => <PaneMenuItems leafId={leaf.id} close={close} />} />
          <button className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Close pane (⌘⌥W)" onClick={() => closePane(leaf.id)}>
            <IconX />
          </button>
        </header>
      ) : (
        <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          {!s.sidebarOpen && (
            <button title="Show sidebar" className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
              <IconSidebar width={16} height={16} />
            </button>
          )}
          {repo && (
            <>
              <span className="text-muted">{repo.name}</span>
              <span className="text-faint">›</span>
            </>
          )}
          <span className="truncate">{v?.title}</span>
          <div className="flex-1" />
          <span className="no-drag">{chip}</span>
          <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => splitPane('right')} title="Split right (⌘\)">
            <IconSplitRight width={16} height={16} />
          </button>
        </header>
      )}
      {addon && v ? (
        <div className="flex min-h-0 flex-1">
          <AddonFrame addon={addon} view={v} repoId={view.repoId} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
          <div>This add-on is off or was removed.</div>
          <div className="flex gap-2">
            <button className="rounded-md border border-line px-2.5 py-1 hover:bg-hover" onClick={manage}>
              Manage add-ons
            </button>
            <button className="rounded-md border border-line px-2.5 py-1 hover:bg-hover" onClick={() => closePane(leaf.id)}>
              Close pane
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
