/** How long the Stop button says "Stopping…" before it offers to force stop. */
export const FORCE_STOP_AFTER_MS = 4000

/** The marker at the end of a stopped turn, e.g. "Stopped by you · 1 queued message is back in the message box". */
export function stoppedText(o: { by?: string; forced?: boolean; unsent?: number }): string {
  const parts = [`Stopped by ${o.by ?? 'you'}`]
  if (o.forced) parts.push("Claude didn't respond, so it was force stopped")
  if (o.unsent) parts.push(`${o.unsent === 1 ? '1 queued message is' : `${o.unsent} queued messages are`} back in the message box`)
  return parts.join(' · ')
}
