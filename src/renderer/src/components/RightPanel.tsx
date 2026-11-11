import { useEffect, useState } from 'react'
import type { CheckRun, FileChange, PrComment, PrInfo, Workspace } from '@shared/types'
import { canUpdateBranch, fixChecksPrompt, nextPrAction, resolveConflictsPrompt, summarizeChecks } from '@shared/prStatus'
import { newSince, prCommentsPrompt } from '@shared/prComments'
import { isTheirs, type PrReviewInfo } from '@shared/prReview'
import { useStore, reportError, openDoc, type RightTab } from '../store'
import { IconComment, IconDown, IconEye, IconPR, IconSearch } from '../icons'
import { BottomPanel } from './BottomPanel'
import { ArtifactsTab, ChecksTab, FilesTab, ReviewTab } from './RightTabs'
import { fmt } from './Stats'
import { MergedActions } from './Reflect'
import { UsageGraphs } from './UsageGraphs'
import { AddonActions, AddonFrame, addonTabId, addonViews } from './Addons'
import { StackTab } from './Stack'
import { prBaseFor } from '@shared/stack'
import * as L from '@shared/layout'

const TABS: { id: RightTab; label: string; stack?: boolean }[] = [
  { id: 'stack', label: 'Stack', stack: true },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'All files' },
  { id: 'changes', label: 'Changes' },
  { id: 'checks', label: 'Checks' },
  { id: 'graphs', label: 'Graphs' }
]

export function RightPanel({ ws }: { ws: Workspace }) {
  const s = useStore()
  const [changes, setChanges] = useState<FileChange[]>([])
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const stats = s.stats[ws.id]
  const addonTabs = addonViews(s.addons, 'workspace')
  const addonTab = addonTabs.find((t) => addonTabId(t.addon, t.view) === s.rightTab)
  const split = !!s.layout && L.leaves(s.layout).length > 1

  // The add-on behind the open tab was turned off: fall back to Changes.
  useEffect(() => {
    if (s.rightTab.startsWith('addon:') && !addonTab) s.set({ rightTab: 'changes' })
    if (s.rightTab === 'stack' && !ws.stack) s.set({ rightTab: 'changes' })
  }, [s.rightTab, !!addonTab, !!ws.stack])

  useEffect(() => {
    void window.api.getChanges(ws.id).then(setChanges, () => setChanges([]))
  }, [ws.id, stats])

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="drag flex h-11 shrink-0 items-center justify-end gap-2 border-b border-line px-3">
        {split && (
          <span className="mr-auto flex min-w-0 items-center gap-1.5 text-[12.5px]" title="The right panel follows the focused pane">
            <span className="shrink-0 text-muted">{s.repos.find((r) => r.id === ws.repoId)?.name} /</span>
            <span className="truncate font-semibold">{ws.orchestrator ? 'Orchestrator' : ws.title}</span>
          </span>
        )}
        <button
          onClick={() => s.set({ rightTab: 'review' })}
          className={`no-drag flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 hover:bg-hover ${s.rightTab === 'review' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
        >
          <IconEye /> Review
        </button>
        {!ws.orchestrator && <AddonActions place="workspace-header" repoId={ws.repoId} workspaceId={ws.id} className="rounded-md border border-line p-[7px] text-muted hover:bg-hover" />}
        <PrButton ws={ws} hasChanges={changes.length > 0} />
        <MergedActions ws={ws} />
      </div>

      <div className={`flex min-h-0 flex-col ${s.bottomOpen ? 'flex-[1_1_50%]' : 'flex-1'}`}>
        <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-2 whitespace-nowrap [scrollbar-width:none]">
          {TABS.filter((t) => !t.stack || ws.stack).map((t) => (
            <button
              key={t.id}
              onClick={() => s.set({ rightTab: t.id })}
              className={`rounded-md px-2.5 py-1 ${s.rightTab === t.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t.label}
              {t.id === 'changes' && changes.length > 0 && <span className="ml-1.5 text-faint">{changes.length}</span>}
            </button>
          ))}
          {addonTabs.map(({ addon, view }) => {
            const id = addonTabId(addon, view)
            return (
              <button key={id} title={`From the ${addon.name} add-on`} onClick={() => s.set({ rightTab: id })} className={`rounded-md px-2.5 py-1 ${s.rightTab === id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
                {view.title}
              </button>
            )
          })}
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
        {addonTab && (
          <div className="flex min-h-0 flex-1">
            <AddonFrame addon={addonTab.addon} view={addonTab.view} repoId={ws.repoId} workspaceId={ws.id} />
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${addonTab ? 'hidden' : ''}`}>
          {s.rightTab === 'stack' && <StackTab ws={ws} />}
          {s.rightTab === 'changes' && <ChangesList ws={ws} changes={filter ? changes.filter((c) => c.path.toLowerCase().includes(filter.toLowerCase())) : changes} />}
          {s.rightTab === 'files' && <FilesTab ws={ws} filter={filter} />}
          {s.rightTab === 'artifacts' && <ArtifactsTab ws={ws} />}
          {s.rightTab === 'checks' && <ChecksTab ws={ws} />}
          {s.rightTab === 'graphs' && <GraphsTab ws={ws} />}
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
  const [comments, setComments] = useState<PrComment[]>([])
  const [checks, setChecks] = useState<CheckRun[]>([])
  const [addedAt, setAddedAt] = useState(() => localStorage.getItem(addedKey(ws.id)) ?? undefined)
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const chatId = s.activeChat[ws.id] && chats.some((c) => c.id === s.activeChat[ws.id]) ? s.activeChat[ws.id] : chats[0]?.id
  const agentBusy = chats.some((c) => c.status === 'running')
  const prVersion = s.prVersion[ws.id] ?? 0
  // On someone else's PR the header pill already says it needs your review.
  const theirs = isTheirs(s.prReview[ws.id]?.info)

  useEffect(() => {
    let live = true
    const load = () =>
      void window.api.getPr(ws.id).then((p) => {
        if (!live) return
        setPr(p)
        const set = (v: { pr: PrInfo; info: PrReviewInfo } | null) => {
          const st = useStore.getState()
          st.set({ prReview: { ...st.prReview, [ws.id]: v } })
        }
        if (!p) set(null)
        // Feedback, who wrote the PR and who is signed in: the diff and Review tab use these too.
        window.api.getPrReview(ws.id).then(
          (r) => {
            if (!live) return
            set(r)
            setComments(r && r.pr.state === 'OPEN' ? r.info.feedback : [])
          },
          () => {}
        )
        if (p?.state !== 'OPEN') return setChecks([])
        window.api.getChecks(ws.id).then((c) => live && setChecks(c), () => {})
      })
    setAddedAt(localStorage.getItem(addedKey(ws.id)) ?? undefined)
    load()
    return () => {
      live = false
    }
    // prVersion: the PR watcher in the main process saw a change on GitHub.
  }, [ws.id, ws.branch, ws.prNumber, stats, agentBusy, prVersion])

  const create = async (draft: boolean) => {
    setMenu(false)
    if (!chatId) return
    s.setActiveChat(ws.id, chatId)
    try {
      const chat = s.chats.find((c) => c.id === chatId)
      const { extras } = s.settings
      const reviewFirst = extras.agents.reviewer && extras.reviewBeforePr && chat?.model !== 'codex'
      await window.api.sendMessage(chatId, prPrompt(ws, prBaseFor(ws.stack, ws.branch, repo?.defaultBranch ?? 'main'), draft, reviewFirst))
    } catch (e) {
      reportError(e)
    }
  }

  const fresh = newSince(comments, addedAt)

  /** Conductor's "Add all comments to chat": hands every open comment to the agent with file and line context. */
  const addComments = async () => {
    setMenu(false)
    if (!chatId || !pr || !comments.length) return
    s.setActiveChat(ws.id, chatId)
    try {
      await window.api.sendMessage(chatId, prCommentsPrompt(pr, comments))
      const newest = comments.reduce((m, c) => (c.createdAt > m ? c.createdAt : m), '')
      localStorage.setItem(addedKey(ws.id), newest)
      setAddedAt(newest)
    } catch (e) {
      reportError(e)
    }
  }

  /** Starts a new branch built on this PR's branch, turning the workspace into a stack. */
  const stackOnTop = async () => {
    setMenu(false)
    try {
      await window.api.stackAddLayer(ws.id)
      s.set({ rightTab: 'stack' })
    } catch (e) {
      reportError(e)
    }
  }

  const markReady = async () => {
    setMenu(false)
    setBusy(true)
    try {
      await window.api.markPrReady(ws.id)
      setPr(await window.api.getPr(ws.id))
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  /** GitHub's "Update branch": merges the base branch in, so the PR is tested against what it will land on. */
  const updateBranch = async () => {
    setMenu(false)
    setBusy(true)
    try {
      await window.api.updatePrBranch(ws.id)
    } catch (e) {
      reportError(e)
    } finally {
      // Also after a failure: GitHub may have the update even when the worktree couldn't take it.
      setPr(await window.api.getPr(ws.id).catch(() => pr))
      setBusy(false)
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

  const sum = summarizeChecks(checks)
  const action = pr ? nextPrAction(pr, sum) : null
  const ask = async (text: string) => {
    if (!chatId) return
    s.setActiveChat(ws.id, chatId)
    try {
      await window.api.sendMessage(chatId, text)
    } catch (e) {
      reportError(e)
    }
  }
  const color = pr?.state === 'MERGED' ? 'text-violet-400' : pr?.state === 'CLOSED' ? 'text-del' : pr?.isDraft ? 'text-muted' : 'text-add'
  return (
    <>
      {pr?.state === 'OPEN' && comments.length > 0 && (
        <button
          className={`no-drag flex items-center gap-1.5 rounded-md border px-2 py-1 disabled:opacity-40 ${fresh.length ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25' : 'border-line text-muted hover:bg-hover hover:text-fg'}`}
          disabled={agentBusy}
          onClick={() => void addComments()}
          title={
            agentBusy
              ? 'Wait for the agent to finish'
              : `Add all ${comments.length} PR comment${comments.length === 1 ? '' : 's'} to chat${fresh.length && addedAt ? ` (${fresh.length} new)` : ''}`
          }
        >
          <IconComment /> {fresh.length && addedAt ? `${fresh.length} new` : comments.length}
        </button>
      )}
      {pr?.state === 'OPEN' && sum.total > 0 && (
        <button
          className={`no-drag flex items-center gap-1.5 rounded-md border border-line px-2 py-1 hover:bg-hover ${sum.failed.length ? 'text-del' : sum.pending ? 'text-muted' : 'text-add'}`}
          onClick={() => s.set({ rightTab: 'checks' })}
          title={sum.failed.length ? `Failing: ${sum.failed.map((c) => c.name).join(', ')}` : sum.pending ? `${sum.pending} checks running` : 'All checks passed'}
        >
          {sum.pending && !sum.failed.length ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-faint border-t-fg" />
          ) : (
            <span className={`h-2 w-2 rounded-full ${sum.failed.length ? 'bg-del' : 'bg-add'}`} />
          )}
          {sum.failed.length ? `${sum.failed.length} failed` : sum.pending ? `${sum.passed}/${sum.total}` : 'Checks'}
        </button>
      )}
      <div className="no-drag relative flex items-center rounded-md border border-line">
        {pr && action === 'resolve' ? (
          <button className="flex items-center gap-1.5 px-2.5 py-1 text-amber-400 hover:bg-hover disabled:opacity-40" disabled={agentBusy} onClick={() => void ask(resolveConflictsPrompt(pr, repo?.defaultBranch ?? 'main'))} title="Ask the agent to merge the base branch and resolve conflicts">
            <IconPR /> Resolve conflicts
          </button>
        ) : pr && action === 'fix' ? (
          <button className="flex items-center gap-1.5 px-2.5 py-1 text-del hover:bg-hover disabled:opacity-40" disabled={agentBusy} onClick={() => void ask(fixChecksPrompt(pr, sum.failed))} title="Ask the agent to fix the failing checks">
            <IconPR /> Fix checks
          </button>
        ) : pr && action === 'merge' ? (
          <button className="flex items-center gap-1.5 bg-add/15 px-2.5 py-1 text-add hover:bg-add/25 disabled:opacity-40" disabled={busy} onClick={() => void merge()} title={`Squash and merge #${pr.number}`}>
            <IconPR /> {busy ? 'Merging…' : 'Merge'}
          </button>
        ) : pr ? (
          <button className={`flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover ${color}`} onClick={() => void window.api.openExternal(pr.url)} title={action === 'review' ? 'Waiting for an approving review' : action === 'waiting' ? 'Checks are running' : pr.title}>
            <IconPR /> {pr.state === 'MERGED' ? 'Merged' : pr.state === 'CLOSED' ? 'Closed' : pr.isDraft ? 'Draft' : action === 'review' && !theirs ? 'Needs review' : 'Open'} #{pr.number}
          </button>
        ) : (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover disabled:opacity-40"
            disabled={agentBusy || (!hasChanges && !stats?.files)}
            onClick={() => void create(true)}
            title={agentBusy ? 'Wait for the agent to finish' : 'Ask the agent to commit, push and open a draft PR'}
          >
            <IconPR /> Create PR
          </button>
        )}
        <button title="More PR actions" className="border-l border-line px-1.5 py-1 hover:bg-hover" onClick={() => setMenu(!menu)}>
          <IconDown />
        </button>
        {menu && (
          <div className="absolute top-8 right-0 z-30 w-52 rounded-lg border border-line bg-raised p-1 text-fg shadow-xl" onMouseLeave={() => setMenu(false)}>
            {pr ? (
              <>
                <MenuBtn label={`Open #${pr.number} on GitHub`} onClick={() => { setMenu(false); void window.api.openExternal(pr.url) }} />
                {pr.state === 'OPEN' && <MenuBtn label={busy ? 'Merging…' : 'Squash and merge'} onClick={() => void merge()} />}
                {pr.state === 'OPEN' && comments.length > 0 && <MenuBtn label={`Add all comments to chat (${comments.length})`} onClick={() => void addComments()} />}
                {pr.state === 'OPEN' && pr.isDraft && <MenuBtn label={busy ? 'Marking ready…' : 'Mark ready for review'} onClick={() => void markReady()} />}
                {canUpdateBranch(pr) && !agentBusy && (
                  <MenuBtn label={busy ? 'Updating…' : `Update branch${pr.behindBy ? ` (${pr.behindBy} behind ${pr.baseRefName ?? 'base'})` : ''}`} onClick={() => void updateBranch()} />
                )}
                {pr.state === 'OPEN' && <MenuBtn label={ws.stack ? 'Add a PR on top of the stack' : 'Stack a new PR on top'} onClick={() => void stackOnTop()} />}
              </>
            ) : (
              <>
                <MenuBtn label="Create draft PR" onClick={() => void create(true)} />
                <MenuBtn label="Create PR ready for review" onClick={() => void create(false)} />
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** localStorage key for when a workspace's PR comments were last added to chat. */
const addedKey = (wsId: string) => `prCommentsAddedAt:${wsId}`

function MenuBtn(p: { label: string; onClick: () => void }) {
  return (
    <button onClick={p.onClick} className="block w-full rounded px-2 py-1.5 text-left hover:bg-hover">
      {p.label}
    </button>
  )
}

/** The usage graphs for the chat open in the center, sized for the side panel. */
function GraphsTab({ ws }: { ws: Workspace }) {
  const s = useStore()
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const chat = chats.find((c) => c.id === s.activeChat[ws.id]) ?? chats[0]
  if (!chat) return <div className="px-4 py-6 text-center text-faint">No chats yet.</div>
  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-2 text-[12px]">
        <span className="truncate text-muted">{chat.title}</span>
        <button className="ml-auto shrink-0 text-faint hover:text-fg" onClick={() => s.set({ modal: 'usage', usageChat: chat.id })}>
          Open larger
        </button>
      </div>
      <UsageGraphs key={chat.id} chat={chat} compact />
    </div>
  )
}
