import type { Chat, Workspace } from './types'

/**
 * Restarts that don't lose work. "Restart to update" waits until no chat is running; "Restart now"
 * (or any quit or crash mid-turn) marks the running chats, and on the next launch each one gets a
 * message that continues the same Claude Code session. See docs/prd/update-checks.md and decision 0021.
 */

/** Why a turn was cut off. */
export type InterruptReason = 'update' | 'quit' | 'crash'

export interface ChatInterrupt {
  reason: InterruptReason
  at: number
}

/** Sent into the chat's own session after the restart, so Claude picks the turn back up. */
export const RESUME_PROMPT =
  'Choo Choo restarted while you were working on this, so your last turn was cut off partway. Continue where you left off. Commands that were running were stopped, so check the state of any files, servers or commands you were in the middle of before going on.'

/** The chats to pick back up on launch: marked as interrupted, still local, and their workspace is still there. */
export function chatsToResume(chats: Chat[], workspaces: Workspace[], exists: (path: string) => boolean): Chat[] {
  return chats.filter((c) => {
    if (!c.interrupted || c.remote) return false
    const ws = workspaces.find((w) => w.id === c.workspaceId)
    return !!ws && !ws.archived && exists(ws.path)
  })
}

/** What happened, for the note left in a chat that isn't resumed automatically. */
export function interruptNote(reason: InterruptReason): string {
  const what = reason === 'update' ? 'restarted to update' : reason === 'quit' ? 'quit' : 'closed unexpectedly'
  return `Choo Choo ${what} while this turn was running. Send a message to continue.`
}

/** The label under "Restart to update" while it waits. */
export function waitingLine(running: number): string {
  if (running <= 0) return 'Restarting…'
  return `Restarts when ${running === 1 ? 'the running chat finishes' : `${running} running chats finish`}.`
}

/** The hint before you click, when chats are running. */
export function busyLine(running: number): string {
  return `${running === 1 ? '1 chat is' : `${running} chats are`} running. Restarting waits for ${running === 1 ? 'it' : 'them'}, or restart now and ${running === 1 ? 'it picks' : 'they pick'} up after.`
}
