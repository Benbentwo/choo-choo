import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Shows any element's `title` as a tooltip right away on hover, instead of the native one Electron
 * shows after a long delay. Mount once at the app root; give icon-only buttons a `title`.
 * While hovered, the title moves to data-tip so the native tooltip doesn't also appear.
 */
export function TitleTips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let cur: HTMLElement | null = null
    const restore = () => {
      if (cur?.dataset.tip != null) {
        cur.setAttribute('title', cur.dataset.tip)
        delete cur.dataset.tip
      }
      cur = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null
      if (!el || el === cur) return
      restore()
      const text = el.getAttribute('title')
      if (!text) return
      el.dataset.tip = text
      el.removeAttribute('title')
      cur = el
      setTip({ text, rect: el.getBoundingClientRect() })
    }
    const out = (e: MouseEvent) => {
      if (cur && !cur.contains(e.relatedTarget as Node | null)) restore()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', restore, true)
    window.addEventListener('blur', restore)
    return () => {
      restore()
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('mousedown', restore, true)
      window.removeEventListener('blur', restore)
    }
  }, [])

  // Below the element, flipped above near the bottom edge, and kept inside the window.
  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null)
    const w = box.current.offsetWidth
    const h = box.current.offsetHeight
    const r = tip.rect
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? r.top - h - 6 : r.bottom + 6
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-72 rounded-md border border-line bg-raised px-2 py-1 text-[11px] whitespace-pre-line text-fg shadow-lg"
      style={pos ?? { left: -9999, top: 0 }}
    >
      {tip.text}
    </div>
  )
}
