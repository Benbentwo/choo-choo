import { useEffect, useRef, useState, type RefObject } from 'react'
import { findMatches } from '../findText'
import { IconDown, IconSearch, IconUp, IconX } from '../icons'

/** Past this many matches the count reads "5000+": nobody steps through more, and each one is a Range. */
const MAX = 5000

/** Panes with a find bar on screen, and the one last clicked: ⌘F opens that one's bar. */
const panes = new Set<HTMLElement>()
let lastPane: HTMLElement | null = null

/** Both highlights are shared by every pane; each bar adds and removes only its own ranges. */
function highlight(name: string): Highlight {
  let h = CSS.highlights.get(name)
  if (!h) CSS.highlights.set(name, (h = new Highlight()))
  return h
}

/** Ranges for every match of `q` in the pane's code cells (`data-find`). A match may span several text nodes. */
function rangesFor(box: HTMLElement, q: string): Range[] {
  const out: Range[] = []
  for (const cell of box.querySelectorAll('[data-find]')) {
    const text = cell.textContent ?? ''
    const starts = findMatches(text, q, MAX - out.length)
    if (!starts.length) continue
    const nodes: { node: Text; at: number }[] = []
    const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(), at = 0; n; n = walk.nextNode()) {
      nodes.push({ node: n as Text, at })
      at += (n as Text).data.length
    }
    let k = 0
    const place = (offset: number, end: boolean) => {
      // An end offset on a node boundary belongs to the node before it.
      while (k + 1 < nodes.length && (end ? nodes[k + 1].at < offset : nodes[k + 1].at <= offset)) k++
      return [nodes[k].node, offset - nodes[k].at] as const
    }
    for (const s of starts) {
      const r = document.createRange()
      r.setStart(...place(s, false))
      r.setEnd(...place(s + q.length, true))
      out.push(r)
    }
    if (out.length >= MAX) break
  }
  return out
}

/**
 * Find in a file or diff: ⌘F or the magnifier opens it, Enter and ⇧Enter step through matches, Esc
 * closes. Matches are painted with the CSS Custom Highlight API, so the code isn't re-rendered.
 * `watch` changes when the pane's content does.
 */
export function FindBar({ box, watch }: { box: RefObject<HTMLElement | null>; watch: unknown }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    panes.add(el)
    const mine = () => (lastPane = el)
    el.addEventListener('pointerdown', mine)
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return
      const target = lastPane && panes.has(lastPane) ? lastPane : [...panes][0]
      if (target !== el) return
      e.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => input.current?.select())
    }
    window.addEventListener('keydown', key)
    return () => {
      panes.delete(el)
      if (lastPane === el) lastPane = null
      el.removeEventListener('pointerdown', mine)
      window.removeEventListener('keydown', key)
    }
  }, [box, watch])

  useEffect(() => {
    const el = box.current
    const found = open && q && el ? rangesFor(el, q) : []
    setRanges(found)
    setAt(0)
    const all = highlight('find')
    for (const r of found) all.add(r)
    return () => {
      for (const r of found) all.delete(r)
    }
  }, [open, q, watch, box])

  useEffect(() => {
    const r = ranges[at]
    if (!r) return
    const current = highlight('find-current')
    current.add(r)
    r.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
    return () => void current.delete(r)
  }, [ranges, at])

  const step = (by: number) => ranges.length && setAt((at + by + ranges.length) % ranges.length)
  const close = () => {
    setOpen(false)
    setQ('')
  }
  const btn = 'rounded p-0.5 text-faint hover:bg-hover hover:text-fg disabled:opacity-40'
  if (!open)
    return (
      <button
        className={btn}
        title="Find in this file (⌘F)"
        onClick={() => {
          if (box.current) lastPane = box.current
          setOpen(true)
          requestAnimationFrame(() => input.current?.focus())
        }}
      >
        <IconSearch />
      </button>
    )
  return (
    <div className="flex items-center gap-1 font-sans">
      <input
        ref={input}
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
        placeholder="Find"
        spellCheck={false}
        className="w-48 rounded-md border border-line bg-bg px-2 py-0.5 text-[12px] text-fg outline-none focus:border-faint"
      />
      <span className="w-16 text-center text-[11px] text-faint tabular-nums">{!q ? '' : !ranges.length ? 'No results' : `${at + 1} of ${ranges.length >= MAX ? `${MAX}+` : ranges.length}`}</span>
      <button className={btn} disabled={!ranges.length} title="Previous (⇧Enter)" onClick={() => step(-1)}>
        <IconUp />
      </button>
      <button className={btn} disabled={!ranges.length} title="Next (Enter)" onClick={() => step(1)}>
        <IconDown />
      </button>
      <button className={btn} title="Close (Esc)" onClick={close}>
        <IconX />
      </button>
    </div>
  )
}
