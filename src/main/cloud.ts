import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, Workspace } from '@shared/types'
import * as store from './store'
import * as pty from './pty'
import * as agent from './agent'
import * as git from './git'
import { shareableItems } from './share'
import { claudeCommand, connectFailure, findSessionUrl, itemsFromTranscript, loadSdk, qrFor, shellQuote } from './remote'

/**
 * "Run in cloud" and "Bring back": moves a workspace's work to a Claude Code cloud session and pulls
 * it back. Choo Choo only runs the official `claude` binary: `claude --cloud "<task>"` to start,
 * `claude -p "<msg>" --cloud <id>` for follow-ups, and `claude --teleport <id>` to bring the session
 * and its branch into the worktree. It never calls claude.ai itself (decision 0001).
 */

type Emit = (chatId: string, payload: { item?: ChatItem; chat?: Chat }) => void
type PtyOut = { onData: (id: string, d: string) => void; onExit: (id: string, code: number) => void; stateChanged: () => void }

export const cloudTerminalId = (chat: Chat) => `${chat.workspaceId}:cloud-${chat.id}`

const PROMPT_LIMIT = 30_000

function short(v: unknown, n: number): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/** The first message of the cloud session: your task, plus the local conversation so far, since a local session can't move to the cloud. */
export function cloudPrompt(task: string, items: ChatItem[], branch: string): string {
  const lines: string[] = []
  for (const it of shareableItems(items)) {
    if (it.kind === 'user') lines.push(`USER: ${it.text}`)
    else if (it.kind === 'assistant') lines.push(`ASSISTANT: ${it.text}`)
    else if (it.kind === 'tool') lines.push(`TOOL ${it.name}(${short(it.input, 200)})${it.isError ? ' failed' : ''}`)
  }
  let body = lines.join('\n\n')
  const room = PROMPT_LIMIT - task.length
  if (body.length > room) body = `[earlier messages trimmed]\n\n${body.slice(Math.max(0, body.length - room))}`
  const parts = [task.trim() || 'Continue the work from the conversation below.']
  if (body) {
    parts.push(
      '',
      `<local-session>`,
      `This work started in a local Claude Code session on branch ${branch}, which is checked out here with its changes committed. Here is that conversation so far.`,
      '',
      body,
      `</local-session>`
    )
  }
  parts.push('', `Keep working on branch ${branch} and push your commits to it.`)
  return parts.join('\n')
}

/** The session id in a claude.ai/code link. */
export function sessionIdFromUrl(url: string): string | undefined {
  return url.match(/claude\.ai\/code\/((?:session|cse)_[A-Za-z0-9]+)/)?.[1]
}

/** Commits everything and pushes the branch, because the cloud session clones from GitHub. */
async function pushWork(ws: Workspace): Promise<boolean> {
  const dirty = (await git.git(ws.path, ['status', '--porcelain'])).trim().length > 0
  if (dirty) {
    await git.git(ws.path, ['add', '-A'])
    await git.git(ws.path, ['commit', '-m', 'Work in progress, moved to a cloud session'])
  }
  await git.git(ws.path, ['push', '-u', 'origin', `HEAD:refs/heads/${ws.branch}`])
  return dirty
}

function put(chat: Chat, emit: Emit, item: ChatItem) {
  store.upsertItem(chat.id, item)
  emit(chat.id, { item })
}

function note(chat: Chat, emit: Emit, text: string, kind: 'note' | 'error' = 'note') {
  put(chat, emit, { id: randomUUID(), kind, text, ts: Date.now() } as ChatItem)
}

function changed(chat: Chat, emit: Emit) {
  store.save()
  emit(chat.id, { chat })
}

/** Starts a cloud session for the workspace. The link arrives on the chat once Claude Code prints it. */
export async function runInCloud(chat: Chat, ws: Workspace, task: string, env: Record<string, string>, emit: Emit, out: PtyOut): Promise<Chat> {
  if (chat.remote)
    throw new Error(
      chat.remote.kind === 'cloud' ? 'This chat already runs in the cloud' : chat.remote.kind === 'desktop' ? 'Bring this chat back from Claude desktop first' : 'Bring this chat back from your phone first'
    )
  if (ws.orchestrator) throw new Error("The orchestrator's tools only run inside Choo Choo, so it can't move to the cloud")
  if (agent.isRunning(chat.id)) throw new Error('Wait for the agent to finish, or stop it, first')
  let committed: boolean
  try {
    committed = await pushWork(ws)
  } catch (e) {
    throw new Error(`Couldn't push ${ws.branch}, which the cloud session needs: ${(e as Error).message}`)
  }
  if (committed) note(chat, emit, 'Committed your uncommitted changes and pushed the branch for the cloud session')
  const prompt = cloudPrompt(task, store.chatItems(chat.id), ws.branch)
  const id = cloudTerminalId(chat)
  const firstLine = (task.trim() || 'Continue the work').split('\n')[0].slice(0, 60)
  chat.remote = { kind: 'cloud', startedAt: Date.now() }
  changed(chat, emit)
  {
    let seen = ''
    let found = false
    pty.kill(id)
    pty.create(
      id,
      ws.path,
      { ...env, ANTHROPIC_API_KEY: '' },
      (i, d) => {
        out.onData(i, d)
        if (found) return
        seen = (seen + d).slice(-8000)
        const url = findSessionUrl(seen)
        const sessionId = url && sessionIdFromUrl(url)
        if (!url || !sessionId || !chat.remote) return
        found = true
        chat.remote.url = url.split('?')[0]
        chat.remote.sessionId = sessionId
        put(chat, emit, { id: randomUUID(), kind: 'user', text: task.trim() || 'Continue the work in the cloud', ts: Date.now() })
        note(chat, emit, 'Moved to a cloud session. It keeps running with your Mac closed.')
        void qrFor(chat.remote.url).then((qr) => {
          if (chat.remote?.kind === 'cloud') chat.remote.qr = qr
          changed(chat, emit)
        })
        // The session lives in the cloud now; the local command has nothing left to do.
        setTimeout(() => pty.kill(id), 3000)
      },
      (i, code) => {
        out.onExit(i, code)
        if (found) return
        chat.remote = undefined
        note(chat, emit, connectFailure(seen).replace('Remote Control stopped before it connected', 'The cloud session didn\'t start'), 'error')
        changed(chat, emit)
      },
      [claudeCommand(), '--cloud', prompt].map(shellQuote).join(' '),
      `\x1b[2m$ claude --cloud ${shellQuote(firstLine + (task.length > 60 ? '…' : ''))}\x1b[0m\r\n`
    )
  }
  return chat
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: { ...process.env, ...env, ANTHROPIC_API_KEY: '' }, maxBuffer: 1 << 20, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err && !stdout) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}

/** Parses `claude -p … --cloud <id> --output-format json`. */
export function parseSendResult(stdout: string): { ok: boolean; error?: string } {
  try {
    const r = JSON.parse(stdout.trim().split('\n').pop() ?? '')
    return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'The cloud session did not take the message' }
  } catch {
    return { ok: false, error: stdout.trim() || 'No answer from claude' }
  }
}

/** Queues a message into the cloud session. Its reply shows on claude.ai/code and in the Claude app. */
export async function sendToCloud(chat: Chat, ws: Workspace, text: string, env: Record<string, string>, emit: Emit) {
  const sessionId = chat.remote?.kind === 'cloud' ? chat.remote.sessionId : undefined
  if (!sessionId) throw new Error('This chat is not in a cloud session')
  if (!text.trim()) return
  const r = parseSendResult(await run(claudeCommand(), ['-p', text, '--cloud', sessionId, '--output-format', 'json'], ws.path, env))
  if (!r.ok) throw new Error(r.error)
  put(chat, emit, { id: randomUUID(), kind: 'user', text, ts: Date.now() })
}

/** Stops tracking the cloud session here. The session keeps running on claude.ai. */
export function forgetCloud(chat: Chat, emit: Emit) {
  if (chat.remote?.kind !== 'cloud') return chat
  pty.kill(cloudTerminalId(chat))
  const url = chat.remote.url
  chat.remote = undefined
  note(chat, emit, `Stopped following the cloud session here${url ? `. It is still at ${url}` : ''}`)
  changed(chat, emit)
  return chat
}

const polls = new Map<string, ReturnType<typeof setInterval>>()

/**
 * Runs `claude --teleport <id>` in the workspace, which checks out the session's branch and copies
 * its conversation into a local session. When that session shows up, Choo Choo takes it over: the
 * chat resumes it from then on, with the cloud turns copied in.
 */
export async function teleportBack(chat: Chat, ws: Workspace, env: Record<string, string>, emit: Emit, out: PtyOut): Promise<Chat> {
  const remote = chat.remote
  if (remote?.kind !== 'cloud' || !remote.sessionId) throw new Error('This chat is not in a cloud session')
  if (remote.teleporting) return chat
  const dirty = (await git.git(ws.path, ['status', '--porcelain'])).trim()
  if (dirty) throw new Error('Commit or stash the changes in this workspace first, so the cloud branch can be checked out')
  const sdk = await loadSdk()
  const before = new Set((await sdk.listSessions({ dir: ws.path }).catch(() => [])).map((s) => s.sessionId))
  const startedAt = Date.now()
  const id = cloudTerminalId(chat)
  remote.teleporting = true
  changed(chat, emit)
  let seen = ''
  let done = false
  let claimed = false

  const takeOver = async (sessionId: string) => {
    if (done) return
    done = true
    clearInterval(polls.get(chat.id))
    polls.delete(chat.id)
    const messages = await sdk.getSessionMessages(sessionId, { dir: ws.path }).catch(() => [])
    const { items, lastUuid } = itemsFromTranscript(messages as never)
    // The cloud session began with our handoff prompt; the chat already shows what came before it.
    const skip = items.findIndex((x) => x.kind === 'assistant')
    for (const item of skip > 0 ? items.slice(skip) : items) put(chat, emit, item)
    chat.sdkSessionId = sessionId
    chat.lastUuid = lastUuid
    chat.forkAt = undefined
    const branch = await git.currentBranch(ws.path)
    if (branch && branch !== ws.branch) ws.branch = branch
    chat.remote = undefined
    note(chat, emit, `Back from the cloud${branch ? ` on ${branch}` : ''}. New messages continue this session here.`)
    changed(chat, emit)
    out.stateChanged()
  }

  pty.kill(id)
  pty.create(
    id,
    ws.path,
    { ...env, ANTHROPIC_API_KEY: '' },
    (i, d) => {
      out.onData(i, d)
      seen = (seen + d).slice(-8000)
    },
    (i, code) => {
      out.onExit(i, code)
      if (done || claimed) return
      void findNew().then((s) => {
        if (s) return takeOver(s)
        clearInterval(polls.get(chat.id))
        polls.delete(chat.id)
        if (chat.remote?.kind === 'cloud') chat.remote.teleporting = undefined
        note(chat, emit, connectFailure(seen).replace('Remote Control stopped before it connected', "Teleport didn't finish"), 'error')
        changed(chat, emit)
      })
    },
    [claudeCommand(), '--teleport', remote.sessionId].map(shellQuote).join(' '),
    `\x1b[2m$ claude --teleport ${remote.sessionId}\x1b[0m\r\n`
  )

  async function findNew(): Promise<string | undefined> {
    const list = await sdk.listSessions({ dir: ws.path }).catch(() => [])
    return list.find((s) => !before.has(s.sessionId) && s.lastModified >= startedAt - 1000)?.sessionId
  }
  // Teleport stays open as an interactive session once the conversation is in. Take over then.
  polls.set(
    chat.id,
    setInterval(() => {
      void findNew().then((s) => {
        if (!s || claimed) return
        claimed = true
        setTimeout(() => {
          pty.kill(id)
          void takeOver(s)
        }, 2000)
      })
    }, 2000)
  )
  return chat
}

/** After a restart, a teleport in progress is gone. Leave the chat in the cloud so you can try again. */
export function recoverAfterRestart() {
  for (const chat of store.get().chats) if (chat.remote?.kind === 'cloud' && chat.remote.teleporting) chat.remote.teleporting = undefined
  store.save()
}
