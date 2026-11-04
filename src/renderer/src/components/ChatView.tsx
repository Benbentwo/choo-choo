import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Chat, ChatItem } from '@shared/types'
import { useStore, reportError } from '../store'
import { setDraft } from './Composer'
import { IconDown, IconRight, IconTool } from '../icons'

export function ChatView({ chat }: { chat: Chat }) {
  const items = useStore((s) => s.items[chat.id]) ?? []
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

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
          <Item key={it.id} item={it} chat={chat} />
        ))}
        {chat.status === 'running' && (
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

function Item({ item, chat }: { item: ChatItem; chat: Chat }) {
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
          <div className="max-w-[85%] rounded-xl bg-raised px-4 py-2.5 whitespace-pre-wrap">{item.text}</div>
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
      return <ToolItem item={item} />
    case 'result':
      return (
        <div className="my-3 text-[11px] text-faint">
          {item.ok ? 'Done' : 'Finished with errors'}
          {item.durationMs != null && ` · ${(item.durationMs / 1000).toFixed(0)}s`}
          {item.turns != null && ` · ${item.turns} turns`}
          {item.costUsd != null && ` · $${item.costUsd.toFixed(2)}`}
        </div>
      )
    case 'error':
      return <div className="my-3 rounded-lg border border-del/30 bg-del/10 px-3 py-2 text-del">{item.text}</div>
  }
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
