import { useState } from 'react'
import type { Chat, Workspace } from '@shared/types'
import { useStore, reportError } from '../store'
import { TerminalView } from './TerminalView'

const terminalId = (chat: Chat) => `${chat.workspaceId}:cloud-${chat.id}`

/** Shown in place of the composer while a chat runs in a Claude Code cloud session. */
export function CloudPanel({ chat, ws }: { chat: Chat; ws: Workspace }) {
  const remote = chat.remote!
  const url = remote.url
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'send' | 'back' | 'forget' | null>(null)
  const [showTerm, setShowTerm] = useState(false)
  const act = async (kind: 'send' | 'back' | 'forget', fn: () => Promise<unknown>) => {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const send = () =>
    act('send', async () => {
      await window.api.sendToCloud(chat.id, text)
      setText('')
    })
  const terminal = !url || remote.teleporting || showTerm
  return (
    <div className="mx-auto w-full max-w-3xl px-8 pb-5">
      <div className="rounded-xl border border-line bg-panel p-4">
        <div className="flex items-start gap-4">
          {remote.qr ? (
            <img src={remote.qr} alt="QR code for the cloud session" className="h-24 w-24 shrink-0 rounded bg-white p-1" />
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded border border-dashed border-line text-[11px] text-faint">Starting…</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[14px] font-medium">{remote.teleporting ? 'Bringing it back from the cloud' : url ? 'Running in the cloud' : 'Starting a cloud session'}</div>
            <div className="mb-3 text-[12px] text-muted">
              {remote.teleporting
                ? 'Claude Code is checking out the cloud branch and copying the conversation here. If it asks something, answer in the terminal below.'
                : url
                  ? 'It keeps going with your Mac closed. Watch and reply on claude.ai/code or in the Claude app, or send a follow-up from here. Bring it back to continue locally on its branch.'
                  : `Pushed ${ws.branch}. Claude Code is creating the cloud session.`}
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
            {url && !remote.teleporting && (
              <div className="flex flex-wrap gap-2">
                <button className="rounded-md bg-fg px-3 py-1 text-[12px] text-bg disabled:opacity-50" disabled={!!busy} onClick={() => void act('back', () => window.api.bringBackFromCloud(chat.id))}>
                  {busy === 'back' ? 'Starting…' : 'Bring back'}
                </button>
                <button className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-hover" onClick={() => setShowTerm(!showTerm)}>
                  {showTerm ? 'Hide terminal' : 'Show terminal'}
                </button>
                <button
                  className="rounded-md px-3 py-1 text-[12px] text-muted hover:bg-hover"
                  disabled={!!busy}
                  title="Keep the cloud session running on claude.ai and go back to working here"
                  onClick={() => void act('forget', () => window.api.forgetCloud(chat.id))}
                >
                  Stop following
                </button>
              </div>
            )}
          </div>
        </div>
        {url && !remote.teleporting && (
          <div className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-faint"
              placeholder="Send a follow-up to the cloud session…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim() && !busy) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button className="rounded-md border border-line px-3 py-1 text-[12px] hover:bg-hover disabled:opacity-50" disabled={!text.trim() || !!busy} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
          </div>
        )}
        {terminal && (
          <div className="mt-3 h-56 overflow-hidden rounded border border-line bg-bg p-1">
            <TerminalView key={`${remote.teleporting ? 't' : 'c'}`} id={terminalId(chat)} workspaceId={ws.id} attach />
          </div>
        )}
      </div>
    </div>
  )
}

/** Asks what the cloud session should do, then starts it. */
export function RunInCloudDialog({ chat, ws, onClose }: { chat: Chat; ws: Workspace; onClose: () => void }) {
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async () => {
    setBusy(true)
    try {
      useStore.getState().upsertChat(await window.api.runInCloud(chat.id, task))
      onClose()
    } catch (e) {
      reportError(e)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[480px] rounded-xl border border-line bg-raised p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[15px] font-medium">Run in the cloud</div>
        <div className="mb-3 text-[12px] text-muted">
          Choo Choo commits any uncommitted changes, pushes {ws.branch}, and starts a Claude Code cloud session on it with this chat's conversation so far. It keeps running with your Mac closed. Needs Claude Code
          signed in with your Claude account and the Claude GitHub app on the repo.
        </div>
        <textarea
          autoFocus
          className="h-28 w-full resize-none rounded-md border border-line bg-bg p-2 text-[13px] outline-none focus:border-faint"
          placeholder="What should it do? Leave empty to continue where this chat left off."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) void start()
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded-md px-3 py-1.5 text-[12px] text-muted hover:bg-hover" onClick={onClose}>
            Cancel
          </button>
          <button className="rounded-md bg-fg px-3 py-1.5 text-[12px] text-bg disabled:opacity-50" disabled={busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Run in cloud'}
          </button>
        </div>
      </div>
    </div>
  )
}
