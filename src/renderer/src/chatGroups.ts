import type { ChatItem } from '@shared/types'

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** Tool calls that stay in the chat on their own even in the compact format: they ask for a decision or show where work went. */
const PINNED_TOOLS = new Set(['ExitPlanMode', 'mcp__choo__send_to_thread', 'Advisor'])

export type ChatEntry = { kind: 'item'; item: ChatItem } | { kind: 'work'; id: string; items: ChatItem[]; tools: Tool[] }

const isWorkTool = (it: ChatItem): it is Tool => it.kind === 'tool' && !PINNED_TOOLS.has(it.name)

/**
 * The compact chat format: within each stretch of Claude's work (between a person's message, a
 * turn's result, or anything else that isn't Claude's text or a tool call), everything up to and
 * including the last tool call folds into one "work" entry. Claude's text after the last tool call,
 * its answer, stays in the chat.
 */
export function groupWork(items: ChatItem[]): ChatEntry[] {
  const out: ChatEntry[] = []
  let run: ChatItem[] = []
  const flush = () => {
    let last = -1
    for (let i = run.length - 1; i >= 0; i--)
      if (isWorkTool(run[i])) {
        last = i
        break
      }
    if (last >= 0) {
      const work = run.slice(0, last + 1)
      out.push({ kind: 'work', id: work[0].id, items: work, tools: work.filter(isWorkTool) })
    }
    for (const item of run.slice(last + 1)) out.push({ kind: 'item', item })
    run = []
  }
  for (const it of items) {
    if (it.kind === 'assistant' || isWorkTool(it)) run.push(it)
    else {
      flush()
      out.push({ kind: 'item', item: it })
    }
  }
  flush()
  return out
}
