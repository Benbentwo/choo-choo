import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../src/shared/types'
import { describeTool, formatElapsed, isStatusQuestion, isWaitCommand, liveStatus, statusBlock, waitTarget } from '../src/shared/liveStatus'
import { CHECK_IN_COMMAND } from '../src/shared/liveStatus'

type Tool = Extract<ChatItem, { kind: 'tool' }>
const bash = (command: string, extra: Record<string, unknown> = {}, ts = 1000): Tool => ({ id: `t${ts}`, kind: 'tool', name: 'Bash', input: { command, ...extra }, ts })
const user = (ts: number, sentWhileRunning?: 'steer'): ChatItem => ({ id: `u${ts}`, kind: 'user', text: 'go', ts, sentWhileRunning })

describe('wait detection', () => {
  it('spots polling loops and blocking watches', () => {
    expect(isWaitCommand('r=123456; until [ "$(gh run view $r --json status -q .status)" = completed ]; do sleep 30; done')).toBe(true)
    expect(isWaitCommand('while true; do curl -s localhost:3000 && break; sleep 2; done')).toBe(true)
    expect(isWaitCommand('gh run watch 123456')).toBe(true)
    expect(isWaitCommand('gh pr checks 42 --watch')).toBe(true)
    expect(isWaitCommand('sleep 60')).toBe(true)
    expect(isWaitCommand('npm test')).toBe(false)
    expect(isWaitCommand('gh pr view 42')).toBe(false)
  })

  it('names what the loop waits on, through shell variables too', () => {
    expect(waitTarget('r=4393892; until [ "$(gh run view $r -R acme/app --json status)" ]; do sleep 30; done')).toBe('run 4393892')
    expect(waitTarget('gh run watch 77777')).toBe('run 77777')
    expect(waitTarget('gh pr checks 42 --watch')).toBe('PR #42 checks')
    expect(waitTarget('until curl -sf localhost:3000; do sleep 1; done')).toBe('a URL to respond')
    expect(waitTarget('sleep 60')).toBe('')
  })
})

describe('describeTool', () => {
  it('uses the description Claude gave a command', () => {
    expect(describeTool(bash('npm test -- --run', { description: 'Run the unit tests' })).label).toBe('Run the unit tests')
    expect(describeTool(bash('npm test')).label).toBe('Running npm test')
  })
  it('says what a wait is waiting on', () => {
    const d = describeTool(bash('gh run watch 555', { description: 'Watch CI' }))
    expect(d).toMatchObject({ label: 'Waiting on run 555', waiting: true })
    expect(describeTool(bash('until false; do sleep 5; done', { description: 'Wait for deploy' })).label).toBe('Waiting: Wait for deploy')
  })
  it('reads files and MCP tools in plain words', () => {
    expect(describeTool({ id: 'r', kind: 'tool', name: 'Read', input: { file_path: '/repo/src/app.ts' }, ts: 0 }).label).toBe('Reading app.ts')
    expect(describeTool({ id: 'm', kind: 'tool', name: 'mcp__choo__wait_for_workspaces', input: {}, ts: 0 })).toMatchObject({ waiting: true })
    expect(describeTool({ id: 'm', kind: 'tool', name: 'mcp__tracker__list_issues', input: {}, ts: 0 }).label).toBe('Using tracker: list issues')
  })
})

describe('liveStatus', () => {
  it('reports the call still in flight and when it started', () => {
    const items: ChatItem[] = [user(100), { ...bash('ls'), result: 'ok', ts: 200 }, bash('gh run watch 9999', {}, 300)]
    expect(liveStatus(items)).toMatchObject({ label: 'Waiting on run 9999', waiting: true, since: 300, turnSince: 100 })
  })
  it('keeps the turn start across messages steered in mid-turn', () => {
    const items: ChatItem[] = [user(100), bash('sleep 100', {}, 200), user(250, 'steer')]
    expect(liveStatus(items).turnSince).toBe(100)
  })
  it('says Thinking between steps, from the last thing that happened', () => {
    const items: ChatItem[] = [user(100), { ...bash('ls'), result: 'ok', ts: 200 }]
    expect(liveStatus(items)).toMatchObject({ label: 'Thinking', since: 200 })
  })
  it('ignores calls from earlier turns', () => {
    const items: ChatItem[] = [user(10), bash('stale', {}, 20), { id: 'r', kind: 'result', ok: true, ts: 30 }, user(40)]
    expect(liveStatus(items).label).toBe('Thinking')
  })
  it('names a subagent step under its parent', () => {
    const parent: Tool = { id: 'p', kind: 'tool', name: 'Agent', input: { description: 'Audit tests' }, ts: 100 }
    const child: Tool = { id: 'c', kind: 'tool', name: 'Read', input: { file_path: 'a/b.ts' }, parentId: 'p', ts: 200 }
    expect(liveStatus([user(1), parent, child]).label).toBe('Subagent: Audit tests · Reading b.ts')
  })
})

describe('check-in helpers', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(5_000)).toBe('5s')
    expect(formatElapsed(14 * 60_000 + 3000)).toBe('14m')
    expect(formatElapsed(125 * 60_000)).toBe('2h 5m')
    expect(formatElapsed(120 * 60_000)).toBe('2h')
  })
  it('recognises quick status questions, not instructions', () => {
    for (const q of ['How’s this looking?', "how's it going", 'What are you working on?', 'what are we waiting on', 'status?', 'any update?', 'are you stuck?', 'where are we at?'])
      expect(isStatusQuestion(q), q).toBe(true)
    for (const q of ['yeah lets merge it now', 'What are you doing with the auth module? Use the new client instead', 'how should we name this?', 'fix the failing test'])
      expect(isStatusQuestion(q), q).toBe(false)
  })
  it('parses /btw', () => {
    expect('/btw what is left?'.match(CHECK_IN_COMMAND)?.[1]).toBe('what is left?')
    expect('/btw'.match(CHECK_IN_COMMAND)).not.toBeNull()
    expect('/btwx'.match(CHECK_IN_COMMAND)).toBeNull()
  })
  it('gives the check-in model the step, its time and background tasks', () => {
    const block = statusBlock([user(0), bash('gh run watch 1234', {}, 60_000)], [{ id: 'b', description: 'Dev server', status: 'running', startedAt: 0 }], true, 15 * 60_000)
    expect(block).toContain('Current step: Waiting on run 1234 (for 14m), a wait or polling loop')
    expect(block).toContain('This turn has run for 15m.')
    expect(block).toContain('Background task: Dev server')
  })
})
