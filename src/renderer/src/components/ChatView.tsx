import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Chat, ChatItem } from '@shared/types'
import { useStore, reportError, removePermission } from '../store'
import { setDraft } from './Composer'
import { IconDown, IconRight, IconTool } from '../icons'

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
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, pendingCount])

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
        {items.map((it) => (
          <Item key={it.id} item={it} chat={chat} children={children.get(it.id)} />
        ))}
        <PermissionCards chat={chat} />
        {chat.status === 'running' && !pendingCount && (
          <div className="mt-3 flex items-center gap-2 text-faint">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-faint border-t-fg" /> Working…
          </div>
        )}
      </div>
    </div>
  )
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
          <div className={`max-w-[85%] rounded-xl bg-raised px-4 py-2.5 whitespace-pre-wrap ${item.fromAdvisor ? 'border border-accent/40' : ''}`}>
            {item.fromAdvisor && <div className="mb-1 text-[11px] text-faint">Sent automatically from the advisor</div>}
            {item.images && item.images.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {item.images.map((src, i) => (
                  <img key={i} src={src} className="max-h-40 max-w-60 rounded-md border border-line object-contain" />
                ))}
              </div>
            )}
            {item.text}
          </div>
        </div>
      )
    case 'note':
      return <div className="my-3 text-center text-[11px] text-faint">{item.text}</div>
    case 'assistant':
      return (
        <div className="prose-chat my-3 leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
        </div>
      )
    case 'tool':
      if (item.name === 'ExitPlanMode') return <PlanItem item={item} chat={chat} />
      if (item.name === 'Agent' || item.name === 'Task') return <SubagentItem item={item} calls={children ?? []} />
      if (item.name === 'Advisor') return <BuiltinAdvisorItem item={item} />
      return <ToolItem item={item} />
    case 'result':
      return (
        <div className="my-3 text-[11px] text-faint">
          {item.ok ? 'Done' : 'Finished with errors'}
          {item.durationMs != null && ` · ${(item.durationMs / 1000).toFixed(0)}s`}
          {item.turns != null && ` · ${item.turns} turns`}
          {item.costUsd != null && ` · $${item.costUsd.toFixed(2)}`}
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

function AdvisorItem({ item, chat }: { item: Extract<ChatItem, { kind: 'advisor' }>; chat: Chat }) {
  if (item.pending) return <div className="my-3 text-[11px] text-faint">Advisor is reviewing this turn…</div>
  if (item.silent) return <div className="my-3 text-[11px] text-faint">Advisor: {item.text}</div>
  const act = (action: 'send' | 'dismiss') => window.api.actOnAdvice(chat.id, item.id, action).catch(reportError)
  return (
    <div className={`my-3 rounded-lg border px-3 py-2 ${item.blocker && !item.resolved ? 'border-del/30 bg-del/10' : 'border-line bg-raised'} ${item.resolved === 'dismissed' ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="font-medium text-muted">Advisor</span>
        {item.blocker && <span className="rounded bg-del/15 px-1 text-del">blocker</span>}
        <span className="flex-1" />
        {item.resolved === 'sent' && <span className="text-faint">Sent to the agent</span>}
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
            title={chat.status === 'running' ? 'Wait for the agent to finish' : 'Ask the agent to address these notes'}
            onClick={() => void act('send')}
          >
            Send to agent
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.result}</ReactMarkdown>
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
        <span className="text-violet-300">Advisor</span>
        <span>{label.replace(/^Advisor /, '')}</span>
      </button>
      {open && <div className="mt-1 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-[12px] whitespace-pre-wrap text-muted">{item.result}</div>}
    </div>
  )
}

function PlanItem({ item, chat }: { item: Extract<ChatItem, { kind: 'tool' }>; chat: Chat }) {
  const plan = String((item.input as { plan?: string })?.plan ?? '')
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
      </div>
      {chat.planMode && chat.status !== 'running' && (
        <div className="flex gap-2 px-4 pb-3">
          <button className="rounded-md bg-fg px-3 py-1 font-medium text-bg hover:opacity-90" onClick={() => void approve()}>
            Approve and build
          </button>
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
