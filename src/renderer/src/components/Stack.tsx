import { useEffect, useState } from 'react'
import type { StackLayerStatus, StackStatus, Workspace } from '@shared/types'
import { githubLinked, mergeThroughLabel, mergeThroughPrs, restackConflictPrompt } from '@shared/stack'
import { useStore, reportError, loadStack } from '../store'
import { IconCheck, IconComment, IconDown, IconPlus, IconRestack, IconStack, IconX } from '../icons'

/**
 * Stacked PRs: the sidebar rows under a stacked workspace, the header switcher, and the Stack tab.
 * The git work happens in the main process (src/main/stack.ts); see docs/prd/stacked-prs.md.
 */

const run = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (e) {
    reportError(e)
  }
}

/** Keeps the store's status for a stacked workspace fresh while a stack view is on screen. */
function useStackStatus(ws: Workspace): StackStatus | null | undefined {
  const st = useStore((s) => s.stacks[ws.id])
  const prVersion = useStore((s) => s.prVersion[ws.id] ?? 0)
  const stacked = !!ws.stack
  useEffect(() => {
    if (!stacked) return
    void loadStack(ws.id)
    const t = setInterval(() => void loadStack(ws.id), 60_000)
    return () => clearInterval(t)
  }, [ws.id, stacked, prVersion])
  return st
}

/** Checks out a PR of the stack and opens its workspace. */
function switchTo(ws: Workspace, branch: string) {
  const s = useStore.getState()
  if (s.selectedWs !== ws.id) s.selectWorkspace(ws.id)
  if (branch === ws.branch) return
  void run(() => window.api.stackSwitch(ws.id, branch))
}

/** The stack's PRs, listed under the workspace in the sidebar. */
export function StackRows({ ws }: { ws: Workspace }) {
  const status = useStore((s) => s.stacks[ws.id])
  const selected = useStore((s) => s.selectedWs === ws.id)
  if (!ws.stack) return null
  const byBranch = new Map(status?.layers.map((l) => [l.branch, l]) ?? [])
  return (
    <div className="mb-0.5">
      {ws.stack.layers.map((l, i) => {
        const st = byBranch.get(l.branch)
        const on = selected && ws.branch === l.branch
        const here = ws.branch === l.branch
        return (
          <button
            key={l.branch}
            onClick={() => switchTo(ws, l.branch)}
            title={`${l.branch}${st?.behind && i > 0 ? ' · needs a restack' : ''}`}
            className={`relative flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-9 text-left text-[12.5px] ${on ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <span className="absolute top-0 bottom-0 left-[27px] border-l border-line" />
            <span className={`relative z-10 h-1.5 w-1.5 shrink-0 rounded-full ${here ? 'bg-accent' : st?.behind && i > 0 ? 'bg-amber-400' : 'bg-faint'}`} />
            <span className="w-3 shrink-0 text-faint">{i + 1}</span>
            <span className="flex-1 truncate">{l.pr?.title ?? l.branch}</span>
            {!!st?.comments && (
              <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1 text-[10.5px] text-accent">
                <IconComment width={10} height={10} />
                {st.comments}
              </span>
            )}
            {l.pr && <span className="shrink-0 text-[11px] text-faint">#{l.pr.number}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The header pill that says which PR of the stack the agent is working on, and switches it. */
export function StackSwitcher({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState(false)
  if (!ws.stack) return null
  const layers = ws.stack.layers
  const i = layers.findIndex((l) => l.branch === ws.branch)
  const cur = layers[i]
  return (
    <div className="no-drag relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        title={`${ws.branch}: switch the PR the agent works on`}
        className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-0.5 hover:bg-hover"
      >
        <span className="shrink-0 text-faint">
          {i + 1}/{layers.length}
        </span>
        <span className="selectable truncate">{cur?.pr?.title ?? ws.branch}</span>
        {cur?.pr && <span className="shrink-0 text-faint">#{cur.pr.number}</span>}
        <IconDown className="shrink-0 text-faint" />
      </button>
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute top-8 left-0 z-30 w-80 rounded-lg border border-line bg-raised p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {[...layers].reverse().map((l) => {
            const n = layers.indexOf(l) + 1
            return (
              <button
                key={l.branch}
                onClick={() => {
                  setOpen(false)
                  switchTo(ws, l.branch)
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover ${l.branch === ws.branch ? 'text-fg' : 'text-muted'}`}
              >
                <span className="w-3 text-faint">{n}</span>
                <span className="flex-1 truncate">{l.pr?.title ?? l.branch}</span>
                {l.pr && <span className="text-faint">#{l.pr.number}</span>}
                {l.branch === ws.branch && <IconCheck className="text-accent" />}
              </button>
            )
          })}
          <div className="my-1 border-t border-line" />
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted hover:bg-hover hover:text-fg"
            onClick={() => {
              setOpen(false)
              void run(() => window.api.stackAddLayer(ws.id))
            }}
          >
            <IconPlus /> Add a PR on top
          </button>
        </div>
      )}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'add' | 'acc' | 'amb' | 'mut' | 'del'; children: React.ReactNode }) {
  const c = { add: 'bg-add/15 text-add', acc: 'bg-accent/15 text-accent', amb: 'bg-amber-400/15 text-amber-400', mut: 'bg-raised text-muted', del: 'bg-del/15 text-del' }[tone]
  return <span className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[10.5px] leading-[17px] ${c}`}>{children}</span>
}

function syncBadge(l: StackLayerStatus, i: number, current: boolean, conflict: boolean) {
  if (conflict) return <Badge tone="del">Conflicts</Badge>
  if (current) return <Badge tone="acc">Working here</Badge>
  if (l.behind && i > 0) return <Badge tone="amb">Needs restack</Badge>
  if (l.unpushed) return <Badge tone="amb">Not pushed</Badge>
  if (l.pr?.state === 'MERGED') return <Badge tone="mut">Merged</Badge>
  return (
    <Badge tone="add">
      <IconCheck width={10} height={10} /> Up to date
    </Badge>
  )
}

function checksLine(l: StackLayerStatus) {
  if (!l.pr) return <span>No PR yet</span>
  if (l.pr.state !== 'OPEN') return <span>{l.pr.state === 'MERGED' ? 'Merged' : 'Closed'}</span>
  if (l.pr.reviewDecision === 'CHANGES_REQUESTED') return <span className="text-del">Changes requested</span>
  if (l.checks.failed) return <span className="text-del">{l.checks.failed} check{l.checks.failed === 1 ? '' : 's'} failing</span>
  if (l.checks.pending) return <span>Checks running</span>
  if (l.pr.reviewDecision === 'APPROVED') return <span className="text-add">Approved</span>
  if (l.checks.total) return <span className="text-add">Checks passed</span>
  return <span>{l.pr.isDraft ? 'Draft' : 'Open'}</span>
}

/** The Stack tab in the right panel: every PR bottom to top, with what to do next. */
export function StackTab({ ws }: { ws: Workspace }) {
  const s = useStore()
  const status = useStackStatus(ws)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string[] | null>(null)
  /** The branch whose "Merge through" is waiting for a second click, and the last merge's outcome. */
  const [confirmMerge, setConfirmMerge] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const chats = s.chats.filter((c) => c.workspaceId === ws.id)
  const chatId = s.activeChat[ws.id] && chats.some((c) => c.id === s.activeChat[ws.id]) ? s.activeChat[ws.id] : chats[0]?.id
  const agentBusy = chats.some((c) => c.status === 'running')
  if (!ws.stack) return null
  if (!status) return <div className="p-6 text-center text-faint">{status === null ? 'Not a stack' : 'Loading the stack…'}</div>

  const act = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label)
    await run(fn)
    setBusy(null)
    void loadStack(ws.id)
  }
  const send = (text: string) =>
    run(async () => {
      if (!chatId) return
      s.setActiveChat(ws.id, chatId)
      await window.api.sendMessage(chatId, text)
    })
  const withFeedback = status.layers.filter((l) => l.comments > 0)
  const totalComments = withFeedback.reduce((n, l) => n + l.comments, 0)
  const base = status.base.replace(/^origin\//, '')
  const job = status.job
  const openPrs = status.layers.filter((l) => l.pr?.state === 'OPEN').map((l) => l.pr!.number)
  const gh = status.github
  const linked = githubLinked(openPrs, gh)
  const mergeThrough = (branch: string, prs: number[]) =>
    act('merge', async () => {
      setConfirmMerge(null)
      setNotice(null)
      const r = await window.api.stackMergeThrough(ws.id, branch)
      setNotice(
        r.queued
          ? `Queued ${prs.map((n) => `#${n}`).join(', ')} to merge. Press Sync with ${base} once they land.`
          : `Merged ${r.merged.map((n) => `#${n}`).join(', ')} into ${base}${r.dropped.length ? ' and took them off the stack' : ''}.`
      )
    })

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 flex items-center gap-2">
          <IconStack className="text-accent" />
          <span className="font-semibold">{ws.title}</span>
          <span className="text-faint">
            {status.layers.length} PR{status.layers.length === 1 ? '' : 's'} on {base}
          </span>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-muted" title="After each agent turn on a lower PR, rebase the PRs above it and push them">
            Keep up to date
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={ws.stack.autoRestack} onChange={(e) => void run(() => window.api.stackSetAuto(ws.id, e.target.checked))} />
          </label>
        </div>

        {gh !== 'unavailable' && openPrs.length >= 2 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-[12.5px]">
            {linked && typeof gh === 'object' && gh ? (
              <span className="text-muted">
                Linked on GitHub as stack #{gh.number}. Merging goes through GitHub, all PRs or none.
              </span>
            ) : (
              <>
                <span className="text-muted">{gh ? 'Some PRs are missing from the GitHub stack.' : 'Link the stack on GitHub so it shows as a stack there and can merge in one step.'}</span>
                <button
                  disabled={!!busy || !!job}
                  className="ml-auto rounded-md border border-accent/50 px-2 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-40"
                  onClick={act('link', () => window.api.stackLinkGithub(ws.id))}
                >
                  {busy === 'link' ? 'Linking…' : 'Link on GitHub'}
                </button>
              </>
            )}
            {linked && !status.ghStackCli && (
              <>
                <span className="text-faint">Merging needs GitHub's gh-stack extension.</span>
                <button
                  disabled={!!busy}
                  className="ml-auto rounded-md border border-line px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                  onClick={act('install', () => window.api.stackInstallCli())}
                  title="Runs gh extension install github/gh-stack"
                >
                  {busy === 'install' ? 'Installing…' : 'Install gh-stack'}
                </button>
              </>
            )}
          </div>
        )}

        {notice && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-add/40 bg-add/10 px-3 py-2 text-[12.5px]">
            <span className="flex-1">{notice}</span>
            <button className="text-faint hover:text-fg" onClick={() => setNotice(null)} title="Dismiss">
              <IconX width={11} height={11} />
            </button>
          </div>
        )}

        {job && (
          <div className="mb-3 overflow-hidden rounded-lg border border-line bg-bg">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-semibold">
              {job.kind === 'feedback' ? <IconComment className="text-accent" /> : <IconRestack className="text-accent" />}
              {job.kind === 'feedback' ? 'Addressing feedback, bottom PR first' : 'Restacking'}
            </div>
            {job.steps.map((st, k) => (
              <div key={k} className={`flex items-center gap-2 px-3 py-1.5 text-[12.5px] ${st.state === 'todo' ? 'text-faint' : ''}`}>
                {st.state === 'done' ? (
                  <IconCheck className="text-add" />
                ) : st.state === 'doing' ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-accent" />
                ) : st.state === 'failed' ? (
                  <IconX className="text-del" />
                ) : (
                  <span className="mx-[5px] h-1 w-1 rounded-full bg-faint" />
                )}
                {st.label}
              </div>
            ))}
            {(job.error || job.paused) && <div className={`px-3 py-1.5 text-[12px] ${job.error ? 'text-del' : 'text-muted'}`}>{job.error ?? 'Paused. Check the fix, then continue with the next PR.'}</div>}
            <div className="flex gap-2 border-t border-line px-3 py-2">
              {(job.error || job.paused) && (
                <button className="rounded-md bg-accent px-2.5 py-1 font-semibold text-[#1a1b20] hover:opacity-90" onClick={() => void run(() => window.api.stackContinue(ws.id))}>
                  Continue
                </button>
              )}
              <button className="rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg" onClick={() => void run(() => window.api.stackStopJob(ws.id))}>
                {job.error || job.paused ? 'Dismiss' : 'Stop'}
              </button>
            </div>
          </div>
        )}

        {status.conflict && !job && (
          <div className="mb-3 rounded-lg border border-del/40 bg-del/10 px-3 py-2 text-[12.5px]">
            <div className="mb-1 text-del">Restacking {status.conflict.branch} stopped on conflicts:</div>
            <div className="mb-2 font-mono text-[11.5px] text-muted">{status.conflict.files.join(', ') || 'files resolved, ready to continue'}</div>
            <div className="flex gap-2">
              <button
                disabled={agentBusy || !status.conflict.files.length}
                className="rounded-md border border-line px-2 py-0.5 hover:bg-hover disabled:opacity-40"
                onClick={() => void send(restackConflictPrompt(status.conflict!.branch, '', status.conflict!.files))}
              >
                Ask the agent to resolve
              </button>
              <button className="rounded-md border border-line px-2 py-0.5 hover:bg-hover" onClick={act('restack', () => window.api.stackRestack(ws.id, false))}>
                Continue restack
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <FeedbackPanel
            layers={withFeedback}
            ws={ws}
            selected={feedback}
            setSelected={setFeedback}
            disabled={agentBusy || !chatId}
            onStart={async (opts) => {
              if (!chatId) return
              s.setActiveChat(ws.id, chatId)
              await run(() => window.api.stackAddressFeedback(ws.id, chatId, opts))
              setFeedback(null)
            }}
          />
        )}

        {[...status.layers].reverse().map((l) => {
          const i = status.layers.indexOf(l)
          const current = l.branch === status.current
          const conflict = status.conflict?.branch === l.branch
          const merge = linked && l.pr?.state === 'OPEN' ? mergeThroughPrs(status.layers, i) : null
          const confirming = confirmMerge === l.branch && merge && 'prs' in merge
          return (
            <div key={l.branch} className="flex gap-2.5">
              <div className="relative w-[18px] shrink-0">
                <span className="absolute top-0 bottom-0 left-[8px] border-l-2 border-line" />
                <span className={`absolute top-[14px] left-[3px] h-3 w-3 rounded-full border-2 ${current ? 'border-accent bg-accent' : conflict ? 'border-del bg-panel' : l.behind && i > 0 ? 'border-amber-400 bg-panel' : 'border-add bg-panel'}`} />
              </div>
              <div className={`mb-2 min-w-0 flex-1 rounded-lg border bg-bg px-2.5 py-2 ${current ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-line'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-faint">{i + 1}</span>
                  <span className="truncate font-semibold">{l.pr?.title ?? l.branch}</span>
                  {l.pr && (
                    <button className="shrink-0 text-faint hover:text-fg" onClick={() => void window.api.openExternal(l.pr!.url)} title="Open on GitHub">
                      #{l.pr.number}
                    </button>
                  )}
                  <span className="ml-auto" />
                  {syncBadge(l, i, current, conflict)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
                  <span className="truncate font-mono text-[11px]">{l.branch}</span>
                  <span>·</span>
                  {checksLine(l)}
                  {l.comments > 0 && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1 text-accent">
                        <IconComment width={11} height={11} />
                        {l.comments} unresolved
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {l.commits} commit{l.commits === 1 ? '' : 's'}
                  </span>
                </div>
                {confirming && (
                  <div className="mt-2 rounded border border-accent/40 bg-accent/5 px-2 py-1.5 text-[12px]">
                    <div className="mb-1.5">
                      Merge {merge.prs.map((n) => `#${n}`).join(', ')} into {base} together? If one can't merge, none do.
                    </div>
                    <div className="flex gap-1.5 text-[11.5px]">
                      <button className="rounded bg-accent px-2 py-0.5 font-semibold text-[#1a1b20] hover:opacity-90" onClick={mergeThrough(l.branch, merge.prs)}>
                        {mergeThroughLabel(merge.prs)}
                      </button>
                      <button className="rounded border border-line px-2 py-0.5 text-muted hover:bg-hover" onClick={() => setConfirmMerge(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {(!current || l.comments > 0 || merge) && !confirming && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                    {!current && (
                      <button disabled={!!status.conflict || !!job} className="rounded border border-line px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40" onClick={() => switchTo(ws, l.branch)}>
                        Work on this PR
                      </button>
                    )}
                    {l.comments > 0 && (
                      <button disabled={!!job || agentBusy} className="rounded border border-accent/50 px-2 py-0.5 text-accent hover:bg-accent/10 disabled:opacity-40" onClick={() => setFeedback([l.branch])}>
                        Address {l.comments}
                      </button>
                    )}
                    {merge && (
                      <button
                        disabled={'why' in merge || !status.ghStackCli || !!busy || !!job || agentBusy || status.dirty || !!status.conflict}
                        className="ml-auto rounded border border-line px-2 py-0.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                        title={'why' in merge ? merge.why : !status.ghStackCli ? 'Install gh-stack first' : `Merge this PR and every PR below it into ${base}, all or none`}
                        onClick={() => setConfirmMerge(l.branch)}
                      >
                        {busy === 'merge' ? 'Merging…' : 'prs' in merge ? mergeThroughLabel(merge.prs) : 'Merge'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-2.5 text-[12px] text-faint">
          <span className="flex w-[18px] justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-faint" />
          </span>
          <span className="font-mono text-[11px]">{base}</span>
          <span>· the base of the stack{status.layers[0]?.behind ? ', has newer commits' : ''}</span>
        </div>
        {status.dirty && <div className="mt-3 text-[12px] text-faint">Uncommitted changes on {status.current}. Commit them before switching PRs or restacking.</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
        {totalComments > 0 && (
          <button
            disabled={!!job || agentBusy}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-semibold text-[#1a1b20] hover:opacity-90 disabled:opacity-40"
            onClick={() => setFeedback(withFeedback.map((l) => l.branch))}
          >
            <IconComment /> Address all feedback ({totalComments})
          </button>
        )}
        <button
          disabled={!!busy || !!job || agentBusy}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
          onClick={act('restack', () => window.api.stackRestack(ws.id, false))}
          title="Rebase each PR onto the latest of the PR below it, then push"
        >
          <IconRestack /> {busy === 'restack' ? 'Restacking…' : 'Restack now'}
        </button>
        <button
          disabled={!!busy || !!job || agentBusy}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
          onClick={act('base', () => window.api.stackRestack(ws.id, true))}
          title={`Fetch ${base}, drop merged PRs from the bottom, and rebase the whole stack onto ${base}`}
        >
          {busy === 'base' ? 'Syncing…' : `Sync with ${base}`}
        </button>
        <button
          disabled={!!busy || !!job}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
          onClick={act('add', () => window.api.stackAddLayer(ws.id))}
        >
          <IconPlus /> Add PR on top
        </button>
      </div>
    </div>
  )
}

function FeedbackPanel(p: {
  ws: Workspace
  layers: StackLayerStatus[]
  selected: string[]
  setSelected: (b: string[] | null) => void
  disabled: boolean
  onStart: (opts: { branches: string[]; askEach: boolean; reply: boolean }) => Promise<void>
}) {
  const [askEach, setAskEach] = useState(false)
  const [reply, setReply] = useState(true)
  const [starting, setStarting] = useState(false)
  const n = p.layers.filter((l) => p.selected.includes(l.branch)).reduce((k, l) => k + l.comments, 0)
  const all = p.ws.stack?.layers.map((l) => l.branch) ?? []
  return (
    <div className="mb-3 rounded-lg border border-accent/40 bg-bg">
      <div className="px-3 pt-2.5 font-semibold">Address feedback</div>
      <div className="px-3 pb-2 text-[12px] text-muted">Each fix is committed to the PR its comments are on, then the PRs above it are restacked.</div>
      {p.layers.map((l) => (
        <label key={l.branch} className="flex cursor-pointer items-center gap-2 border-t border-line px-3 py-1.5">
          <input
            type="checkbox"
            className="accent-[var(--color-accent)]"
            checked={p.selected.includes(l.branch)}
            onChange={(e) => p.setSelected(e.target.checked ? [...p.selected, l.branch] : p.selected.filter((b) => b !== l.branch))}
          />
          <span className="text-faint">{all.indexOf(l.branch) + 1}</span>
          <span className="flex-1 truncate">{l.pr?.title ?? l.branch}</span>
          <Badge tone="acc">
            {l.comments} comment{l.comments === 1 ? '' : 's'}
          </Badge>
        </label>
      ))}
      <div className="space-y-1.5 border-t border-line px-3 py-2 text-[12.5px]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={askEach} onChange={(e) => setAskEach(e.target.checked)} />
          Stop after each PR so I can check the fix
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={reply} onChange={(e) => setReply(e.target.checked)} />
          Reply on GitHub and resolve the threads it fixed
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <button className="rounded-md border border-line px-2.5 py-1 text-muted hover:bg-hover" onClick={() => p.setSelected(null)}>
          Cancel
        </button>
        <button
          disabled={p.disabled || !n || starting}
          className="rounded-md bg-accent px-2.5 py-1 font-semibold text-[#1a1b20] hover:opacity-90 disabled:opacity-40"
          onClick={async () => {
            setStarting(true)
            await p.onStart({ branches: p.selected, askEach, reply })
            setStarting(false)
          }}
        >
          {starting ? 'Starting…' : `Start (${n} comment${n === 1 ? '' : 's'})`}
        </button>
      </div>
    </div>
  )
}
