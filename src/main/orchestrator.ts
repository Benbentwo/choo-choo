import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { Chat, ChatItem, Repo, Workspace } from '@shared/types'
import * as store from './store'
import * as git from './git'

/**
 * The orchestrator is a chat that lives in the repo's main checkout. The person tells it what
 * they want, and it splits the work across workspaces, each with its own agent, then follows up.
 */

/** What the orchestrator needs from the app. Kept small so this file has no Electron imports. */
export interface Host {
  createWorkspace(repoId: string): Promise<{ workspace: Workspace; chat: Chat }>
  /** Starts a turn in a chat. Throws if the chat is busy. */
  sendToChat(chat: Chat, text: string): void
  stopChat(chatId: string): Promise<void>
  archiveWorkspace(workspaceId: string): Promise<void>
  /** Chats waiting for the person to approve a tool call. */
  pendingChatIds(): Set<string>
}

const MEMORY_ROOT = () => join(homedir(), 'choo-choo', 'memory')
const MEMORY_LIMIT = 20_000
const MAX_WAIT_MIN = 30

export function memoryPath(repo: Repo): string {
  const safe = repo.name.replace(/[^\w.-]/g, '_') || repo.id
  return join(MEMORY_ROOT(), `${safe}.md`)
}

export function readMemory(repo: Repo): string {
  const f = memoryPath(repo)
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}

export function writeMemory(repo: Repo, content: string) {
  mkdirSync(MEMORY_ROOT(), { recursive: true })
  const f = memoryPath(repo)
  writeFileSync(`${f}.tmp`, content)
  renameSync(`${f}.tmp`, f)
}

export function systemPrompt(repo: Repo, memory: string): string {
  return [
    `You are the orchestrator for the ${repo.name} repository in Choo Choo. The person tells you what they want; you get it done by directing other agents.`,
    '',
    'How you work:',
    '- Each workspace is its own git worktree and branch with its own coding agent. Start one per independent piece of work with start_workspace, and give it a complete, self-contained task: the goal, the relevant files, constraints, and what "done" means (for example tests pass and a PR is open).',
    '- Run independent tasks in parallel. Keep dependent work in one workspace, or wait for the first to finish before starting the next.',
    '- After starting work, call wait_for_workspaces, then check results with read_workspace. Send corrections or next steps with message_workspace.',
    '- You run in the main checkout. Never edit files there and never commit, push or switch branches in it. Read code, git log and gh output freely to plan.',
    '- Do not archive a workspace unless the person asks or its work is merged.',
    '- When a workspace needs a tool approval, tell the person; you cannot approve for them.',
    '- Keep replies short: what you started, what finished, what needs the person.',
    '',
    'Memory:',
    '- You have a memory file for this repo that persists across conversations. It is shown below. Save durable facts with update_memory: the person\'s preferences, decisions, conventions, ongoing initiatives and which workspace owns what. Rewrite it whole each time, keep it under ~150 lines, and remove things that are no longer true. Do not save secrets.',
    '',
    `<memory path="${memoryPath(repo)}">`,
    memory.trim() || '(empty)',
    '</memory>'
  ].join('\n')
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] }
}

function lastAssistantText(chatId: string): string {
  const list = store.chatItems(chatId)
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i]
    if (it.kind === 'assistant' && it.text) return it.text
  }
  return ''
}

function workspaceChats(wsId: string): Chat[] {
  return store.get().chats.filter((c) => c.workspaceId === wsId)
}

function statusOf(ws: Workspace, pending: Set<string>): string {
  const chats = workspaceChats(ws.id)
  if (chats.some((c) => pending.has(c.id))) return 'needs-approval'
  if (chats.some((c) => c.status === 'running')) return 'running'
  if (chats.some((c) => c.status === 'error')) return 'error'
  return 'idle'
}

function clip(s: string, n: number) {
  s = s.trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** A compact transcript: the person's and agent's messages, and one line per tool call. */
export function transcript(items: ChatItem[], last: number): string {
  const lines: string[] = []
  for (const it of items.slice(-last)) {
    if (it.kind === 'user') lines.push(`USER: ${clip(it.text, 2000)}`)
    else if (it.kind === 'assistant') lines.push(`AGENT: ${clip(it.text, 4000)}`)
    else if (it.kind === 'tool') lines.push(`TOOL ${it.name}${it.isError ? ' (error)' : ''}: ${clip(JSON.stringify(it.input ?? {}), 200)}`)
    else if (it.kind === 'error') lines.push(`ERROR: ${it.text}`)
    else if (it.kind === 'result') lines.push(`-- turn ${it.ok ? 'finished' : 'failed'} --`)
    else if (it.kind === 'note') lines.push(`NOTE: ${it.text}`)
  }
  return lines.join('\n')
}

function ownWorkspace(repo: Repo, id: string): Workspace {
  const ws = store.get().workspaces.find((w) => w.id === id || w.name === id)
  if (!ws || ws.repoId !== repo.id || ws.orchestrator) throw new Error(`No workspace ${id} in ${repo.name}. Call list_workspaces for ids.`)
  return ws
}

function mainChat(ws: Workspace): Chat {
  const chats = workspaceChats(ws.id)
  const chat = chats.find((c) => !c.review) ?? chats[0]
  if (!chat) throw new Error(`Workspace ${ws.title} has no chat`)
  return chat
}

function summary(ws: Workspace, pending: Set<string>) {
  return {
    id: ws.id,
    title: ws.title,
    branch: ws.branch,
    status: statusOf(ws, pending),
    startedByOrchestrator: !!ws.orchestrated,
    lastMessage: clip(lastAssistantText(mainChat(ws).id), 600)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Options merged into the orchestrator's query(): its tools, its prompt and what it may not do. */
export function queryOptions(sdk: typeof import('@anthropic-ai/claude-agent-sdk'), repo: Repo, host: Host): Record<string, unknown> {
  const { tool, createSdkMcpServer } = sdk
  const live = () => store.get().workspaces.filter((w) => w.repoId === repo.id && !w.archived && !w.orchestrator)

  const tools = [
    tool('list_workspaces', 'List the active workspaces in this repo with their status and the last thing each agent said.', {}, async () => {
      const pending = host.pendingChatIds()
      return text(JSON.stringify(live().map((w) => summary(w, pending)), null, 2))
    }),
    tool(
      'start_workspace',
      'Create a new workspace (worktree, branch and agent) and give its agent a task. Returns right away; the agent works in the background.',
      {
        task: z.string().describe('Complete instructions for the agent. It cannot see this conversation.'),
        model: z.enum(['opus', 'sonnet', 'haiku', 'codex']).optional().describe('Defaults to the person\'s default model.'),
        plan_first: z.boolean().optional().describe('Start in plan mode: the agent proposes a plan and waits instead of editing.')
      },
      async (a) => {
        const { workspace, chat } = await host.createWorkspace(repo.id)
        workspace.orchestrated = true
        if (a.model) chat.model = a.model
        if (a.plan_first) chat.planMode = true
        store.save()
        host.sendToChat(chat, a.task)
        return text(JSON.stringify({ id: workspace.id, name: workspace.name, branch: workspace.branch, status: 'running' }))
      }
    ),
    tool(
      'message_workspace',
      "Send a follow-up message to a workspace's agent. Fails if it is still running; wait for it first.",
      { workspace_id: z.string(), message: z.string() },
      async (a) => {
        const ws = ownWorkspace(repo, a.workspace_id)
        const chat = mainChat(ws)
        if (chat.status === 'running') throw new Error(`${ws.title} is still running. Call wait_for_workspaces first.`)
        host.sendToChat(chat, a.message)
        return text(`Sent to ${ws.title}.`)
      }
    ),
    tool(
      'read_workspace',
      "Read a workspace's recent transcript, its changed files and status.",
      { workspace_id: z.string(), last: z.number().int().min(1).max(200).optional().describe('How many transcript entries, default 40.') },
      async (a) => {
        const ws = ownWorkspace(repo, a.workspace_id)
        const chat = mainChat(ws)
        let changes = ''
        try {
          const files = await git.changes(ws.path, ws.baseRef)
          const s = git.summarize(files)
          changes = `${s.files} files, +${s.additions} -${s.deletions}\n${files.map((f) => `${f.status} ${f.path} +${f.additions} -${f.deletions}`).join('\n')}`
        } catch (e) {
          changes = `(could not read changes: ${(e as Error).message})`
        }
        const pending = host.pendingChatIds()
        return text(
          [
            `# ${ws.title} (${ws.branch}) status: ${statusOf(ws, pending)}`,
            `Path: ${ws.path}`,
            '',
            '## Changes vs base',
            changes || 'none',
            '',
            '## Transcript',
            transcript(store.chatItems(chat.id), a.last ?? 40)
          ].join('\n')
        )
      }
    ),
    tool(
      'wait_for_workspaces',
      'Wait until the given workspaces stop running (or need the person to approve something), then return their status and last messages.',
      {
        workspace_ids: z.array(z.string()).min(1),
        timeout_minutes: z.number().min(1).max(MAX_WAIT_MIN).optional().describe(`Default 10, at most ${MAX_WAIT_MIN}.`)
      },
      async (a, extra) => {
        const wss = a.workspace_ids.map((id) => ownWorkspace(repo, id))
        const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
        const deadline = Date.now() + (a.timeout_minutes ?? 10) * 60_000
        // Give freshly started agents a moment to flip to running.
        await sleep(1500)
        while (Date.now() < deadline && !signal?.aborted) {
          const pending = host.pendingChatIds()
          if (wss.every((w) => statusOf(w, pending) !== 'running')) break
          await sleep(2000)
        }
        const pending = host.pendingChatIds()
        const out = wss.map((w) => summary(w, pending))
        const still = out.filter((o) => o.status === 'running').length
        return text((still ? `Timed out with ${still} still running.\n` : '') + JSON.stringify(out, null, 2))
      }
    ),
    tool('stop_workspace', "Stop a workspace's running agent.", { workspace_id: z.string() }, async (a) => {
      const ws = ownWorkspace(repo, a.workspace_id)
      for (const c of workspaceChats(ws.id)) await host.stopChat(c.id)
      return text(`Stopped ${ws.title}.`)
    }),
    tool(
      'archive_workspace',
      'Archive a workspace: removes its worktree but keeps the branch, so it can be restored. Only when the person asks or the work is merged.',
      { workspace_id: z.string() },
      async (a) => {
        const ws = ownWorkspace(repo, a.workspace_id)
        await host.archiveWorkspace(ws.id)
        return text(`Archived ${ws.title}.`)
      }
    ),
    tool(
      'update_memory',
      "Replace this repo's memory file with new content. It is shown to you at the start of every turn.",
      { content: z.string().max(MEMORY_LIMIT) },
      async (a) => {
        writeMemory(repo, a.content)
        return text(`Saved memory (${a.content.length} characters).`)
      }
    )
  ]

  return {
    mcpServers: {
      choo: createSdkMcpServer({ name: 'choo', version: '1.0.0', tools, alwaysLoad: true, timeout: (MAX_WAIT_MIN + 2) * 60_000 })
    },
    // Memory can change between turns, so render the prompt fresh each time.
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt(repo, readMemory(repo)), snapshot: false },
    disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
  }
}

/** Tools that only read, so they never need the person's OK. */
export const READ_ONLY = ['list_workspaces', 'read_workspace', 'wait_for_workspaces'].map((t) => `mcp__choo__${t}`)
