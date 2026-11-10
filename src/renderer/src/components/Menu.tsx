import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconRight } from '../icons'

export type MenuItem =
  | { kind: 'sep' }
  | { kind: 'label'; label: string }
  | { kind?: 'item'; label: string; icon?: React.ReactNode; checked?: boolean; hint?: string; onClick?: () => void; submenu?: MenuItem[]; keepOpen?: boolean }

/**
 * Popover menu with hover submenus, rendered in a portal so scroll containers don't clip it.
 * `anchor` is the element it drops down from; the menu's right edge lines up with the anchor's.
 * `at` opens it at a point instead, for right-click menus.
 */
export function Menu({
  items,
  onClose,
  anchor,
  at,
  align = 'right'
}: {
  items: MenuItem[]
  onClose: () => void
  anchor: HTMLElement | null
  at?: { x: number; y: number }
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const r = anchor?.getBoundingClientRect()
  const pos = at ? { top: Math.max(8, Math.min(at.y, window.innerHeight - 8 - 34 * items.length)), left: Math.min(at.x, window.innerWidth - 228) } : r ? { top: r.bottom + 4, left: align === 'left' ? r.left : Math.max(8, r.right - 220) } : null
  if (!pos) return null
  return createPortal(
    <div ref={ref} className="fixed z-50 text-[13px]" style={pos}>
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body
  )
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="min-w-[200px] rounded-lg border border-line bg-raised p-1 text-fg shadow-2xl">
      {items.map((it, i) => {
        if (it.kind === 'sep') return <div key={i} className="my-1 border-t border-line" />
        if (it.kind === 'label') return <div key={i} className="px-2 pt-2 pb-1 text-[11px] text-faint">{it.label}</div>
        return (
          <div key={i} className="relative" onMouseEnter={() => setOpen(it.submenu ? i : null)}>
            <button
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${open === i ? 'bg-hover' : ''}`}
              onClick={() => {
                if (it.submenu) return setOpen(open === i ? null : i)
                it.onClick?.()
                if (!it.keepOpen) onClose()
              }}
            >
              {it.checked !== undefined && <span className="w-3 text-[11px]">{it.checked ? '✓' : ''}</span>}
              {it.icon && <span className="text-muted">{it.icon}</span>}
              <span className="flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
              {it.submenu && <IconRight className="text-faint" />}
            </button>
            {it.submenu && open === i && (
              <div className="absolute top-0 left-full z-50 pl-1">
                <MenuList items={it.submenu} onClose={onClose} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
