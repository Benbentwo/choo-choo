import { randomUUID } from 'node:crypto'
import type { Chat, ChatItem, Workspace } from '@shared/types'
import * as store from './store'
import * as pty from './pty'
import * as agent from './agent'
import { claudeCommand, importTurns, shellQuote } from './remote'

/**
 * "Open in Claude desktop": the same handoff as Claude Code's `/desktop` command. Choo Choo runs the
 * official `claude --desktop --resume <session>` in the workspace; Claude Code checks the app is
 * installed and new enough, then opens it on the session (it uses the `claude://resume` link
 * itself). Choo Choo never opens that link or talks to the app on its own (decision 0001).
 *
 * Claude desktop then owns the session, so Choo Choo doesn't run its own agent on it until you bring
 * the chat back, which copies the turns made in the app into the chat.
 */

type Emit = (chatId: string, payload: { item?: ChatItem; chat?: Chat }) => void

/** Typed into the composer, these hand the chat to Claude desktop instead of going to the agent. */
export const DESKTOP_COMMAND = /^\/(desktop|app)\s*$/i

/** Arguments for `claude` that open this chat's session in Claude desktop. */
export function desktopArgs(chat: Pick<Chat, 'sdkSessionId'>): string[] {
  if (!chat.sdkSessionId) throw new Error('Send a message first, so there is a session to open in Claude desktop')
  return ['--desktop', '--resume', chat.sdkSessionId]
}

/** Hidden terminal for the handoff. Starts with the workspace id so archiving kills it. */
export const desktopTerminalId = (chat: Chat) => `${chat.workspaceId}:desktop-${chat.id}`

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g

/** Why the handoff failed, from Claude Code's output, with a hint for the usual causes. */
export function desktopFailure(output: string, platform: string = process.platform): string {
  const lines = output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[exited with code/.test(l))
    .slice(-4)
  const tail = lines.join('\n')
  let hint = ''
  if (/unknown option|unrecognized option/i.test(tail))
    hint = '\n\nThis Claude Code is too old for `--desktop`. Update it, or switch Settings › Claude Code to the bundled one.'
  else if (/not installed|claude\.ai\/download/i.test(tail)) hint = '\n\nInstall Claude desktop from claude.ai/download, then try again.'
  else if (/sign|log ?in|auth/i.test(tail)) hint = '\n\nClaude desktop handoff needs Claude Code signed in with your Claude account. Run `claude` in Terminal and type /login.'
  else if (platform !== 'darwin' && platform !== 'win32') hint = '\n\nClaude desktop runs on macOS and Windows.'
  return `Couldn't open this chat in Claude desktop.${tail ? `\n\n${tail}` : ''}${hint}`
}

function note(chat: Chat, emit: Emit, kind: 'note' | 'error', text: string) {
  const item: ChatItem = { id: randomUUID(), kind, text, ts: Date.now() }
  store.upsertItem(chat.id, item)
  emit(chat.id, { item })
}

/**
 * Hands a chat's session to Claude desktop. Resolves once Claude Code has opened the app (the chat is
 * then marked as in Claude desktop), or rejects with Claude Code's reason.
 */
export function openInDesktop(chat: Chat, ws: Workspace, env: Record<string, string>, emit: Emit): Promise<Chat> {
  if (chat.remote?.kind === 'cloud') return Promise.reject(new Error('This chat runs in the cloud. Bring it back first.'))
  if (chat.remote?.kind === 'phone') return Promise.reject(new Error('This chat is continuing on your phone. Bring it back first.'))
  if (chat.model === 'codex') return Promise.reject(new Error('Claude desktop opens Claude chats, not Codex'))
  if (ws.orchestrator) return Promise.reject(new Error("The orchestrator's tools only run inside Choo Choo, so it can't move to Claude desktop"))
  if (agent.isRunning(chat.id)) return Promise.reject(new Error('Wait for the agent to finish, or stop it, first'))
  if (chat.forkAt !== undefined) return Promise.reject(new Error('You reverted this chat. Send a message here first, then open it in Claude desktop.'))
  let args: string[]
  try {
    args = desktopArgs(chat)
  } catch (e) {
    return Promise.reject(e)
  }
  const command = [claudeCommand(), ...args].map(shellQuote).join(' ')
  const id = desktopTerminalId(chat)
  return new Promise((resolve, reject) => {
    let seen = ''
    let done = false
    // It normally exits within a second or two. If it stops to ask something, give up rather than hang.
    const timer = setTimeout(() => {
      if (done) return
      done = true
      pty.kill(id)
      reject(new Error(desktopFailure(`${seen}\nClaude Code didn't finish opening Claude desktop within 60 seconds.`)))
    }, 60000)
    pty.kill(id)
    pty.create(
      id,
      ws.path,
      // The handoff needs your claude.ai sign-in; an API key would stop it.
      { ...env, ANTHROPIC_API_KEY: '' },
      (_i, d) => {
        seen = (seen + d).slice(-8000)
      },
      (_i, code) => {
        if (done) return
        done = true
        clearTimeout(timer)
        pty.kill(id)
        if (code !== 0) return reject(new Error(desktopFailure(seen)))
        const already = chat.remote?.kind === 'desktop'
        chat.remote = { kind: 'desktop', startedAt: already ? chat.remote!.startedAt : Date.now() }
        store.save()
        if (!already) note(chat, emit, 'note', 'Opened in Claude desktop')
        emit(chat.id, { chat })
        resolve(chat)
      },
      command
    )
  })
}

/** Takes the chat back from Claude desktop and copies the turns made there into the chat. */
export async function bringBackFromDesktop(chat: Chat, ws: Workspace, emit: Emit): Promise<Chat> {
  if (chat.remote?.kind !== 'desktop') return chat
  pty.kill(desktopTerminalId(chat))
  try {
    await importTurns(chat, ws, emit, 'Claude desktop')
  } finally {
    chat.remote = undefined
    store.save()
    emit(chat.id, { chat })
  }
  return chat
}
