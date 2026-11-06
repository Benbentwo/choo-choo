import { describe, it, expect } from 'vitest'
import { cloudPrompt, parseSendResult, sessionIdFromUrl } from '../src/main/cloud'
import type { ChatItem } from '../src/shared/types'

describe('run in cloud', () => {
  it('hands the conversation to the cloud session', () => {
    const items: ChatItem[] = [
      { id: '1', kind: 'user', text: 'add a login page', ts: 0 },
      { id: '2', kind: 'tool', name: 'Bash', input: { command: 'echo sk-ant-api03-abcdefghijklmnopqrstuv' }, ts: 0 },
      { id: '3', kind: 'assistant', text: 'Started the form', ts: 0 }
    ]
    const p = cloudPrompt('Finish the tests', items, 'ben/login')
    expect(p.startsWith('Finish the tests')).toBe(true)
    expect(p).toContain('USER: add a login page')
    expect(p).toContain('ASSISTANT: Started the form')
    expect(p).toContain('branch ben/login')
    expect(p).not.toContain('sk-ant-api03')
    expect(cloudPrompt('', [], 'x')).toMatch(/^Continue the work/)
    expect(cloudPrompt('t', [{ id: '1', kind: 'assistant', text: 'y'.repeat(50_000), ts: 0 }], 'b').length).toBeLessThan(31_000)
  })

  it('reads the session id from its link', () => {
    expect(sessionIdFromUrl('https://claude.ai/code/session_01DiUkqY2kzbUbDmW1w96rfi?from=cli&m=0')).toBe('session_01DiUkqY2kzbUbDmW1w96rfi')
    expect(sessionIdFromUrl('https://claude.ai/code')).toBeUndefined()
  })

  it('parses the follow-up result', () => {
    expect(parseSendResult('{"ok":true,"session_id":"session_1","url":"u"}\n')).toEqual({ ok: true })
    expect(parseSendResult('{"ok":false,"session_id":"s","error":"archived"}')).toEqual({ ok: false, error: 'archived' })
    expect(parseSendResult('Error: nope').ok).toBe(false)
  })
})
