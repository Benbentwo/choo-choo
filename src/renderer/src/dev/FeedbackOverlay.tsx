// Dev-only comment mode: press ⌘⇧K (or the pill in the corner), click any element, type a note.
// The note plus screenshots land in .feedback/ for the agent iterating on the app.
import { useEffect, useRef, useState } from 'react'

type Bridge = { submit(p: unknown): Promise<string> }
const bridge = (window as unknown as { devFeedback?: Bridge }).devFeedback

const UI_ATTR = 'data-feedback-ui'

function componentChain(el: Element): string | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  let fiber = key ? (el as unknown as Record<string, any>)[key] : null
  const names: string[] = []
  while (fiber && names.length < 4) {
    const t = fiber.type
    const name = typeof t === 'function' ? t.displayName || t.name : null
    if (name && names[names.length - 1] !== name) names.push(name)
    fiber = fiber.return
  }
  return names.length ? names.join(' < ') : null
}

function selectorFor(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.body && parts.length < 6) {
    let part = cur.tagName.toLowerCase()
    if (cur.id) {
      parts.unshift(`${part}#${cur.id}`)
      break
    }
    const cls = [...cur.classList].filter((c) => !c.includes(':')).slice(0, 3)
    if (cls.length) part += '.' + cls.join('.')
    const parent: Element | null = cur.parentElement
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur!.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
    }
    parts.unshift(part)
    cur = parent
  }
  return parts.join(' > ')
}

const isOurs = (el: Element | null) => !!el?.closest(`[${UI_ATTR}]`)

export function FeedbackOverlay() {
  const [active, setActive] = useState(false)
  const [hover, setHover] = useState<DOMRect | null>(null)
  const [target, setTarget] = useState<{ el: Element; rect: DOMRect } | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setActive((a) => !a)
        setTarget(null)
        setHover(null)
      } else if (e.key === 'Escape' && active && !target) setActive(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, target])

  useEffect(() => {
    if (!active || target) return
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      setHover(el && !isOurs(el) ? el.getBoundingClientRect() : null)
    }
    const block = (e: MouseEvent) => {
      if (isOurs(e.target as Element)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const click = (e: MouseEvent) => {
      if (isOurs(e.target as Element)) return
      block(e)
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el) return
      setTarget({ el, rect: el.getBoundingClientRect() })
      setComment('')
      setTimeout(() => textRef.current?.focus(), 0)
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mousedown', block, true)
    window.addEventListener('mouseup', block, true)
    window.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mousedown', block, true)
      window.removeEventListener('mouseup', block, true)
      window.removeEventListener('click', click, true)
    }
  }, [active, target])

  if (!bridge) return null

  async function submit() {
    if (!target || !comment.trim() || !bridge) return
    setBusy(true)
    // Let the popover disappear before the screenshot is taken.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const r = target.rect
    try {
      await bridge.submit({
        comment: comment.trim(),
        selector: selectorFor(target.el),
        component: componentChain(target.el),
        text: (target.el as HTMLElement).innerText?.slice(0, 300) ?? '',
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }
      })
      setToast('Sent to Claude')
    } catch (err) {
      setToast(`Failed: ${String(err)}`)
    }
    setBusy(false)
    setTarget(null)
    setTimeout(() => setToast(null), 2000)
  }

  const box = target?.rect ?? hover
  const popTop = target ? Math.min(target.rect.bottom + 8, window.innerHeight - 170) : 0
  const popLeft = target ? Math.min(Math.max(8, target.rect.left), window.innerWidth - 336) : 0

  return (
    <div {...{ [UI_ATTR]: '' }}>
      {active && box && (
        <div
          style={{
            position: 'fixed',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            outline: '2px solid #f59e0b',
            background: 'rgba(245,158,11,0.12)',
            pointerEvents: 'none',
            zIndex: 2147483646,
            borderRadius: 2
          }}
        />
      )}
      {target && !busy && (
        <div
          style={{
            position: 'fixed',
            top: popTop,
            left: popLeft,
            width: 320,
            zIndex: 2147483647,
            background: '#262321',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            padding: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            font: '13px system-ui',
            color: '#eee'
          }}
        >
          <textarea
            ref={textRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
                e.preventDefault()
                void submit()
              } else if (e.key === 'Escape') setTarget(null)
            }}
            placeholder="What should change here? (Enter to send, Shift+Enter for a new line, Esc to cancel)"
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1a1817',
              color: '#eee',
              border: '1px solid #444',
              borderRadius: 6,
              padding: 6,
              resize: 'vertical',
              font: 'inherit'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button onClick={() => setTarget(null)} style={btn(false)}>
              Cancel
            </button>
            <button onClick={() => void submit()} disabled={!comment.trim()} style={btn(true)}>
              Send
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => {
          setActive((a) => !a)
          setTarget(null)
          setHover(null)
        }}
        title="Comment mode (⌘⇧K)"
        style={{
          position: 'fixed',
          right: 12,
          bottom: 12,
          zIndex: 2147483647,
          ...btn(active),
          borderRadius: 999,
          padding: '6px 12px',
          opacity: active ? 1 : 0.7
        }}
      >
        {toast ?? (active ? 'Click something to comment · Esc to exit' : '💬 Comment ⌘⇧K')}
      </button>
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? '#f59e0b' : '#3a3633',
    color: primary ? '#1a1817' : '#eee',
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    font: '600 12px system-ui',
    cursor: 'pointer'
  }
}
