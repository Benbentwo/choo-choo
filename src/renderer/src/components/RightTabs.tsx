import { useEffect, useMemo, useState } from 'react'
import type { Artifact, CheckRun, ReviewFinding, Workspace } from '@shared/types'
import { diffBase } from '@shared/stack'
import { useStore, openDoc, newChatTab, reportError, reviewTarget } from '../store'
import { useWorkspaceMode } from '../prReview'
import { ReviewDrafts } from './ReviewDrafts'
import { ReviewFollowUp } from './ReviewFollowUp'
import { IconDown, IconRight } from '../icons'
import { CLAUDE_CODE_REVIEW_PROMPT, REVIEW_PROMPT, SECURITY_REVIEW_PROMPT, useReview } from '../review'

const Empty = ({ children }: { children: React.ReactNode }) => <div className="p-6 text-center text-faint">{children}</div>

export function ArtifactsTab({ ws }: { ws: Workspace }) {
  const stats = useStore((s) => s.stats[ws.id])
  const [items, setItems] = useState<Artifact[] | null>(null)
  useEffect(() => {
    void window.api.getArtifacts(ws.id).then(setItems, () => setItems([]))
  }, [ws.id, stats])
  if (!items) return <Empty>Loading…</Empty>
  if (items.length === 0) return <Empty>Files the agent writes show up here</Empty>
  return (
    <div className="py-1">
      {items.map((a) => (
        <button key={a.path} onClick={() => openDoc(ws.id, { kind: 'file', path: a.path })} className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-hover" title={a.path}>
          <span className="min-w-0 flex-1 truncate">{a.path}</span>
          <span className="text-[11px] text-faint">{a.tool}</span>
          <span className="w-14 text-right text-[11px] text-faint">{new Date(a.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </button>
      ))}
    </div>
  )
}

interface Node {
  name: string
  path: string
  children?: Map<string, Node>
}

export function buildTree(files: string[]): Node {
  const root: Node = { name: '', path: '', children: new Map() }
  for (const f of files) {
    const parts = f.split('/')
    let cur = root
    parts.forEach((p, i) => {
      const leaf = i === parts.length - 1
      let next = cur.children!.get(p)
      if (!next) {
        next = { name: p, path: parts.slice(0, i + 1).join('/'), children: leaf ? undefined : new Map() }
        cur.children!.set(p, next)
      }
      cur = next
    })
  }
  return root
}

function sorted(n: Node): Node[] {
  return [...(n.children?.values() ?? [])].sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : b.children ? 1 : -1))
}

export function FilesTab({ ws, filter }: { ws: Workspace; filter: string }) {
  const stats = useStore((s) => s.stats[ws.id])
  const [files, setFiles] = useState<string[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    void window.api.listFiles(ws.id).then(setFiles, () => setFiles([]))
  }, [ws.id, stats])
  const shown = useMemo(() => (filter ? (files ?? []).filter((f) => f.toLowerCase().includes(filter.toLowerCase())) : (files ?? [])), [files, filter])
  const tree = useMemo(() => buildTree(shown), [shown])
  if (!files) return <Empty>Loading…</Empty>
  if (shown.length === 0) return <Empty>No files</Empty>

  const toggle = (p: string) => {
    const n = new Set(open)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    setOpen(n)
  }
  const render = (n: Node, depth: number): React.ReactNode =>
    sorted(n).map((c) => {
      const isOpen = !!filter || open.has(c.path)
      return (
        <div key={c.path}>
          <button
            onClick={() => (c.children ? toggle(c.path) : openDoc(ws.id, { kind: 'file', path: c.path }))}
            className="flex w-full items-center gap-1 py-[3px] pr-3 text-left hover:bg-hover"
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            {c.children ? isOpen ? <IconDown className="text-faint" /> : <IconRight className="text-faint" /> : <span className="w-[14px]" />}
            <span className={`truncate ${c.children ? '' : 'text-muted'}`}>{c.name}</span>
          </button>
          {c.children && isOpen && render(c, depth + 1)}
        </div>
      )
    })
  return <div className="py-1">{render(tree, 0)}</div>
}

const BUCKET: Record<CheckRun['bucket'], [string, string]> = {
  pass: ['●', 'text-add'],
  fail: ['●', 'text-del'],
  pending: ['◌', 'text-yellow-400'],
  skipping: ['○', 'text-faint'],
  cancel: ['○', 'text-faint']
}

export function ChecksTab({ ws }: { ws: Workspace }) {
  const [runs, setRuns] = useState<CheckRun[] | null>(null)
  const [hasPr, setHasPr] = useState(true)
  const load = async () => {
    const pr = await window.api.getPr(ws.id)
    setHasPr(!!pr)
    setRuns(pr ? await window.api.getChecks(ws.id) : [])
  }
  // Reloads when the PR watcher in the main process sees a change on GitHub.
  const prVersion = useStore((s) => s.prVersion[ws.id] ?? 0)
  useEffect(() => {
    setRuns(null)
  }, [ws.id])
  useEffect(() => {
    void load()
  }, [ws.id, prVersion])
  if (!runs) return <Empty>Loading…</Empty>
  if (!hasPr) return <Empty>Checks appear once this branch has a pull request</Empty>
  if (runs.length === 0) return <Empty>No checks on this pull request</Empty>
  const failed = runs.filter((r) => r.bucket === 'fail').length
  const pending = runs.filter((r) => r.bucket === 'pending').length
  return (
    <div>
      <div className="px-4 py-2 text-muted">
        {failed ? `${failed} failing` : pending ? `${pending} running` : 'All checks passed'}
        <span className="text-faint"> · {runs.length} checks</span>
      </div>
      {runs.map((r) => {
        const [dot, color] = BUCKET[r.bucket] ?? BUCKET.pending
        return (
          <div key={r.name + r.link} className="group flex items-center gap-2 px-4 py-1.5 hover:bg-hover">
            <span className={color}>{dot}</span>
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => void window.api.openExternal(r.link)} title={r.description}>
              {r.workflow ? <span className="text-faint">{r.workflow} / </span> : null}
              {r.name}
            </button>
            {r.bucket === 'fail' && (
              <button
                className="invisible text-[11px] text-muted group-hover:visible hover:text-fg"
                onClick={() => void window.api.rerunCheck(ws.id, r.link).then(load, reportError)}
              >
                Re-run
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export const SEVERITY_STYLE: Record<ReviewFinding['severity'], string> = {
  high: 'text-del',
  medium: 'text-amber-400',
  low: 'text-sky-400'
}

export async function sendFix(ws: Workspace, f: ReviewFinding) {
  const s = useStore.getState()
  const target = s.chats.filter((c) => c.workspaceId === ws.id && !c.review).sort((a, b) => a.createdAt - b.createdAt)[0]
  if (!target) return
  s.setActiveChat(ws.id, target.id)
  const where = f.line ? `${f.file}:${f.line}` : f.file
  try {
    await window.api.sendMessage(target.id, `Fix this review finding in ${where} (${f.severity}): ${f.message}${f.fix ? `\nSuggested fix: ${f.fix}` : ''}`)
  } catch (e) {
    reportError(e)
  }
}

export function ReviewTab({ ws }: { ws: Workspace }) {
  return (
    <div>
      <ReviewFollowUp ws={ws} />
      <ReviewDrafts ws={ws} />
      <AgentReview ws={ws} />
    </div>
  )
}

function AgentReview({ ws }: { ws: Workspace }) {
  const { mode } = useWorkspaceMode(ws)
  const theirs = useStore((s) => !!reviewTarget(s.prReview[ws.id], mode))
  const extras = useStore((s) => s.settings.extras)
  const { chat, code, security, findings, running } = useReview(ws.id)
  const base = diffBase(ws)
  const start = async (kind: 'code' | 'security' | 'claude') => {
    await newChatTab(ws.id)
    const s = useStore.getState()
    const chatId = s.activeChat[ws.id]
    try {
      const title = kind === 'security' ? 'Security review' : kind === 'claude' ? 'Claude Code review' : 'Review'
      s.upsertChat(await window.api.updateChat(chatId, { title, review: true, reviewKind: kind === 'security' ? 'security' : 'code', ...(extras.agents.reviewer && kind === 'code' ? { model: 'opus' } : {}) }))
      await window.api.sendMessage(chatId, kind === 'security' ? SECURITY_REVIEW_PROMPT(base) : kind === 'claude' ? CLAUDE_CODE_REVIEW_PROMPT : REVIEW_PROMPT(base, extras.agents.reviewer))
    } catch (e) {
      reportError(e)
    }
  }
  const btn = 'rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-hover disabled:opacity-40'
  const securityOn = extras.agents.securityReviewer
  const status = (r: ReturnType<typeof useReview>['code'], label: string) =>
    r.running ? `${label}: reviewing…` : r.findings ? `${label}: ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}` : r.chat ? `${label}: no findings parsed` : null
  const header = (
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-muted">{[status(code, 'Code'), securityOn || security.chat ? status(security, 'Security') : null].filter(Boolean).join(' · ')}</span>
      {chat && (
        <button className="text-[12px] text-muted hover:text-fg" onClick={() => useStore.getState().setActiveChat(ws.id, (code.chat ?? chat).id)}>
          Open chat
        </button>
      )}
      <button disabled={code.running} className={btn} onClick={() => void start('code')}>
        {code.chat ? 'Review again' : 'Start review'}
      </button>
      {securityOn && (
        <button disabled={security.running} className={btn} onClick={() => void start('security')}>
          Security review
        </button>
      )}
      <button disabled={code.running} className={btn} title="Run Claude Code's built-in /code-review" onClick={() => void start('claude')}>
        /code-review
      </button>
    </div>
  )
  if (!chat)
    return (
      <div className="p-6 text-center">
        <div className="mb-3 text-muted">Have an agent review every change on this branch. Findings show here and inline in the diff.</div>
        <div className="flex justify-center gap-2">
          <button className="rounded-md bg-fg px-3 py-1.5 font-medium text-bg hover:opacity-90" onClick={() => void start('code')}>
            Start review
          </button>
          {securityOn && (
            <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" onClick={() => void start('security')}>
              Security review
            </button>
          )}
          <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" title="Run Claude Code's built-in /code-review" onClick={() => void start('claude')}>
            Claude Code /code-review
          </button>
        </div>
      </div>
    )
  return (
    <div>
      {header}
      {findings?.length === 0 && !running && <Empty>No issues found</Empty>}
      {findings?.map((f, i) => (
        <div key={i} className="group border-t border-line px-4 py-2">
          <button className="flex w-full items-center gap-2 text-left" onClick={() => openDoc(ws.id, { kind: 'diff', path: f.file })}>
            <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
            {f.source === 'security' && <span className="rounded bg-del/10 px-1 text-[10px] text-del">security</span>}
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
              {f.file}
              {f.line ? `:${f.line}` : ''}
            </span>
          </button>
          <div className="selectable mt-1">{f.message}</div>
          {theirs ? (
            <button className="mt-1 hidden text-[12px] text-muted group-hover:block hover:text-fg" onClick={() => openDoc(ws.id, { kind: 'diff', path: f.file })}>
              Open in the diff to add it to your review
            </button>
          ) : (
            <button className="mt-1 hidden text-[12px] text-muted group-hover:block hover:text-fg" onClick={() => void sendFix(ws, f)}>
              Ask the agent to fix this
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
