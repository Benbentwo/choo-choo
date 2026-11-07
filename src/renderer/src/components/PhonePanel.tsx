import { useState } from 'react'
import type { Chat, Workspace } from '@shared/types'
import { useStore, reportError } from '../store'
import { TerminalView } from './TerminalView'

/** Shown in place of the composer while a chat continues on your phone through Remote Control. */
export function PhonePanel({ chat, ws }: { chat: Chat; ws: Workspace }) {
  const url = chat.remote?.url
  // Until the link shows up, Claude Code may be asking something (sign-in, trust, first-run confirmation).
  const [showTerm, setShowTerm] = useState(false)
  const [busy, setBusy] = useState(false)
  const back = async () => {
    setBusy(true)
    try {
      useStore.getState().upsertChat(await window.api.bringBackFromPhone(chat.id))
      const items = await window.api.getChatItems(chat.id)
      useStore.getState().setItems(chat.id, items)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-8 pb-5">
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start gap-4">
          {chat.remote?.qr ? (
            <img src={chat.remote.qr} alt="QR code for the session link" className="h-28 w-28 shrink-0 rounded bg-white p-1" />
          ) : (
            <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded border border-dashed border-line text-[11px] text-faint">
              {url ? '' : 'Starting…'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[14px] font-medium">Continuing on your phone</div>
            <div className="mb-3 text-[12px] text-muted">
              {url && chat.remote?.listOnly
                ? `Remote Control is on. Open claude.ai/code or the Code tab in the Claude app and pick "${chat.title}". Your Mac runs the agent, so keep Choo Choo open. Bring it back to keep going here.`
                : url
                ? 'Scan the code with your phone, or open the link in the Claude app or claude.ai/code. Your Mac runs the agent, so keep Choo Choo open. Bring it back to keep going here.'
                : 'Starting Remote Control in this workspace. If it asks a question, answer it in the terminal below.'}
            </div>
            {url && (
              <div className="mb-3 flex items-center gap-2">
                <button className="selectable truncate font-mono text-[11px] text-sky-400 hover:underline" onClick={() => void window.api.openExternal(url)}>
                  {url}
                </button>
                <button className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover" onClick={() => void navigator.clipboard.writeText(url)}>
                  Copy
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button className="rounded-md bg-fg px-3 py-1 text-[12px] text-bg disabled:opacity-50" disabled={busy} onClick={() => void back()}>
                {busy ? 'Bringing back…' : 'Bring back'}
              </button>
              <button className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-hover" onClick={() => setShowTerm(!showTerm)}>
                {showTerm || !url ? 'Hide terminal' : 'Show terminal'}
              </button>
            </div>
          </div>
        </div>
        {(showTerm || !url) && (
          <div className="mt-3 h-56 overflow-hidden rounded border border-line bg-bg p-1">
            <TerminalView id={`${ws.id}:phone-${chat.id}`} workspaceId={ws.id} attach />
          </div>
        )}
      </div>
    </div>
  )
}
