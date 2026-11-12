import { useEffect, useMemo, useRef, useState } from 'react'
import { PausedBanner } from './ContinueWork'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Chat, ChatItem, ReviewFinding } from '@shared/types'
import { useStore, reportError, removePermission, openDoc, modelLabel } from '../store'
import { splitFindingsBlock } from '../review'
import { SEVERITY_STYLE, sendFix } from './RightTabs'
import { setDraft } from './Composer'
import { splitFences, tidyMarkdown } from '../markdown'
import { MARKDOWN_COMPONENTS } from './CodeBlock'
import { API_PRICE_NOTE } from './UsageGraphs'
import { IconDown, IconRight, IconTool } from '../icons'
import { RouteItem } from './Projects'
import { parseAutoUpdate, stripRouted, type AutoUpdateEntry } from '@shared/projects'
import { stripRunMarker } from '@shared/automations'
import { groupWork, type ChatEntry } from '../chatGroups'

export function ChatView({ chat }: { chat: Chat }) {
  const all = useStore((s) => s.items[chat.id])
  // Calls a subagent made are shown inside the card of the Agent call that started it.
  const { items, children } = useMemo(() => {
    const children = new Map<string, Extract<ChatItem, { kind: 'tool' }>[]>()
    const items: ChatItem[] = []
    for (const it of all ?? []) {
      if (it.kind === 'tool' && it.parentId) children.set(it.parentId, [...(children.get(it.parentId) ?? []), it])
      else items.push(it)
    }
    return { items, children }
  }, [all])
  const pendingCount = useStore((s) => s.permissions[chat.id]?.length ?? 0)
  const compact = useStore((s) => s.settings.chatFormat === 'compact')
  // /clear empties Claude's context, so everything before the latest one folds away behind a divider.
  const [showEarlier, setShowEarlier] = useState(false)
  const clearAt = useMemo(() => lastClear(items), [items])
  useEffect(() => setShowEarlier(false), [chat.id, clearAt])
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, pendingCount])

  const current = useMemo(
    () => items.slice(clearAt >= 0 ? clearAt + 1 : 0).filter((it, i) => !(clearAt >= 0 && i === 0 && it.kind === 'result' && !it.turns)),
    [items, clearAt]
  )
  const currentEntries = useMemo(() => (compact ? groupWork(current) : null), [compact, current])
  const running = chat.status === 'running'
  // The last Working row shows its own spinner, so the one under the chat would repeat it.
  const endsInLiveWork = running && currentEntries?.at(-1)?.kind === 'work'
  const renderItems = (list: ChatItem[]) => {
    const entries: ChatEntry[] | null = list === current ? currentEntries : compact ? groupWork(list) : null
    if (!entries) return list.map((it) => <Item key={it.id} item={it} chat={chat} children={children.get(it.id)} />)
    return entries.map((e, i) =>
      e.kind === 'item' ? (
        <Item key={e.item.id} item={e.item} chat={chat} children={children.get(e.item.id)} />
      ) : (
        <WorkGroup key={e.id} entry={e} chat={chat} children={children} live={running && list === current && i === entries.length - 1} />
      )
    )
  }

  return (
    <div
      ref={ref}
      className="selectable flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      <div className="mx-auto max-w-3xl px-8 py-6">
        {items.length === 0 && (
          <div className="pt-24 text-center text-faint">
            <div className="mb-1 text-[15px] text-muted">What should we build?</div>
            <div>The agent works in this workspace's own worktree and branch.</div>
          </div>
        )}
        {clearAt >= 0 && (
          <>
            {showEarlier && renderItems(items.slice(0, clearAt))}
            <div className="my-4 flex items-center gap-3 text-[11px] text-faint">
              <div className="h-px flex-1 bg-line" />
              <span>Context cleared</span>
              {clearAt > 0 && (
                <button className="hover:text-fg hover:underline" onClick={() => setShowEarlier(!showEarlier)}>
                  {showEarlier ? 'Hide earlier messages' : `Show ${clearAt} earlier message${clearAt === 1 ? '' : 's'}`}
                </button>
              )}
              <div className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        {renderItems(current)}
        <PausedBanner chat={chat} />
        <PermissionCards chat={chat} />
        {chat.status === 'running' && !pendingCount && !endsInLiveWork && (
          <div className="mt-3 flex items-center gap-2 text-faint">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-fg" /> Working…
          </div>
        )}
      </div>
    </div>
  )
}

/** Index of the latest /clear the person sent, or -1. */
function lastClear(items: ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'user' && it.text.trim() === '/clear') return i
  }
  return -1
}

async function revert(chat: Chat, itemId: string) {
  try {
    const text = await window.api.revertTo(chat.id, itemId)
    useStore.getState().setItems(chat.id, await window.api.getChatItems(chat.id))
    setDraft(chat.id, text)
  } catch (e) {
    reportError(e)
  }
}

/** Claude's text. A review's closing findings block shows as tiles that open the code, not as raw JSON. */
function AssistantText({ text, chat }: { text: string; chat: Chat }) {
  const split = useMemo(() => splitFindingsBlock(text), [text])
  const md = (t: string) => t && <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{tidyMarkdown(t)}</ReactMarkdown>
  if (!split) return <div className="prose-chat my-3 leading-relaxed">{md(text)}</div>
  return (
    <div className="my-3">
      <div className="prose-chat leading-relaxed">{md(split.before)}</div>
      <FindingTiles findings={split.findings} chat={chat} />
      <div className="prose-chat leading-relaxed">{md(split.after)}</div>
    </div>
  )
}

function FindingTiles({ findings, chat }: { findings: ReviewFinding[]; chat: Chat }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === chat.workspaceId))
  if (!findings.length) return <div className="my-2 rounded-lg border border-line px-3 py-2 text-muted">No issues found</div>
  return (
    <div className="my-2 flex flex-col gap-1.5">
      {findings.map((f, i) => (
        <div key={i} className="rounded-lg border border-line bg-panel hover:border-faint">
          <button
            className="block w-full px-3 py-2 text-left"
            title="Open this line in the diff"
            onClick={() => openDoc(chat.workspaceId, { kind: 'diff', path: f.file, line: f.line })}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-medium uppercase ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted">
                {f.file}
                {f.line ? `:${f.line}` : ''}
              </span>
            </div>
            <div className="mt-1">{f.message}</div>
            {f.fix && <div className="mt-1 text-muted">{f.fix}</div>}
          </button>
          {ws && (
            <button className="block px-3 pb-2 text-[12px] text-muted hover:text-fg" onClick={() => void sendFix(ws, f)}>
              Ask the agent to fix this
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function Item({ item, chat, children }: { item: ChatItem; chat: Chat; children?: Extract<ChatItem, { kind: 'tool' }>[] }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="group my-4 flex items-start justify-end gap-2">
          {item.checkpoint && chat.status !== 'running' && (
            <button
              className="invisible mt-2 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-faint group-hover:visible hover:bg-hover hover:text-fg"
              title="Restore files and conversation to before this message"
              onClick={() => void revert(chat, item.id)}
            >
              Revert to here
            </button>
          )}
          {parseAutoUpdate(item.text) ? (
            <AutoUpdateItem entries={parseAutoUpdate(item.text)!} text={item.text} />
          ) : buttonAction(item.text) ? (
            <ActionItem label={buttonAction(item.text)!} text={item.text} />
          ) : (
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 whitespace-pre-wrap ${item.fromAdvisor ? 'border border-advisor/40 bg-advisor/10' : 'bg-raised'}`}
            >
              {item.fromAdvisor && <div className="mb-1 text-[11px] font-medium text-advisor">From the advisor</div>}
              {stripRouted(item.text).routed && <div className="mb-1 text-[11px] text-faint">Sent here from the orchestrator chat</div>}
              {stripRunMarker(item.text).reason && <div className="mb-1 text-[11px] text-faint">Automation run · {stripRunMarker(item.text).reason}</div>}
              {item.sentWhileRunning && (
                <div className="mb-1 text-[11px] text-faint">{item.sentWhileRunning === 'steer' ? 'Sent while Claude was working · steered in' : 'Sent while Claude was working · queued'}</div>
              )}
              {item.images && item.images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {item.images.map((src, i) => (
                    <img key={i} src={src} className="max-h-40 max-w-60 rounded-md border border-line object-contain" />
                  ))}
                </div>
              )}
              {splitFences(stripRunMarker(stripRouted(item.text).text).text).map((part, i) =>
                part.code ? (
                  <pre key={i} className="my-1.5 overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre" title={part.lang}>
                    {part.text}
                  </pre>
                ) : (
                  <div key={i}>{part.text}</div>
                )
              )}
            </div>
          )}
        </div>
      )
    case 'note':
      return <div className="my-3 text-center text-[11px] text-faint">{item.text}</div>
    case 'model':
      return <ModelSwitch item={item} />
    case 'assistant':
      return <AssistantText text={item.text} chat={chat} />
    case 'tool':
      if (item.name === 'ExitPlanMode') return <PlanItem item={item} chat={chat} />
      if (item.name === 'Agent' || item.name === 'Task') return <SubagentItem item={item} calls={children ?? []} />
      if (item.name === 'Advisor') return <BuiltinAdvisorItem item={item} />
      if (item.name === 'mcp__choo__send_to_thread') return <RouteItem input={item.input} result={item.result} wsId={chat.workspaceId} />
      return <ToolItem item={item} />
    case 'result':
      return (
        <div className="my-3 text-[11px] text-faint">
          {item.ok ? 'Done' : 'Finished with errors'}
          {item.durationMs != null && ` · ${(item.durationMs / 1000).toFixed(0)}s`}
          {item.turns != null && ` · ${item.turns} turns`}
          {item.costUsd != null && <span title={API_PRICE_NOTE}>{` · $${item.costUsd.toFixed(2)} at API prices`}</span>}
          {chat.model !== 'codex' && (
            <>
              {' · '}
              <button className="underline-offset-2 hover:text-fg hover:underline" onClick={() => useStore.getState().set({ modal: 'usage', usageChat: chat.id })}>
                Usage
              </button>
            </>
          )}
        </div>
      )
    case 'error':
      return <div className="my-3 rounded-lg border border-del/30 bg-del/10 px-3 py-2 text-del">{item.text}</div>
    case 'advisor':
      return <AdvisorItem item={item} chat={chat} />
  }
}

/** A rule across the chat where the model changed; shows the model Claude Code confirmed once the next turn starts. */
function ModelSwitch({ item }: { item: Extract<ChatItem, { kind: 'model' }> }) {
  const details = useStore((s) => s.modelDetails)
  return (
    <div
      className="my-4 flex items-center gap-3 text-[11px] text-faint"
      title={item.resolved ? `Claude Code confirmed ${item.resolved}` : 'Takes effect with your next message'}
      data-testid="model-switch"
    >
      <div className="h-px flex-1 bg-line" />
      <span>
        Switched to model {modelLabel(item.model, details)}
        {item.resolved && <span className="font-mono"> · {item.resolved}</span>}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

function AdvisorItem({ item, chat }: { item: Extract<ChatItem, { kind: 'advisor' }>; chat: Chat }) {
  const plan = item.source === 'planReview'
  const who = plan ? 'Plan review' : 'Advisor'
  if (item.pending)
    return <div className="my-3 text-[11px] text-faint">{plan ? 'Fresh reviewers who haven’t seen this chat are reading the plan…' : 'Advisor is reviewing this turn…'}</div>
  if (item.silent)
    return (
      <div className="my-3 text-[11px] text-faint">
        <span className={plan ? '' : 'text-advisor'}>{who}</span>: {item.text}
      </div>
    )
  // Sent notes appear in full in the message that follows, so the card folds to one line instead of showing them twice.
  if (item.resolved === 'sent') {
    const notes = item.text.split('\n').filter((l) => l.trim()).length
    return (
      <div className="my-3 text-[11px] text-faint">
        <span className={plan ? '' : 'text-advisor'}>{who}</span>: {notes} note{notes === 1 ? '' : 's'}
        {item.blocker ? ', with a blocker,' : ''} sent to the agent
      </div>
    )
  }
  const act = (action: 'send' | 'dismiss') => window.api.actOnAdvice(chat.id, item.id, action).catch(reportError)
  return (
    <div
      className={`my-3 rounded-lg border px-3 py-2 ${item.blocker && !item.resolved ? 'border-del/30 bg-del/10' : plan ? 'border-line bg-raised' : 'border-advisor/30 bg-advisor/5'} ${item.resolved === 'dismissed' ? 'opacity-60' : ''}`}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className={`font-medium ${plan ? 'text-muted' : 'text-advisor'}`}>{who}</span>
        {plan && <span className="text-faint">from reviewers who only saw the plan</span>}
        {item.blocker && <span className="rounded bg-del/15 px-1 text-del">blocker</span>}
        <span className="flex-1" />
        {item.resolved === 'dismissed' && <span className="text-faint">Dismissed</span>}
      </div>
      <div className="space-y-1 text-[13px] whitespace-pre-wrap">
        {item.text.split('\n').map((line, i) => (
          <div key={i}>{line.replace(/^\[(blocker|note)\]\s*/i, '')}</div>
        ))}
      </div>
      {!item.resolved && (
        <div className="mt-2 flex gap-2">
          <button
            className="rounded-md bg-fg px-2.5 py-0.5 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
            disabled={chat.status === 'running'}
            title={chat.status === 'running' ? 'Wait for the agent to finish' : plan ? 'Ask the agent to revise the plan' : 'Ask the agent to address these notes'}
            onClick={() => void act('send')}
          >
            {plan ? 'Revise the plan' : 'Send to agent'}
          </button>
          <button className="rounded-md border border-line px-2.5 py-0.5 text-[12px] hover:bg-hover" onClick={() => void act('dismiss')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function SubagentItem({ item, calls }: { item: Extract<ChatItem, { kind: 'tool' }>; calls: Extract<ChatItem, { kind: 'tool' }>[] }) {
  const [open, setOpen] = useState(false)
  const input = (item.input ?? {}) as { subagent_type?: string; description?: string }
  const pending = item.result === undefined
  return (
    <div className="my-1.5 rounded-lg border border-line bg-panel">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" onClick={() => setOpen(!open)}>
        {open ? <IconDown className="text-faint" /> : <IconRight className="text-faint" />}
        <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium">{input.subagent_type || 'subagent'}</span>
        <span className="flex-1 truncate text-muted">{input.description ?? ''}</span>
        {calls.length > 0 && <span className="text-[11px] text-faint">{calls.length} step{calls.length === 1 ? '' : 's'}</span>}
        {pending && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-faint border-t-fg" />}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2">
          {calls.map((c) => (
            <ToolItem key={c.id} item={c} />
          ))}
          {item.result !== undefined && (
            <div className={`prose-chat mt-2 text-[13px] ${item.isError ? 'text-del' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{tidyMarkdown(item.result)}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  switch (name) {
    case 'Bash':
      return pick('command')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pick('file_path')
    case 'Glob':
    case 'Grep':
      return pick('pattern')
    case 'WebFetch':
      return pick('url')
    case 'WebSearch':
      return pick('query')
    case 'Task':
    case 'Agent':
      return pick('description')
    case 'TodoWrite':
      return 'Update todos'
    case 'TaskCreate':
      return pick('subject')
    case 'TaskUpdate':
      return [pick('taskId'), pick('status')].filter(Boolean).join(' → ')
    case 'TaskGet':
      return pick('taskId')
    default:
      return ''
  }
}

/**
 * Prompts sent by a button, shown as that button's name instead of the full text. Each pattern
 * matches the first line of the prompt builder named beside it; keep them in step.
 */
const BUTTON_PROMPTS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Create a (draft )?pull request for the work on this branch \(/, (m) => (m[1] ? 'Create draft PR' : 'Create PR')], // prPrompt
  [/^Review the changes on this branch compared to `/, () => 'Review code'], // REVIEW_PROMPT
  [/^Do a security review of the changes on this branch compared to `/, () => 'Security review'], // SECURITY_REVIEW_PROMPT
  [/^These checks are failing on PR #(\d+):/, (m) => `Fix checks on #${m[1]}`], // fixChecksPrompt
  [/^PR #(\d+) has merge conflicts with /, (m) => `Resolve conflicts on #${m[1]}`], // resolveConflictsPrompt
  [/^Address the review feedback on PR #(\d+) \(/, (m) => `Address review comments on #${m[1]}`] // prCommentsPrompt
]

function buttonAction(text: string): string | null {
  for (const [re, label] of BUTTON_PROMPTS) {
    const m = re.exec(text)
    if (m) return label(m)
  }
  return null
}

/** A message a button sent: a compact row like a tool call that expands to the prompt it sent. */
function ActionItem({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="w-[min(85%,420px)] rounded-lg border border-line bg-panel">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" onClick={() => setOpen(!open)} title="Show the prompt this button sent">
        {open ? <IconDown className="text-faint" /> : <IconRight className="text-faint" />}
        <span className="font-medium">{label}</span>
        <span className="flex-1 truncate text-[11px] text-faint">sent from the button</span>
      </button>
      {open && <pre className="max-h-60 overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted">{text}</pre>}
    </div>
  )
}

const AUTO_UPDATE_STATE: Record<AutoUpdateEntry['state'], { label: string; className: string }> = {
  finished: { label: 'finished', className: 'text-faint' },
  error: { label: 'hit an error', className: 'text-del' },
  'needs-approval': { label: 'needs approval', className: 'text-muted' }
}

/**
 * The message Choo Choo sends an orchestrator when workspaces it started finish: a compact card
 * listing them, each opening its workspace, that expands to the prompt the orchestrator got.
 */
function AutoUpdateItem({ entries, text }: { entries: AutoUpdateEntry[]; text: string }) {
  const [open, setOpen] = useState(false)
  const s = useStore()
  return (
    <div className="w-[min(85%,420px)] rounded-lg border border-line bg-panel">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" onClick={() => setOpen(!open)} title="Show the message the orchestrator got">
        {open ? <IconDown className="text-faint" /> : <IconRight className="text-faint" />}
        <span className="font-medium">Automatic update</span>
        <span className="flex-1 truncate text-[11px] text-faint">from Choo Choo</span>
      </button>
      {entries.length > 0 && (
        <ul className="px-3 pb-2 text-[12.5px]">
          {entries.map((e) => {
            const ws = s.workspaces.find((w) => w.id === e.id)
            const st = AUTO_UPDATE_STATE[e.state]
            return (
              <li key={e.id} className="flex items-baseline gap-2 pl-[18px]">
                {ws ? (
                  <button className="truncate text-left hover:underline" title="Open this workspace" onClick={() => s.selectWorkspace(ws.id)}>
                    {ws.title || e.title}
                  </button>
                ) : (
                  <span className="truncate">{e.title}</span>
                )}
                <span className={`shrink-0 text-[11px] ${st.className}`}>{st.label}</span>
              </li>
            )
          })}
        </ul>
      )}
      {open && <pre className="max-h-60 overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted">{text}</pre>}
    </div>
  )
}

/** The compact format's single row for a stretch of Claude's work: its tool calls and in-between notes, collapsed until opened. */
function WorkGroup({
  entry,
  chat,
  children,
  live
}: {
  entry: Extract<ChatEntry, { kind: 'work' }>
  chat: Chat
  children: Map<string, Extract<ChatItem, { kind: 'tool' }>[]>
  live: boolean
}) {
  const [open, setOpen] = useState(false)
  const { tools } = entry
  const failed = tools.filter((t) => t.isError).length
  const latest = tools[tools.length - 1]
  // A call left without a result by a stopped turn shouldn't spin forever.
  const working = live || (chat.status === 'running' && tools.some((t) => t.result === undefined))
  return (
    <div className="my-1.5 rounded-lg border border-line bg-panel" data-testid="work-group">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" onClick={() => setOpen(!open)} title={open ? 'Hide the steps' : 'Show the steps'}>
        {open ? <IconDown className="text-faint" /> : <IconRight className="text-faint" />}
        <IconTool className={failed ? 'text-del' : 'text-faint'} />
        <span className="font-medium">{working ? 'Working' : 'Worked'}</span>
        <span className="shrink-0 text-[11px] text-faint">
          {tools.length} tool call{tools.length === 1 ? '' : 's'}
        </span>
        {failed > 0 && <span className="shrink-0 text-[11px] text-del">{failed} failed</span>}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
          {working && !open ? `${latest.name} ${toolSummary(latest.name, latest.input)}`.trim() : ''}
        </span>
        {working && <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-faint border-t-fg" />}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-1">
          {entry.items.map((it) => (
            <Item key={it.id} item={it} chat={chat} children={children.get(it.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolItem({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const summary = toolSummary(item.name, item.input)
  const pending = item.result === undefined
  return (
    <div className="my-1.5 rounded-lg border border-line bg-panel">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]" onClick={() => setOpen(!open)}>
        {open ? <IconDown className="text-faint" /> : <IconRight className="text-faint" />}
        <IconTool className={item.isError ? 'text-del' : 'text-faint'} />
        <span className="font-medium">{item.name}</span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted">{summary}</span>
        {pending && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-faint border-t-fg" />}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2 font-mono text-[11px]">
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-muted">{JSON.stringify(item.input, null, 2)}</pre>
          {item.result !== undefined && (
            <pre className={`mt-2 max-h-80 overflow-auto border-t border-line pt-2 whitespace-pre-wrap ${item.isError ? 'text-del' : 'text-fg/80'}`}>{item.result}</pre>
          )}
        </div>
      )}
    </div>
  )
}

/** A consultation of Claude Code's own advisor tool, mid-turn. */
function BuiltinAdvisorItem({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  if (item.result === undefined) return <div className="my-1.5 text-[11px] text-faint">Advising…</div>
  const label = item.isError ? item.result : 'Advisor reviewed the conversation'
  const hasText = !item.isError && item.result !== 'Reviewed.'
  return (
    <div className="my-1.5 text-[11px]">
      <button className={`flex items-center gap-1 ${item.isError ? 'text-del' : 'text-faint hover:text-fg'}`} onClick={() => hasText && setOpen(!open)} disabled={!hasText}>
        {hasText && (open ? <IconDown /> : <IconRight />)}
        <span className="text-advisor">Advisor</span>
        <span>{label.replace(/^Advisor /, '')}</span>
      </button>
      {open && <div className="mt-1 rounded-md border border-advisor/30 bg-advisor/5 px-3 py-2 text-[12px] whitespace-pre-wrap text-muted">{item.result}</div>}
    </div>
  )
}

function PlanItem({ item, chat }: { item: Extract<ChatItem, { kind: 'tool' }>; chat: Chat }) {
  const plan = String((item.input as { plan?: string })?.plan ?? '')
  const reviews = useStore((s) => s.items[chat.id])?.filter((x) => x.kind === 'advisor' && x.source === 'planReview') ?? []
  const reviewing = reviews.some((x) => x.kind === 'advisor' && x.pending)
  const reviewed = reviews.some((x) => x.kind === 'advisor' && x.planItemId === item.id)
  const review = () => window.api.reviewPlan(chat.id, item.id).catch(reportError)
  const approve = async () => {
    try {
      useStore.getState().upsertChat(await window.api.updateChat(chat.id, { planMode: false }))
      await window.api.sendMessage(chat.id, 'The plan is approved. Go ahead and implement it.')
    } catch (e) {
      reportError(e)
    }
  }
  return (
    <div className="my-3 rounded-xl border border-amber-500/40 bg-amber-500/5">
      <div className="border-b border-amber-500/20 px-4 py-2 text-[12px] font-medium text-amber-400">Plan</div>
      <div className="prose-chat px-4 py-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{tidyMarkdown(plan)}</ReactMarkdown>
      </div>
      {chat.planMode && chat.status !== 'running' && (
        <div className="flex gap-2 px-4 pb-3">
          <button className="rounded-md bg-fg px-3 py-1 font-medium text-bg hover:opacity-90" onClick={() => void approve()}>
            Approve and build
          </button>
          {!reviewed && plan.trim() && (
            <button
              className="rounded-md border border-line px-3 py-1 hover:bg-hover disabled:opacity-40"
              disabled={reviewing}
              title="Fresh reviewers who haven't seen this chat check the plan against the code"
              onClick={() => void review()}
            >
              {reviewing ? 'Reviewing…' : 'Review plan'}
            </button>
          )}
          <span className="self-center text-[12px] text-faint">or reply below to change the plan</span>
        </div>
      )}
    </div>
  )
}

function PermissionCards({ chat }: { chat: Chat }) {
  const reqs = useStore((s) => s.permissions[chat.id]) ?? []
  const answer = (id: string, d: 'allow' | 'always' | 'deny') => {
    window.api.respondPermission(id, d)
    removePermission(id)
  }
  return (
    <>
      {reqs.map((r) => {
        if (r.toolName === 'AskUserQuestion') return <QuestionCard key={r.id} id={r.id} input={r.input} />
        const summary = toolSummary(r.toolName, r.input)
        return (
          <div key={r.id} className="my-3 rounded-xl border border-sky-500/40 bg-sky-500/5">
            <div className="px-4 pt-3 text-[12px] font-medium text-sky-400">Allow {r.toolName}?</div>
            <pre className="mx-4 my-2 max-h-48 overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">
              {summary || JSON.stringify(r.input, null, 2)}
            </pre>
            <div className="flex gap-2 px-4 pb-3">
              <button className="rounded-md bg-fg px-3 py-1 font-medium text-bg hover:opacity-90" onClick={() => answer(r.id, 'allow')}>
                Allow
              </button>
              <button className="rounded-md border border-line px-3 py-1 hover:bg-hover" onClick={() => answer(r.id, 'always')}>
                Always allow {r.toolName}
              </button>
              <button className="rounded-md px-3 py-1 text-del hover:bg-hover" onClick={() => answer(r.id, 'deny')}>
                Deny
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

type Question = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] }

/** The text Claude reads back for one question: picked labels (comma-separated when several), plus any typed answer. */
export function answerText(picked: string[], other: string): string {
  return [...picked, other.trim()].filter(Boolean).join(', ')
}

/** Claude's AskUserQuestion: each question with clickable options, plus a free-text "Other". */
function QuestionCard({ id, input }: { id: string; input: unknown }) {
  const questions = ((input as { questions?: Question[] })?.questions ?? []).filter((q) => q?.question)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<Record<string, string>>({})
  const answers = Object.fromEntries(questions.map((q) => [q.question, answerText(picked[q.question] ?? [], other[q.question] ?? '')]))
  const complete = questions.length > 0 && questions.every((q) => answers[q.question])
  const submit = (a: Record<string, string>) => {
    window.api.respondPermission(id, 'allow', a)
    removePermission(id)
  }
  const dismiss = () => {
    window.api.respondPermission(id, 'deny')
    removePermission(id)
  }
  const pick = (q: Question, label: string) => {
    const cur = picked[q.question] ?? []
    if (q.multiSelect) {
      setPicked({ ...picked, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] })
      return
    }
    // One single-choice question: a click is the answer.
    if (questions.length === 1) return submit({ [q.question]: label })
    setPicked({ ...picked, [q.question]: [label] })
    setOther({ ...other, [q.question]: '' })
  }
  if (!questions.length) {
    return (
      <div className="my-3 rounded-xl border border-accent/40 bg-raised px-4 py-3 text-[12px]">
        Claude asked a question this app couldn't read.{' '}
        <button className="underline hover:text-fg" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    )
  }
  const instant = questions.length === 1 && !questions[0].multiSelect
  return (
    <div className="my-3 rounded-xl border border-accent/40 bg-raised" data-testid="question-card">
      {questions.map((q) => {
        const sel = picked[q.question] ?? []
        const preview = q.options.find((o) => o.label === (focus[q.question] ?? sel[0]))?.preview
        return (
          <div key={q.question} className="border-b border-line px-4 py-3 last:border-b-0">
            {q.header && <div className="mb-1 text-[11px] font-medium tracking-wide text-accent uppercase">{q.header}</div>}
            <div className="mb-2 font-medium">{q.question}</div>
            <div className="flex flex-col gap-1.5">
              {q.options.map((o) => {
                const on = sel.includes(o.label)
                return (
                  <button
                    key={o.label}
                    className={`rounded-lg border px-3 py-2 text-left hover:bg-hover ${on ? 'border-accent bg-accent/10' : 'border-line'}`}
                    onClick={() => pick(q, o.label)}
                    onMouseEnter={() => o.preview && setFocus({ ...focus, [q.question]: o.label })}
                  >
                    <div className="flex items-center gap-2 text-[13px]">
                      {q.multiSelect && <span className={`inline-block h-3 w-3 rounded-sm border ${on ? 'border-accent bg-accent' : 'border-faint'}`} />}
                      <span className="font-medium">{o.label}</span>
                    </div>
                    {o.description && <div className="mt-0.5 text-[12px] text-muted">{o.description}</div>}
                  </button>
                )
              })}
              <input
                className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent"
                placeholder="Other: type your own answer"
                value={other[q.question] ?? ''}
                onChange={(e) => {
                  setOther({ ...other, [q.question]: e.target.value })
                  if (!q.multiSelect && e.target.value) setPicked({ ...picked, [q.question]: [] })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && complete) submit(answers)
                }}
              />
            </div>
            {preview && <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">{preview}</pre>}
          </div>
        )
      })}
      <div className="flex items-center gap-2 px-4 py-3">
        {(!instant || other[questions[0].question]) && (
          <button className="rounded-md bg-fg px-3 py-1 font-medium text-bg hover:opacity-90 disabled:opacity-40" disabled={!complete} onClick={() => submit(answers)}>
            Submit
          </button>
        )}
        <button className="rounded-md px-3 py-1 text-muted hover:bg-hover" onClick={dismiss}>
          Skip
        </button>
        <span className="text-[12px] text-faint">or reply below</span>
      </div>
    </div>
  )
}
