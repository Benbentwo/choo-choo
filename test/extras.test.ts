import { describe, it, expect } from 'vitest'
import { enabledSubagents, parseAdvice, renderTurn, steerMessage } from '../src/main/extras'
import { DEFAULT_EXTRAS, normalizeExtras, type ChatItem } from '../src/shared/types'

describe('enabledSubagents', () => {
  it('passes nothing when every agent is off', () => {
    expect(enabledSubagents(DEFAULT_EXTRAS)).toBeUndefined()
  })
  it('passes only the agents that are on, under their SDK names', () => {
    const agents = enabledSubagents({ ...DEFAULT_EXTRAS, agents: { ...DEFAULT_EXTRAS.agents, scout: true, securityReviewer: true } })
    expect(Object.keys(agents!)).toEqual(['scout', 'security-reviewer'])
    expect(agents!.scout.tools).not.toContain('Edit')
    expect(agents!.scout.model).toBe('haiku')
  })
})

describe('normalizeExtras', () => {
  it('fills in fields missing from an old save', () => {
    expect(normalizeExtras(undefined)).toEqual(DEFAULT_EXTRAS)
    const e = normalizeExtras({ advisor: true, agents: { scout: true } as never })
    expect(e.advisor).toBe(true)
    expect(e.agents.scout).toBe(true)
    expect(e.agents.reviewer).toBe(false)
    expect(e.advisorModel).toBe('sonnet')
  })
})

describe('parseAdvice', () => {
  it('treats SILENT and empty replies as no advice', () => {
    expect(parseAdvice('SILENT').silent).toBe(true)
    expect(parseAdvice('  silent.\n').silent).toBe(true)
    expect(parseAdvice('').silent).toBe(true)
  })
  it('picks out tagged notes and flags blockers', () => {
    const a = parseAdvice('Looking at it.\n- [note] Rename x\n[blocker] Tests were never run')
    expect(a.silent).toBe(false)
    expect(a.blocker).toBe(true)
    expect(a.notes).toEqual(['[note] Rename x', '[blocker] Tests were never run'])
  })
  it('keeps untagged advice as one non-blocking note', () => {
    const a = parseAdvice('You skipped the null case in parse().')
    expect(a.blocker).toBe(false)
    expect(a.notes).toEqual(['You skipped the null case in parse().'])
  })
  it('builds a follow-up that carries the notes', () => {
    expect(steerMessage(parseAdvice('[blocker] Broken'))).toContain('[blocker] Broken')
  })
})

describe('renderTurn', () => {
  const items: ChatItem[] = [
    { id: '1', kind: 'user', text: 'fix the bug', ts: 0 },
    { id: '2', kind: 'tool', name: 'Bash', input: { command: 'npm test' }, result: 'x'.repeat(5000), ts: 0 },
    { id: '3', kind: 'assistant', text: 'Done, tests pass', ts: 0 },
    { id: '4', kind: 'result', ok: true, ts: 0 }
  ]
  it('includes the ask, tool calls and the answer, and clips long results', () => {
    const t = renderTurn(items)
    expect(t).toContain('USER:\nfix the bug')
    expect(t).toContain('TOOL CALL Bash')
    expect(t).toContain('AGENT:\nDone, tests pass')
    expect(t).toContain('[cut 2500 chars]')
  })
  it('keeps the end of very long turns', () => {
    const t = renderTurn(items, 100)
    expect(t.startsWith('[earlier part of the turn cut]')).toBe(true)
    expect(t).toContain('Done, tests pass')
  })
})
