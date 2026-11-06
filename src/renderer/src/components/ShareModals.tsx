import { useEffect, useState } from 'react'
import type { Chat, ShareInfo, ShareStatus, Workspace } from '@shared/types'
import { useStore, refreshState, reportError, refreshStats } from '../store'

function Frame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-[560px] max-w-[92vw] rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-5 py-3 font-medium">{title}</div>
        <div className="space-y-3 px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

const btn = 'rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-50'
const primary = 'rounded-md bg-fg px-3 py-1.5 font-medium text-bg hover:opacity-90 disabled:opacity-50'

export function ShareModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [st, setSt] = useState<ShareStatus | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.shareStatus(ws.id).then(setSt, () => setSt(null))
  }, [ws.id])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const create = () => run(async () => setSt(await window.api.shareWorkspace(ws.id)))
  const stop = () => run(async () => {
    await window.api.unshareWorkspace(ws.id)
    setSt(null)
  })
  const copy = () => {
    if (!st) return
    void navigator.clipboard.writeText(st.link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Frame title="Share with coworkers" onClose={onClose}>
      <p className="text-muted">
        Anyone with access to this repository can open the share in Choo Choo and pick up where you are: same branch, your uncommitted changes, and every chat in this
        workspace. They continue with their own Claude login. Nothing about yours is shared.
      </p>
      {st === undefined && <div className="text-faint">Loading…</div>}
      {st === null && (
        <>
          <ul className="list-disc space-y-1 pl-5 text-[12px] text-faint">
            <li>The share is pushed to a hidden ref in the repository's origin remote, so it's visible to whoever can read the repository.</li>
            <li>Uncommitted and untracked files are included, except gitignored ones.</li>
            <li>Things that look like API keys and tokens are blanked out of the chats, but check nothing sensitive is in them.</li>
          </ul>
          <div className="flex justify-end">
            <button disabled={busy} className={primary} onClick={() => void create()}>
              {busy ? 'Sharing…' : 'Create share link'}
            </button>
          </div>
        </>
      )}
      {st && (
        <>
          {st.visibility === 'public' && (
            <div className="rounded-md border border-del/40 px-3 py-2 text-[12px] text-del">This repository is public, so anyone can open this share.</div>
          )}
          <div className="flex gap-2">
            <input readOnly value={st.link} className="selectable min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none" onFocus={(e) => e.target.select()} />
            <button className={btn} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={st.autoSync}
              onChange={(e) => {
                const on = e.target.checked
                setSt({ ...st, autoSync: on })
                void window.api.setShareAutoSync(ws.id, on)
              }}
            />
            Update the share after every agent turn
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-faint">Last updated {new Date(st.sharedAt).toLocaleString()}</span>
            <div className="flex gap-2">
              <button disabled={busy} className={btn} onClick={() => void stop()}>
                Stop sharing
              </button>
              <button disabled={busy} className={primary} onClick={() => void create()}>
                {busy ? 'Updating…' : 'Update now'}
              </button>
            </div>
          </div>
        </>
      )}
    </Frame>
  )
}

async function opened(p: Promise<{ workspace: Workspace; chat: Chat }>) {
  const { workspace, chat } = await p
  await refreshState()
  const s = useStore.getState()
  s.setItems(chat.id, await window.api.getChatItems(chat.id))
  s.setActiveChat(workspace.id, chat.id)
  s.selectWorkspace(workspace.id)
  void refreshStats(workspace.id)
}

export function OpenShareModal({ onClose }: { onClose: () => void }) {
  const draft = useStore((s) => s.shareLinkDraft)
  const [link, setLink] = useState(draft ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [found, setFound] = useState<{ repoId: string; repoName: string; shares: ShareInfo[] }[] | null>(null)

  useEffect(() => {
    useStore.getState().set({ shareLinkDraft: null })
    window.api.listShares().then(setFound, () => setFound([]))
  }, [])

  const open = async (key: string, p: () => Promise<{ workspace: Workspace; chat: Chat }>) => {
    setBusy(key)
    try {
      await opened(p())
      onClose()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
    }
  }
  const openLink = () => link.trim() && void open('link', () => window.api.openShare(link.trim()))
  // A link that arrived from outside the app opens straight away.
  useEffect(() => {
    if (draft) openLink()
  }, [])

  return (
    <Frame title="Open a shared session" onClose={onClose}>
      <div className="flex gap-2">
        <input
          autoFocus
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && openLink()}
          placeholder="Paste a choo-choo://share link"
          className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-faint"
        />
        <button disabled={!!busy || !link.trim()} className={primary} onClick={openLink}>
          {busy === 'link' ? 'Opening…' : 'Open'}
        </button>
      </div>
      <p className="text-[12px] text-faint">Opening a share creates a workspace with the sharer's branch, files and chats. You continue it with your own Claude login.</p>
      <div className="pt-1 text-[11px] font-medium text-faint">Shared in your repositories</div>
      <div className="max-h-[40vh] overflow-y-auto">
        {found === null && <div className="py-2 text-[12px] text-faint">Looking for shares…</div>}
        {found?.length === 0 && <div className="py-2 text-[12px] text-faint">No shares found in your repositories.</div>}
        {found?.map((r) =>
          r.shares.map((sh) => (
            <button
              key={`${r.repoId}:${sh.id}`}
              disabled={!!busy}
              onClick={() => void open(sh.id, () => window.api.openShareById(r.repoId, sh.id))}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{sh.title}</div>
                <div className="truncate text-[12px] text-faint">
                  {r.repoName} · {sh.branch} · {sh.sharedBy} · {new Date(sh.sharedAt).toLocaleString()}
                </div>
              </div>
              <span className="shrink-0 text-[12px] text-faint">{busy === sh.id ? 'Opening…' : `${sh.chats} chat${sh.chats === 1 ? '' : 's'}`}</span>
            </button>
          ))
        )}
      </div>
    </Frame>
  )
}

/** While an opened share is on screen, pull the sharer's newer turns every 30 seconds. */
export function useShareRefresh(ws: Workspace | null) {
  const id = ws?.importedShare ? ws.id : null
  useEffect(() => {
    if (!id) return
    let alive = true
    const tick = async () => {
      try {
        if (!(await window.api.refreshShare(id)) || !alive) return
        await refreshState()
        const s = useStore.getState()
        for (const c of s.chats.filter((c) => c.workspaceId === id)) s.setItems(c.id, await window.api.getChatItems(c.id))
      } catch {
        /* offline or unshared; try again later */
      }
    }
    void tick()
    const t = setInterval(() => void tick(), 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id])
}
