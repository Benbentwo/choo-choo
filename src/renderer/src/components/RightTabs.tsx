import { useEffect, useMemo, useState } from 'react'
import type { Artifact, CheckRun, ReviewFinding, Workspace } from '@shared/types'
import { useStore, openDoc, newChatTab, reportError } from '../store'
import { IconDown, IconRight } from '../icons'
import { REVIEW_PROMPT, useReview } from '../review'

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
  useEffect(() => {
    setRuns(null)
    void load()
    const t = setInterval(() => void load(), 20_000)
    return () => clearInterval(t)
  }, [ws.id])
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
  const repo = useStore((s) => s.repos.find((r) => r.id === ws.repoId))
  const { chat, findings, running } = useReview(ws.id)
  const start = async () => {
    await newChatTab(ws.id)
    const s = useStore.getState()
    const chatId = s.activeChat[ws.id]
    try {
      s.upsertChat(await window.api.updateChat(chatId, { title: 'Review', review: true }))
      await window.api.sendMessage(chatId, REVIEW_PROMPT(repo?.defaultBranch ?? 'main'))
    } catch (e) {
      reportError(e)
    }
  }
  const header = (
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="flex-1 text-muted">
        {running ? 'Reviewing…' : findings ? `${findings.length} finding${findings.length === 1 ? '' : 's'}` : chat ? 'No findings parsed from the last review' : ''}
      </span>
      {chat && (
        <button className="text-[12px] text-muted hover:text-fg" onClick={() => useStore.getState().setActiveChat(ws.id, chat.id)}>
          Open chat
        </button>
      )}
      <button disabled={running} className="rounded-md border border-line px-2 py-0.5 text-[12px] hover:bg-hover disabled:opacity-40" onClick={() => void start()}>
        {chat ? 'Review again' : 'Start review'}
      </button>
    </div>
  )
  if (!chat)
    return (
      <div className="p-6 text-center">
        <div className="mb-3 text-muted">Have an agent review every change on this branch. Findings show here and inline in the diff.</div>
        <button className="rounded-md bg-fg px-3 py-1.5 font-medium text-bg hover:opacity-90" onClick={() => void start()}>
          Start review
        </button>
      </div>
    )
  return (
    <div>
      {header}
      {findings?.length === 0 && <Empty>No issues found</Empty>}
      {findings?.map((f, i) => (
        <div key={i} className="group border-t border-line px-4 py-2">
          <button className="flex w-full items-center gap-2 text-left" onClick={() => openDoc(ws.id, { kind: 'diff', path: f.file })}>
            <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
              {f.file}
              {f.line ? `:${f.line}` : ''}
            </span>
          </button>
          <div className="selectable mt-1">{f.message}</div>
          <button className="mt-1 hidden text-[12px] text-muted group-hover:block hover:text-fg" onClick={() => void sendFix(ws, f)}>
            Ask the agent to fix this
          </button>
        </div>
      ))}
    </div>
  )
}
