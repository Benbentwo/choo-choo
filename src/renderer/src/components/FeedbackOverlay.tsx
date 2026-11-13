// Comment mode: press ⌘⇧K (Help > Comment on Choo Choo, or the 💬 bubble at the bottom right), click any element, type a note.
// In dev the note lands in .feedback/ for the agent iterating on the checkout; in a packaged build it opens a
// workspace on choo-choo itself, or a GitHub issue (see src/main/uiComment.ts).
import { useEffect, useRef, useState } from 'react'
import { TARGET_LABELS, buildLabel, showCommentBubble, type CommentInfo, type CommentResult, type CommentSubmit, type CommentTarget } from '@shared/uiComment'
import { refreshState, useStore } from '../store'

type Bridge = {
  info(): Promise<CommentInfo>
  submit(p: CommentSubmit): Promise<CommentResult>
}
const bridge = (window as unknown as { uiComment?: Bridge }).uiComment

const HINTS: Record<CommentTarget, string> = {
  local: 'Writes to .feedback/ in this checkout for the Claude Code session watching it.',
  workspace: 'Opens a new workspace on choo-choo and starts Claude on the fix. Clones the repo the first time, or your fork if you can’t push to it.',
  issue: 'Opens a prefilled GitHub issue in your browser. The element screenshot is copied so you can paste it in.'
}
const SEND_LABEL: Record<CommentTarget, string> = {
  local: 'Send',
  workspace: 'Fix it',
  issue: 'Open issue'
}

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
  const [info, setInfo] = useState<CommentInfo | null>(null)
  const [sendTo, setSendTo] = useState<CommentTarget>('local')
  const [includeFull, setIncludeFull] = useState(true)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const bubbleSetting = useStore((s) => s.settings.commentBubble)

  useEffect(() => {
    void bridge?.info().then((i) => {
      setInfo(i)
      setSendTo(i.defaultTarget)
      // The whole window can show private repos and code, so packaged builds leave it out unless asked.
      setIncludeFull(!i.packaged)
    })
    // ⌘⇧K is the Help menu's accelerator; the menu forwards it here.
    const toggle = () => {
      setActive((a) => !a)
      setTarget(null)
      setHover(null)
    }
    window.addEventListener('choo:comment-mode', toggle)
    return () => window.removeEventListener('choo:comment-mode', toggle)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active) {
        // Comment mode is the top layer: Esc backs out of it and nothing underneath (dialogs, menus) sees the key.
        e.preventDefault()
        e.stopImmediatePropagation()
        if (target) setTarget(null)
        else setActive(false)
      }
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

  if (!bridge || !info) return null

  async function submit() {
    if (!target || !comment.trim() || !bridge) return
    setBusy(true)
    // Let the popover disappear before the screenshot is taken.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const r = target.rect
    if (sendTo === 'workspace') setToast('Opening a choo-choo workspace…')
    let hold = 2000
    try {
      const res = await bridge.submit({
        comment: comment.trim(),
        selector: selectorFor(target.el),
        component: componentChain(target.el),
        text: (target.el as HTMLElement).innerText?.slice(0, 300) ?? '',
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        target: sendTo,
        includeFull
      })
      if (res.target === 'workspace') {
        await refreshState()
        const st = useStore.getState()
        st.selectWorkspace(res.workspaceId)
        st.setActiveChat(res.workspaceId, res.chatId)
        setToast(`✓ Opened workspace ${res.branch}`)
        setActive(false)
        hold = 4000
      } else if (res.target === 'issue') {
        setToast('✓ Issue opened in your browser. Paste the screenshot (⌘V).')
        setActive(false)
        hold = 5000
      } else setToast('Sent to Claude')
    } catch (err) {
      setToast(`Failed: ${String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')}`)
      hold = 6000
    }
    setBusy(false)
    setTarget(null)
    setTimeout(() => setToast(null), hold)
  }

  const box = target?.rect ?? hover
  const popTop = target ? Math.min(target.rect.bottom + 8, window.innerHeight - 270) : 0
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              fontSize: 12,
              color: '#aaa'
            }}
          >
            <span>Send to</span>
            <select value={sendTo} onChange={(e) => setSendTo(e.target.value as CommentTarget)} style={field}>
              {info.targets.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#999',
              marginTop: 4,
              lineHeight: 1.35
            }}
          >
            {HINTS[sendTo]}
          </div>
          {sendTo !== 'local' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 6,
                fontSize: 11,
                color: '#bbb',
                flexWrap: 'wrap'
              }}
            >
              <span style={chip}>element screenshot</span>
              {sendTo === 'workspace' && (
                <label style={{ ...chip, cursor: 'pointer' }} title="The whole window can show other repos and code">
                  <input
                    type="checkbox"
                    checked={includeFull}
                    onChange={(e) => setIncludeFull(e.target.checked)}
                    style={{ margin: '0 4px 0 0', verticalAlign: -1 }}
                  />
                  whole window
                </label>
              )}
              <span style={chip}>{buildLabel(info)}</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 8
            }}
          >
            <button onClick={() => setTarget(null)} style={btn(false)}>
              Cancel
            </button>
            <button onClick={() => void submit()} disabled={!comment.trim()} style={btn(true)}>
              {SEND_LABEL[sendTo]}
            </button>
          </div>
        </div>
      )}
      {showCommentBubble({ setting: bubbleSetting, active, toast: !!toast }) && (
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
      )}
    </div>
  )
}

const field: React.CSSProperties = {
  background: '#1a1817',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 5,
  padding: '2px 4px',
  font: '12px system-ui'
}
const chip: React.CSSProperties = {
  background: '#3a3633',
  borderRadius: 4,
  padding: '2px 6px'
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
