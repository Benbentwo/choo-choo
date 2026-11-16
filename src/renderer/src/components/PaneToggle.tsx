import type { ReactNode } from 'react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store'
import { IconX } from '../icons'

/**
 * The title bar's pane toggles all look alike: a named, outlined text button, filled while its
 * pane is open (Threads, Analytics, Details). Each pane it opens has an x in its header that closes it.
 */
export function PaneToggle({ open, onToggle, title, children, testId }: { open: boolean; onToggle: () => void; title: string; children: ReactNode; testId?: string }) {
  return (
    <button
      data-testid={testId}
      aria-pressed={open}
      className={`no-drag flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[12px] ${open ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
      onClick={onToggle}
      title={title}
    >
      {children}
    </button>
  )
}

/** The x in a side pane's header. */
export function PaneClose({ onClose, title, testId }: { onClose: () => void; title: string; testId?: string }) {
  return (
    <button data-testid={testId} className="no-drag shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={onClose} title={title}>
      <IconX width={12} height={12} />
    </button>
  )
}

/** What the right panel is called: an orchestrator's holds only its usage graphs, a workspace's holds its changes, checks and review. */
export const rightPaneName = (ws: Workspace | null | undefined): string => (ws?.orchestrator ? 'Analytics' : 'Details')

export function closeRightPane(): void {
  useStore.getState().set({ rightOpen: false, rightExpanded: false })
}

/** Shows or hides the right panel (⌘⌥B). */
export function RightPaneToggle({ ws }: { ws: Workspace | null | undefined }) {
  const open = useStore((s) => s.rightOpen)
  const name = rightPaneName(ws)
  return (
    <PaneToggle
      testId="toggle-right"
      open={open}
      onToggle={() => (open ? closeRightPane() : useStore.getState().set({ rightOpen: true }))}
      title={`${open ? 'Hide' : 'Show'} ${name.toLowerCase()} (⌘⌥B)`}
    >
      {name}
    </PaneToggle>
  )
}
