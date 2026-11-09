import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PrInfo, Workspace, WorkspacePreview as Preview } from '@shared/types'
import { useStore, ago, reportError } from '../store'
import { IconDown, IconPR } from '../icons'
import { prPrompt } from './RightPanel'
import { fmt } from './Stats'

// PR lookups go through gh, so keep them for a minute per workspace.
const prCache = new Map<string, { version: number; pr: PrInfo | null }>()

/**
 * Hover state for a sidebar row: shows the card after a short delay and keeps it open
 * while the pointer moves from the row onto the card.
 */
export function useHoverCard(delay = 350) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const show = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(
    () => () => {
      clearTimeout(show.current)
      clearTimeout(hide.current)
    },
    []
  )
  return {
    rect,
    rowProps: {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
        const el = e.currentTarget
        clearTimeout(hide.current)
        show.current = setTimeout(() => setRect(el.getBoundingClientRect()), delay)
      },
      onMouseLeave: () => {
        clearTimeout(show.current)
        hide.current = setTimeout(() => setRect(null), 120)
      }
    },
    cardProps: {
      onMouseEnter: () => clearTimeout(hide.current),
      onMouseLeave: () => setRect(null)
    },
    close: () => {
      clearTimeout(show.current)
      setRect(null)
    }
  }
}

/** The card Conductor shows when you hover a workspace: branch, diff size, status, title, latest message, Create PR and last activity. */
export function WorkspacePreviewCard({ ws, rect, cardProps, onClose }: { ws: Workspace; rect: DOMRect; cardProps: React.HTMLAttributes<HTMLDivElement>; onClose: () => void }) {
  const s = useStore()
  const prVersion = s.prVersion[ws.id] ?? 0
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pr, setPr] = useState<PrInfo | null | undefined>(prCache.get(ws.id)?.pr)
  const [menu, setMenu] = useState(false)
  const stats = s.stats[ws.id]
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const running = chats.some((c) => c.status === 'running')
  const asking = chats.some((c) => (s.permissions[c.id]?.length ?? 0) > 0)

  useEffect(() => {
    let live = true
    void window.api.workspacePreview(ws.id).then((p) => live && setPreview(p), () => {})
    const cached = prCache.get(ws.id)
    if (!cached || cached.version !== prVersion) {
      void window.api.getPr(ws.id).then(
        (p) => {
          prCache.set(ws.id, { version: prVersion, pr: p })
          if (live) setPr(p)
        },
        () => live && setPr(null)
      )
    }
    return () => {
      live = false
    }
  }, [ws.id, prVersion])

  const createPr = async (draft: boolean) => {
    setMenu(false)
    onClose()
    const st = useStore.getState()
    const chatId = st.activeChat[ws.id] && chats.some((c) => c.id === st.activeChat[ws.id]) ? st.activeChat[ws.id] : chats[0]?.id
    if (!chatId) return
    st.setActiveChat(ws.id, chatId)
    st.selectWorkspace(ws.id)
    const repo = st.repos.find((r) => r.id === ws.repoId)
    try {
      await window.api.sendMessage(chatId, prPrompt(ws, repo?.defaultBranch ?? 'main', draft))
    } catch (e) {
      reportError(e)
    }
  }

  const width = 340
  const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - 200))
  const left = rect.right + 12

  return createPortal(
    <div
      {...cardProps}
      role="tooltip"
      className="anim-pop fixed z-40 rounded-xl border border-line bg-raised p-3.5 text-[13px] shadow-2xl"
      style={{ top, left, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-muted">{ws.branch}</span>
        {stats && stats.additions > 0 && <span className="shrink-0 font-mono text-[12px] text-add">+{fmt(stats.additions)}</span>}
        {stats && stats.deletions > 0 && <span className="shrink-0 font-mono text-[12px] text-del">-{fmt(stats.deletions)}</span>}
        <span className="flex-1" />
        <StatusIcon running={running} asking={asking} pr={pr} />
      </div>
      <div className="mt-1.5 truncate text-[14px] font-medium text-fg">{ws.title}</div>
      {preview?.snippet && <div className="mt-1 line-clamp-2 text-[12px] text-faint">{preview.snippet}</div>}
      <div className="mt-3 flex items-center">
        {pr ? (
          <button
            className={`flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 hover:bg-hover ${pr.state === 'MERGED' ? 'text-violet-400' : pr.state === 'CLOSED' ? 'text-del' : pr.isDraft ? 'text-muted' : 'text-add'}`}
            onClick={() => void window.api.openExternal(pr.url)}
            title={pr.title}
          >
            <IconPR /> {pr.state === 'MERGED' ? 'Merged' : pr.state === 'CLOSED' ? 'Closed' : pr.isDraft ? 'Draft' : 'Open'} #{pr.number}
          </button>
        ) : (
          <div className="relative flex items-center rounded-md border border-line">
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover disabled:opacity-40"
              disabled={running || pr === undefined}
              onClick={() => void createPr(false)}
              title={running ? 'Wait for the agent to finish' : 'Ask the agent to commit, push and open a PR'}
            >
              <IconPR /> Create PR
            </button>
            <button title="More PR actions" className="border-l border-line px-1.5 py-1 hover:bg-hover disabled:opacity-40" disabled={running || pr === undefined} onClick={() => setMenu(!menu)}>
              <IconDown />
            </button>
            {menu && (
              <div className="absolute top-8 left-0 z-50 w-44 rounded-lg border border-line bg-raised p-1 shadow-xl">
                <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover" onClick={() => void createPr(false)}>
                  Create PR
                </button>
                <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover" onClick={() => void createPr(true)}>
                  Create draft PR
                </button>
              </div>
            )}
          </div>
        )}
        <span className="flex-1" />
        <span className="text-[12px] text-faint">{preview ? `${ago(preview.lastActive)} ago`.replace('now ago', 'just now') : ''}</span>
      </div>
    </div>,
    document.body
  )
}

function StatusIcon({ running, asking, pr }: { running: boolean; asking: boolean; pr: PrInfo | null | undefined }) {
  if (asking) return <span title="Needs you" className="anim-glow h-3 w-3 shrink-0 rounded-full bg-accent" />
  if (running) return <span title="Working" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-faint border-t-accent" />
  if (pr?.state === 'MERGED') return <IconPR className="shrink-0 text-violet-400" width={15} height={15} aria-label="Merged" />
  if (pr?.state === 'OPEN') return <IconPR className={`shrink-0 ${pr.isDraft ? 'text-muted' : 'text-add'}`} width={15} height={15} aria-label="PR open" />
  // In progress: a half-filled circle, like Conductor's.
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0 text-yellow-400" aria-label="In progress">
      <title>In progress</title>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
    </svg>
  )
}
