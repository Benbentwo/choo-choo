import { useState } from 'react'
import { createPortal } from 'react-dom'
import { dragTo } from '@shared/panelWidths'

/**
 * The drag handle on a side panel's inner edge. While dragging it sizes the panel element directly
 * (no store updates per move), shows the width, and on release calls onCommit with the new width
 * or onClose when it was dragged well past the minimum. Double-click resets.
 */
export function PanelEdge({
  side,
  min,
  max,
  onCommit,
  onClose,
  onReset,
  hint,
}: {
  /** Which edge of the panel the handle sits on. */
  side: 'left' | 'right'
  min: number
  /** Read when a drag starts, so it follows the window size. */
  max: number | (() => number)
  onCommit: (width: number) => void
  onClose: () => void
  onReset: () => void
  hint: string
}) {
  const [live, setLive] = useState<{ width: number; closing: boolean; x: number; y: number } | null>(null)
  return (
    <div
      data-testid={`panel-edge-${side === 'right' ? 'sidebar' : 'right'}`}
      title={live ? undefined : `Drag to resize · double-click to reset · ${hint}`}
      className={`no-drag group absolute top-0 bottom-0 z-30 flex w-2 cursor-col-resize justify-center ${side === 'right' ? '-right-1' : '-left-1'}`}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const panel = e.currentTarget.parentElement
        if (!panel) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const x0 = e.clientX
        const hi = typeof max === 'function' ? max() : max
        const w0 = panel.getBoundingClientRect().width
        const prev = { width: panel.style.width, opacity: panel.style.opacity }
        let result: number | 'close' = w0
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        const move = (ev: PointerEvent) => {
          const raw = side === 'right' ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0)
          result = dragTo(raw, min)
          const width = Math.round(Math.min(hi, Math.max(min, raw)))
          panel.style.width = `${width}px`
          panel.style.opacity = result === 'close' ? '0.45' : ''
          setLive({ width, closing: result === 'close', x: side === 'right' ? panel.getBoundingClientRect().right + 10 : panel.getBoundingClientRect().left - 10, y: ev.clientY })
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          panel.style.width = prev.width
          panel.style.opacity = prev.opacity
          setLive(null)
          if (result === 'close') onClose()
          else if (Math.round(result) !== Math.round(w0)) onCommit(Math.round(Math.min(hi, Math.max(min, result))))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      <span className={`w-[2px] transition-colors ${live ? (live.closing ? 'bg-faint' : 'bg-accent') : 'bg-transparent group-hover:bg-accent/70'}`} />
      {live &&
        createPortal(
          <span
            style={{ top: live.y - 10, left: live.x }}
            className={`pointer-events-none fixed z-[100] rounded-[5px] bg-fg px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-bg ${side === 'left' ? '-translate-x-full' : ''}`}
          >
            {live.closing ? 'Release to hide' : `${live.width} px`}
          </span>,
          document.body,
        )}
    </div>
  )
}
