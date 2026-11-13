import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Chat, ChatItem, Workspace } from '../src/shared/types'
import { descendantsOf, parsePs, killTree, listProcesses } from '../src/main/processTree'
import { stoppedText } from '../src/shared/stop'

const home = mkdtempSync(join(tmpdir(), 'choo-stop-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/nonexistent/claude' }))
vi.mock('../src/main/git', () => ({ snapshot: async () => null }))

/**
 * A stand-in for the Agent SDK's query(), driven by each test: `behave` decides how the fake Claude Code
 * answers an interrupt and an abort, which is where real stops got stuck.
 */
type Behavior = {
  /** What interrupt() does: end the turn with a result (as Claude Code does), or never answer. */
  interrupt: 'result' | 'hang' | 'result-with-queued'
  /** Whether closing the process (abort) ends the stream, or the stream ignores it. */
  abort: 'ends' | 'ignored'
  /** Whether Claude Code exits once its input closes (normal), or hangs on, say a stuck child. */
  exit?: 'on-input-end' | 'hangs'
}
const DEFAULT: Behavior = { interrupt: 'result', abort: 'ends', exit: 'on-input-end' }
let behave: Behavior = { ...DEFAULT }
let interrupts = 0
let lastQuery: { emit(msg: unknown): void } | null = null

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: { abortController: AbortController } }) => {
    const queue: unknown[] = []
    let wake: (() => void) | null = null
    let ended = false
    let failed: Error | null = null
    const emit = (msg: unknown) => {
      queue.push(msg)
      wake?.()
    }
    const end = (err?: Error) => {
      ended = true
      failed = err ?? null
      wake?.()
    }
    void (async () => {
      for await (const _ of prompt);
      if (behave.exit !== 'hangs') end()
    })()
    options.abortController.signal.addEventListener('abort', () => {
      if (behave.abort === 'ends') end(Object.assign(new Error('Claude Code process aborted by user'), { name: 'AbortError' }))
    })
    const q = {
      interrupt: () => {
        interrupts++
        if (behave.interrupt === 'hang') return new Promise(() => {})
        emit({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1', queued_turn_count: behave.interrupt === 'result-with-queued' ? 1 : 0 })
        return Promise.resolve()
      },
      async *[Symbol.asyncIterator]() {
        emit({ type: 'system', subtype: 'init', session_id: 's1' })
        emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'sleep 600' } }] } })
        for (;;) {
          while (queue.length) yield queue.shift()
          if (ended) {
            if (failed) throw failed
            return
          }
          await new Promise<void>((r) => (wake = r))
          wake = null
        }
      }
    }
    lastQuery = { emit }
    return q
  }
}))

const store = await import('../src/main/store')
store.load()
const agent = await import('../src/main/agent')

const ws: Workspace = { id: 'ws1', repoId: 'r1', path: home, branch: 'main', baseRef: 'origin/main', title: 'Sample', status: 'idle' } as unknown as Workspace

function newChat(id: string): Chat {
  const chat = { id, workspaceId: ws.id, title: 'New chat', model: 'opus', status: 'idle', permission: 'full' } as unknown as Chat
  store.get().chats.push(chat)
  return chat
}

/** Starts a turn and waits until the fake Claude Code is working on a tool. */
async function startTurn(chat: Chat) {
  const events: { item?: ChatItem; chat?: Chat; draft?: string }[] = []
  let done = false
  const turn = agent.send(chat, ws, 'Run the slow script', {}, (_id, e) => events.push(e), () => (done = true))
  await vi.waitFor(() => expect(store.chatItems(chat.id).some((x) => x.kind === 'tool')).toBe(true))
  return { events, turn, isDone: () => done }
}

const items = (chat: Chat) => store.chatItems(chat.id)
const marker = (chat: Chat) => items(chat).find((x) => x.kind === 'note' && x.stopped) as Extract<ChatItem, { kind: 'note' }> | undefined

beforeEach(() => {
  interrupts = 0
  behave = { ...DEFAULT }
  agent.stopTimings.interruptMs = 50
  agent.stopTimings.closeMs = 50
  agent.stopTimings.killMs = 50
})

describe('Stop', () => {
  it('interrupts Claude Code, ends the turn and leaves a Stopped marker', async () => {
    const chat = newChat('c-interrupt')
    const t = await startTurn(chat)
    await agent.stop(chat.id)
    await t.turn
    expect(interrupts).toBe(1)
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(chat.status).toBe('idle')
    expect(chat.stopping).toBeUndefined()
    expect(marker(chat)?.text).toBe('Stopped by you')
    // Not "Finished with errors": a stop is not a failure.
    expect(items(chat).some((x) => x.kind === 'result' || x.kind === 'error')).toBe(false)
    // The Bash call it cut off doesn't spin forever.
    expect(items(chat).find((x) => x.id === 'tool-1')).toMatchObject({ result: 'Stopped', isError: true })
    expect(agent.wasStopped(chat.id)).toBe(true)
  })

  it('closes the process when it hangs on after the interrupt', async () => {
    behave.exit = 'hangs'
    const chat = newChat('c-exit-hang')
    const t = await startTurn(chat)
    await agent.stop(chat.id)
    await t.turn
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(marker(chat)?.text).toBe('Stopped by you')
  })

  it('shows Stopping… right away, before Claude Code answers', async () => {
    behave.interrupt = 'hang'
    const chat = newChat('c-feedback')
    const t = await startTurn(chat)
    const stopping = agent.stop(chat.id)
    expect(chat.stopping).toBeTypeOf('number')
    expect(t.events.some((e) => e.chat?.stopping)).toBe(true)
    await stopping
    await t.turn
  })

  it('closes the process when the interrupt never answers', async () => {
    behave.interrupt = 'hang'
    const chat = newChat('c-hang')
    const t = await startTurn(chat)
    await agent.stop(chat.id)
    await t.turn
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(marker(chat)?.text).toBe('Stopped by you')
  })

  it('force stops when neither the interrupt nor closing the process ends the turn', async () => {
    behave = { ...DEFAULT, interrupt: 'hang', abort: 'ignored' }
    const chat = newChat('c-stuck')
    const t = await startTurn(chat)
    await agent.stop(chat.id)
    await t.turn
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(chat.status).toBe('idle')
    expect(marker(chat)?.text).toBe("Stopped by you · Claude didn't respond, so it was force stopped")
  })

  it('pressing Stop again forces it without waiting', async () => {
    behave = { ...DEFAULT, interrupt: 'hang', abort: 'ignored' }
    agent.stopTimings.interruptMs = 60_000
    const chat = newChat('c-again')
    const t = await startTurn(chat)
    void agent.stop(chat.id)
    await agent.stop(chat.id, { force: true })
    await t.turn
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(marker(chat)?.text).toContain('force stopped')
  })

  it("doesn't run a queued message after the stop, and gives it back", async () => {
    behave.interrupt = 'result-with-queued'
    const chat = newChat('c-queued')
    const t = await startTurn(chat)
    expect(agent.pushMessage(chat, 'Also update the docs', [], 'queue', () => {})).toBe(true)
    await agent.stop(chat.id)
    await t.turn
    expect(agent.isRunning(chat.id)).toBe(false)
    expect(items(chat).find((x) => x.kind === 'user' && x.text === 'Also update the docs')).toMatchObject({ unsent: true })
    expect(t.events.find((e) => e.draft)?.draft).toBe('Also update the docs')
    expect(marker(chat)?.text).toBe('Stopped by you · 1 queued message is back in the message box')
    // Nothing more can be pushed into the stopped turn.
    expect(agent.pushMessage(chat, 'more', [], 'steer', () => {})).toBe(false)
  })

  it("isn't picked up by a restart, and doesn't join Up next", async () => {
    behave = { ...DEFAULT, interrupt: 'hang', abort: 'ignored' }
    agent.stopTimings.interruptMs = 60_000
    const chat = newChat('c-restart')
    const other = newChat('c-other')
    const t = await startTurn(chat)
    const o = await startTurn(other)
    // A rate-limit event earlier in the turn would normally queue the chat for after the reset.
    lastQuery!.emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } })
    void agent.stop(chat.id)
    agent.markInterrupted('update')
    expect(chat.interrupted).toBeUndefined()
    expect(other.interrupted).toMatchObject({ reason: 'update' })
    await agent.stop(chat.id, { force: true })
    await t.turn
    expect(chat.paused).toBeUndefined()
    await agent.stop(other.id, { force: true })
    await o.turn
  })

  it("holds back a queued message even when Claude Code doesn't count it", async () => {
    const chat = newChat('c-queued-uncounted')
    const t = await startTurn(chat)
    expect(agent.pushMessage(chat, 'Then add a reset button', [], 'queue', () => {})).toBe(true)
    await agent.stop(chat.id)
    await t.turn
    expect(items(chat).find((x) => x.kind === 'user' && x.text === 'Then add a reset button')).toMatchObject({ unsent: true })
    expect(marker(chat)?.text).toContain('1 queued message is back')
  })

  it('names who stopped it when it was the orchestrator', async () => {
    const chat = newChat('c-orch')
    const t = await startTurn(chat)
    await agent.stop(chat.id, { by: 'the orchestrator' })
    await t.turn
    expect(marker(chat)?.text).toBe('Stopped by the orchestrator')
  })

  it('a new turn clears the stopped state', async () => {
    const chat = newChat('c-again-turn')
    let t = await startTurn(chat)
    await agent.stop(chat.id)
    await t.turn
    expect(agent.wasStopped(chat.id)).toBe(true)
    t = await startTurn(chat)
    expect(agent.wasStopped(chat.id)).toBe(false)
    await agent.stop(chat.id)
    await t.turn
  })
})

describe('the stop marker text', () => {
  it('says who, whether it was forced, and what went back to the message box', () => {
    expect(stoppedText({})).toBe('Stopped by you')
    expect(stoppedText({ unsent: 2 })).toBe('Stopped by you · 2 queued messages are back in the message box')
    expect(stoppedText({ by: 'the orchestrator', forced: true })).toBe("Stopped by the orchestrator · Claude didn't respond, so it was force stopped")
  })
})

describe('process tree', () => {
  it('parses ps and finds every descendant', () => {
    const list = parsePs(['  1     0 /sbin/launchd', ' 10     1 claude --output-format stream-json', ' 11    10 /bin/zsh -c sleep 600', ' 12    11 sleep 600', ' 13     1 other', ' 14    13 child of other'].join('\n'))
    expect(list).toHaveLength(6)
    expect(descendantsOf(list, 10).map((p) => p.pid)).toEqual([11, 12])
    expect(descendantsOf(list, 99)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('kills a process and the shell commands it started', async () => {
    // A parent that ignores SIGTERM with a child that does too, like a stuck tool call.
    const parent = spawn('sh', ['-c', "trap '' TERM; sh -c \"trap '' TERM; sleep 600\" & wait"], { stdio: 'ignore' })
    await vi.waitFor(async () => expect(descendantsOf(await listProcesses(), parent.pid!).length).toBeGreaterThan(0))
    const kids = descendantsOf(await listProcesses(), parent.pid!).map((p) => p.pid)
    expect(await killTree(parent.pid, 'SIGKILL')).toBeGreaterThanOrEqual(2)
    // Gone, or a zombie waiting for its parent to reap it: either way, no longer running.
    const running = (pid: number) => {
      try {
        return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)]).toString().trim().startsWith('Z')
      } catch {
        return false
      }
    }
    await vi.waitFor(() => expect([parent.pid!, ...kids].filter(running)).toEqual([]))
  })
})
