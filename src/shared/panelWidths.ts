/**
 * Widths of the sidebar and the right panel. Both are dragged by their inner edge and saved in
 * Settings (sidebarWidth, rightWidth). The chat area always keeps CHAT_MIN pixels.
 */

export const SIDEBAR = { min: 200, max: 480, def: 280 }
export const RIGHT = { min: 320, def: 420 }
/** What the right panel always leaves for the chat panes beside it. */
export const CHAT_MIN = 420
/** Dragging this far past a panel's minimum closes it, the same as ⌘B or ⌘⌥B. */
export const SNAP = 80

const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)))

/** The sidebar width to use, from a saved or dragged value. */
export function sidebarWidth(w: number | undefined): number {
  return w == null || !Number.isFinite(w) ? SIDEBAR.def : clamp(w, SIDEBAR.min, SIDEBAR.max)
}

/** The widest the right panel may be in a window this wide, with the sidebar this wide (0 when hidden). */
export function rightMax(windowWidth: number, sidebar: number): number {
  return Math.max(RIGHT.min, windowWidth - sidebar - CHAT_MIN)
}

/** The right panel width to use, from a saved or dragged value. */
export function rightWidth(w: number | undefined, windowWidth: number, sidebar: number): number {
  const max = rightMax(windowWidth, sidebar)
  return w == null || !Number.isFinite(w) ? Math.min(RIGHT.def, max) : clamp(w, RIGHT.min, max)
}

/** Where a drag lands: a new width, or closed when it went well past the minimum. */
export function dragTo(raw: number, min: number): number | 'close' {
  return raw < min - SNAP ? 'close' : raw
}
