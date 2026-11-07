import { describe, it, expect } from 'vitest'
import { connectFailure, findSessionUrl, itemsFromTranscript, phoneArgs, shellQuote } from '../src/main/remote'

const chat = { sdkSessionId: 'abc-123', title: "Fix Ben's bug", model: 'opus' as const, effort: 'high' as const }

describe('continue on phone', () => {
  it('resumes the session with Remote Control in the chat mode', () => {
    expect(phoneArgs({ ...chat, permission: 'full' })).toEqual([
      '--resume', 'abc-123', '--remote-control', "Fix Ben's bug", '--model', 'opus', '--effort', 'high', '--dangerously-skip-permissions'
    ])
    expect(phoneArgs({ ...chat, permission: 'edits' })).toContain('acceptEdits')
    expect(phoneArgs({ ...chat, permission: 'ask' })).not.toContain('--permission-mode')
    expect(phoneArgs({ ...chat, permission: 'auto' }).slice(-2)).toEqual(['--permission-mode', 'auto'])
    expect(phoneArgs({ ...chat, permission: 'full', planMode: true }).slice(-2)).toEqual(['--permission-mode', 'plan'])
    expect(() => phoneArgs({ ...chat, sdkSessionId: undefined })).toThrow(/Send a message first/)
  })

  it('quotes arguments for the shell', () => {
    expect(shellQuote('--resume')).toBe('--resume')
    expect(shellQuote("Fix Ben's bug")).toBe(`'Fix Ben'\\''s bug'`)
    expect(shellQuote('/Applications/Choo Choo.app/claude')).toBe(`'/Applications/Choo Choo.app/claude'`)
  })

  it('finds the session link in terminal output', () => {
    expect(findSessionUrl('\x1b[2mRemote Control: \x1b[36mhttps://claude.ai/code/session_01AbCdEfGh\x1b[0m connected')).toBe('https://claude.ai/code/session_01AbCdEfGh')
    // Hidden behind a terminal hyperlink with a short label.
    expect(findSessionUrl('\x1b]8;;https://claude.ai/code/session_01XyZ12345?from=cli\x07Remote Control\x1b]8;;\x07')).toBe('https://claude.ai/code/session_01XyZ12345?from=cli')
    expect(findSessionUrl('Welcome to Claude Code')).toBeUndefined()
    expect(findSessionUrl('see https://claude.ai/code for sessions')).toBeUndefined()
  })

  it('explains a failed start', () => {
    expect(connectFailure('\x1b[31mRemote Control requires a claude.ai subscription. Please /login\x1b[0m\r\n')).toMatch(/stopped before it connected[\s\S]*\/login/)
  })

  it('turns phone turns into chat items', () => {
    const messages = [
      { type: 'user', uuid: 'u1', message: { content: 'first, from the app' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'done here' }] } },
      { type: 'user', uuid: 'u2', message: { content: 'now from the phone' } },
      { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', uuid: 'u3', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] } },
      { type: 'assistant', uuid: 'a3', message: { content: [{ type: 'text', text: 'sub' }] }, parent_tool_use_id: 't1' },
      { type: 'user', uuid: 'u4', message: { content: '<command-name>/model</command-name>' } },
      { type: 'assistant', uuid: 'a4', message: { content: [{ type: 'text', text: 'finished' }] } }
    ]
    const { items, lastUuid } = itemsFromTranscript(messages, 'a1')
    expect(lastUuid).toBe('a4')
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(items[0]).toMatchObject({ kind: 'user', text: 'now from the phone', resumeAt: 'a1' })
    expect(items[2]).toMatchObject({ kind: 'tool', name: 'Bash', result: 'a\nb', isError: false })
    expect(itemsFromTranscript(messages, 'a4').items).toEqual([])
    expect(itemsFromTranscript(messages, 'gone')).toEqual({ items: [], lastUuid: 'a4' })
  })
})
