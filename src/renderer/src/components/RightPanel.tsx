import { useEffect, useState } from 'react'
import type { FileChange, PrInfo, Workspace } from '@shared/types'
import { useStore, reportError, openDoc, type RightTab } from '../store'
import { IconDown, IconEye, IconPR, IconSearch } from '../icons'
import { BottomPanel } from './BottomPanel'
import { ArtifactsTab, ChecksTab, FilesTab, ReviewTab } from './RightTabs'
import { fmt } from './Stats'
import { MergedActions } from './Reflect'

const TABS: { id: RightTab; label: string }[] = [
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'All files' },
  { id: 'changes', label: 'Changes' },
  { id: 'checks', label: 'Checks' }
]

export function RightPanel({ ws }: { ws: Workspace }) {
  const s = useStore()
  const [changes, setChanges] = useState<FileChange[]>([])
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const stats = s.stats[ws.id]

  useEffect(() => {
    void window.api.getChanges(ws.id).then(setChanges, () => setChanges([]))
  }, [ws.id, stats])

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="drag flex h-11 shrink-0 items-center justify-end gap-2 border-b border-line px-3">
        <button
          onClick={() => s.set({ rightTab: 'review' })}
          className={`no-drag flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 hover:bg-hover ${s.rightTab === 'review' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
        >
          <IconEye /> Review
        </button>
        <PrButton ws={ws} hasChanges={changes.length > 0} />
        <MergedActions ws={ws} />
      </div>

      <div className={`flex min-h-0 flex-col ${s.bottomOpen ? 'flex-[1_1_50%]' : 'flex-1'}`}>
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => s.set({ rightTab: t.id })}
              className={`rounded-md px-2.5 py-1 ${s.rightTab === t.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t.label}
              {t.id === 'changes' && changes.length > 0 && <span className="ml-1.5 text-faint">{changes.length}</span>}
            </button>
          ))}
          <div className="flex-1" />
          <button className="rounded p-1 text-faint hover:text-fg" onClick={() => { setSearching(!searching); setFilter('') }} title="Filter files">
            <IconSearch />
          </button>
        </div>
        {searching && (
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setSearching(false), setFilter(''))}
            placeholder="Filter files"
            className="mx-3 mb-2 rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-faint"
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {s.rightTab === 'changes' && <ChangesList ws={ws} changes={filter ? changes.filter((c) => c.path.toLowerCase().includes(filter.toLowerCase())) : changes} />}
          {s.rightTab === 'files' && <FilesTab ws={ws} filter={filter} />}
          {s.rightTab === 'artifacts' && <ArtifactsTab ws={ws} />}
          {s.rightTab === 'checks' && <ChecksTab ws={ws} />}
          {s.rightTab === 'review' && <ReviewTab ws={ws} />}
        </div>
      </div>

      <BottomPanel ws={ws} />
    </aside>
  )
}

const STATUS_COLOR: Record<FileChange['status'], string> = {
  A: 'text-add',
  U: 'text-add',
  M: 'text-yellow-400',
  R: 'text-sky-400',
  D: 'text-del'
}

function ChangesList({ ws, changes }: { ws: Workspace; changes: FileChange[] }) {
  const s = useStore()
  const add = changes.reduce((n, c) => n + c.additions, 0)
  const del = changes.reduce((n, c) => n + c.deletions, 0)
  if (changes.length === 0) return <div className="p-6 text-center text-faint">No changes yet</div>
  return (
    <div>
      <div className="flex items-center px-4 py-2 text-muted">
        <span className="flex-1">
          {changes.length} file{changes.length === 1 ? '' : 's'} changed
        </span>
        <span className="font-mono text-[11px]">
          <span className="text-add">+{fmt(add)}</span> <span className="text-del">-{fmt(del)}</span>
        </span>
      </div>
      {changes.map((c) => {
        const slash = c.path.lastIndexOf('/')
        const open = s.openDoc[ws.id]?.kind === 'diff' && s.openDoc[ws.id]?.path === c.path
        return (
          <button
            key={c.path}
            onClick={() => openDoc(ws.id, { kind: 'diff', path: c.path })}
            className={`flex w-full items-center gap-2 px-4 py-1.5 text-left ${open ? 'bg-raised' : 'hover:bg-hover'}`}
            title={c.path}
          >
            <span className="min-w-0 flex-1 truncate">
              {slash >= 0 && <span className="text-faint">{c.path.slice(0, slash + 1)}</span>}
              <span className={c.status === 'D' ? 'line-through' : ''}>{c.path.slice(slash + 1)}</span>
            </span>
            <span className={`font-mono text-[11px] ${STATUS_COLOR[c.status]}`}>{c.status}</span>
            <span className="w-16 text-right font-mono text-[11px]">
              {c.additions > 0 && <span className="text-add">+{fmt(c.additions)}</span>}
              {c.deletions > 0 && <span className="ml-1 text-del">-{fmt(c.deletions)}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function prPrompt(ws: Workspace, baseBranch: string, draft: boolean, reviewFirst = false) {
  return [
    `Create a ${draft ? 'draft ' : ''}pull request for the work on this branch (${ws.branch}).`,
    ...(reviewFirst
      ? [
          `0. First have the reviewer subagent (Agent tool, subagent_type "reviewer") review the changes against \`${baseBranch}\`. If it reports any P0 or P1 finding, stop before committing: list those findings and ask whether to fix them first or open the PR anyway.`
        ]
      : []),
    '1. Review `git status` and the diff, then commit any uncommitted changes with a clear message.',
    `2. Push the branch: \`git push -u origin ${ws.branch}\`.`,
    `3. Open the PR against \`${baseBranch}\` with \`gh pr create${draft ? ' --draft' : ''}\`, a concise title, and a description of what changed and why.`,
    'Reply with the PR URL.'
  ].join('\n')
}

function PrButton({ ws, hasChanges }: { ws: Workspace; hasChanges: boolean }) {
  const s = useStore()
  const stats = s.stats[ws.id]
  const repo = s.repos.find((r) => r.id === ws.repoId)
  const [pr, setPr] = useState<PrInfo | null>(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const chatId = s.activeChat[ws.id] && chats.some((c) => c.id === s.activeChat[ws.id]) ? s.activeChat[ws.id] : chats[0]?.id
  const agentBusy = chats.some((c) => c.status === 'running')

  useEffect(() => {
    let live = true
    const load = () => void window.api.getPr(ws.id).then((p) => live && setPr(p))
    load()
    const t = setInterval(load, 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [ws.id, stats, agentBusy])

  const create = async (draft: boolean) => {
    setMenu(false)
    if (!chatId) return
    s.setActiveChat(ws.id, chatId)
    try {
      const chat = s.chats.find((c) => c.id === chatId)
      const { extras } = s.settings
      const reviewFirst = extras.agents.reviewer && extras.reviewBeforePr && chat?.model !== 'codex'
      await window.api.sendMessage(chatId, prPrompt(ws, repo?.defaultBranch ?? 'main', draft, reviewFirst))
    } catch (e) {
      reportError(e)
    }
  }

  const merge = async () => {
    setMenu(false)
    setBusy(true)
    try {
      await window.api.mergePr(ws.id)
      setPr(await window.api.getPr(ws.id))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const color = pr?.state === 'MERGED' ? 'text-violet-400' : pr?.state === 'CLOSED' ? 'text-del' : pr?.isDraft ? 'text-muted' : 'text-add'
  return (
    <div className="no-drag relative flex items-center rounded-md border border-line">
      {pr ? (
        <button className={`flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover ${color}`} onClick={() => void window.api.openExternal(pr.url)} title={pr.title}>
          <IconPR /> {pr.state === 'MERGED' ? 'Merged' : pr.state === 'CLOSED' ? 'Closed' : pr.isDraft ? 'Draft' : 'Open'} #{pr.number}
        </button>
      ) : (
        <button
          className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover disabled:opacity-40"
          disabled={agentBusy || (!hasChanges && !stats?.files)}
          onClick={() => void create(false)}
          title={agentBusy ? 'Wait for the agent to finish' : 'Ask the agent to commit, push and open a PR'}
        >
          <IconPR /> Create PR
        </button>
      )}
      <button className="border-l border-line px-1.5 py-1 hover:bg-hover" onClick={() => setMenu(!menu)}>
        <IconDown />
      </button>
      {menu && (
        <div className="absolute top-8 right-0 z-30 w-52 rounded-lg border border-line bg-raised p-1 text-fg shadow-xl" onMouseLeave={() => setMenu(false)}>
          {pr ? (
            <>
              <MenuBtn label="Open on GitHub" onClick={() => { setMenu(false); void window.api.openExternal(pr.url) }} />
              {pr.state === 'OPEN' && <MenuBtn label={busy ? 'Merging…' : 'Squash and merge'} onClick={() => void merge()} />}
              {pr.state === 'OPEN' && <MenuBtn label="Push latest changes" onClick={() => { setMenu(false); if (chatId) void window.api.sendMessage(chatId, 'Commit any uncommitted changes and push this branch.') }} />}
            </>
          ) : (
            <>
              <MenuBtn label="Create PR" onClick={() => void create(false)} />
              <MenuBtn label="Create draft PR" onClick={() => void create(true)} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuBtn(p: { label: string; onClick: () => void }) {
  return (
    <button onClick={p.onClick} className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover">
      {p.label}
    </button>
  )
}
