import { useState } from 'react'
import type { Chat } from '@shared/types'
import { useStore, reportError } from '../store'
import { IconDesktop } from '../icons'

/** Shown in place of the composer while a chat continues in the Claude desktop app. */
export function DesktopPanel({ chat }: { chat: Chat }) {
  const [busy, setBusy] = useState<'back' | 'open' | null>(null)
  const back = async () => {
    setBusy('back')
    try {
      useStore.getState().upsertChat(await window.api.bringBackFromDesktop(chat.id))
      useStore.getState().setItems(chat.id, await window.api.getChatItems(chat.id))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const reopen = async () => {
    setBusy('open')
    try {
      useStore.getState().upsertChat(await window.api.openInDesktop(chat.id))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-8 pb-5">
      <div className="flex items-start gap-4 rounded-xl border border-line bg-panel p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-muted">
          <IconDesktop width={20} height={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[14px] font-medium">Continuing in Claude desktop</div>
          <div className="mb-3 text-[12px] text-muted">
            This chat's session is open in the Claude app, in the same worktree. Choo Choo won't run its own agent on it meanwhile. Bring it back to keep going here, with the turns from the app copied in.
          </div>
          <div className="flex gap-2">
            <button className="rounded-md bg-fg px-3 py-1 text-[12px] text-bg disabled:opacity-50" disabled={!!busy} onClick={() => void back()}>
              {busy === 'back' ? 'Bringing back…' : 'Bring back'}
            </button>
            <button className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-hover disabled:opacity-50" disabled={!!busy} onClick={() => void reopen()}>
              {busy === 'open' ? 'Opening…' : 'Open Claude desktop again'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
