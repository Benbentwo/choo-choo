import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveId, sortWorkspaces } from '../src/shared/sidebarOrder'
import { namingContext, suggestTitleFromChats } from '../src/main/naming'

// The model's reply, or the error running it throws, for each test.
const sdk = vi.hoisted(() => ({ reply: '', error: null as Error | null }))
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/nonexistent/claude' }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () =>
    (async function* () {
      if (sdk.error) throw sdk.error
      yield { type: 'assistant', message: { content: [{ type: 'text', text: sdk.reply }] } }
    })()
}))
import type { ChatItem } from '../src/shared/types'

const ws = (title: string, createdAt: number, order?: number) => ({ id: title, title, createdAt, order })

describe('sortWorkspaces', () => {
  const list = [ws('b', 1, 1), ws('a', 2, 0), ws('new', 5), ws('newer', 9)]
  it('puts never-placed workspaces on top, newest first, then the dragged order', () => {
    expect(sortWorkspaces(list, 'manual').map((w) => w.title)).toEqual(['newer', 'new', 'a', 'b'])
  })
  it('keeps the other sorts', () => {
    expect(sortWorkspaces(list, 'newest').map((w) => w.title)).toEqual(['newer', 'new', 'a', 'b'])
    expect(sortWorkspaces(list, 'oldest').map((w) => w.title)).toEqual(['b', 'a', 'new', 'newer'])
    expect(sortWorkspaces(list, 'name').map((w) => w.title)).toEqual(['a', 'b', 'new', 'newer'])
  })
})

describe('moveId', () => {
  it('moves before or after the target', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c'])
  })
  it('leaves the list alone for a drop on itself or an id from elsewhere', () => {
    const ids = ['a', 'b']
    expect(moveId(ids, 'a', 'a', true)).toBe(ids)
    expect(moveId(ids, 'x', 'a', true)).toBe(ids)
  })
})

describe('namingContext', () => {
  const items: ChatItem[] = [
    { id: '1', kind: 'user', text: 'Fix the login page', ts: 1 },
    { id: '2', kind: 'tool', name: 'Bash', input: 'ls', ts: 2 },
    { id: '3', kind: 'assistant', text: 'Fixed it.', ts: 3 },
    { id: '4', kind: 'user', text: 'advisor says hi', fromAdvisor: true, ts: 4 }
  ]
  it('keeps the conversation and drops tool calls and advisor messages', () => {
    expect(namingContext([items])).toBe('USER: Fix the login page\nASSISTANT: Fixed it.')
  })
  it('keeps the most recent part when long', () => {
    const long: ChatItem[] = [{ id: '1', kind: 'user', text: 'old '.repeat(100), ts: 1 }, { id: '2', kind: 'user', text: 'recent', ts: 2 }]
    expect(namingContext([long], 20).endsWith('USER: recent')).toBe(true)
  })
})

describe('suggestTitleFromChats', () => {
  const chats: ChatItem[][] = [[{ id: '1', kind: 'user', text: 'Fix the login page', ts: 1 }]]
  beforeEach(() => {
    sdk.reply = ''
    sdk.error = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  it('returns the title from the reply', async () => {
    sdk.reply = 'Sure: {"title":"Fix login page"}'
    await expect(suggestTitleFromChats(chats)).resolves.toBe('Fix login page')
  })
  it('returns null with nothing to go on, without asking the model', async () => {
    sdk.error = new Error('should not run')
    await expect(suggestTitleFromChats([[]])).resolves.toBeNull()
  })
  it('gives the friendly error for an unreadable reply', async () => {
    for (const reply of ['no json here', '{"title":', '{"title":42}', '{"title":"  "}']) {
      sdk.reply = reply
      await expect(suggestTitleFromChats(chats)).rejects.toThrow("Couldn't come up with a name. Try again, or rename it yourself.")
    }
  })
  it('passes through and logs a failure to run the model', async () => {
    sdk.error = new Error('Claude Code process exited with code 1')
    await expect(suggestTitleFromChats(chats)).rejects.toThrow("Couldn't reach Claude to name this workspace: Claude Code process exited with code 1")
    expect(console.error).toHaveBeenCalledWith('[naming] regenerate name failed:', sdk.error)
  })
})
