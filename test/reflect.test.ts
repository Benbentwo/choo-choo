import { describe, it, expect } from 'vitest'
import { condenseTranscript, isReflectTarget, lineDiff, parseReflectResult } from '../src/shared/reflect'

describe('reflect', () => {
  it('only allows agent setup files', () => {
    for (const f of ['CLAUDE.md', 'src/CLAUDE.md', './AGENTS.md', '.claude/rules/testing.md', '.claude/skills/deploy/SKILL.md', '.claude/agents/scout.md', '.claude/commands/ship.md', '.claude/settings.json', '.claude/hooks/format.sh'])
      expect(isReflectTarget(f), f).toBe(true)
    for (const f of ['src/index.ts', 'CLAUDE.local.md', '.claude/settings.local.json', '../CLAUDE.md', 'a/../CLAUDE.md', '.claude/rules/x.txt', 'README.md', ''])
      expect(isReflectTarget(f), f).toBe(false)
  })

  it('parses proposals and drops files it may not touch', () => {
    const text = 'Done.\n```json\n{"summary":"Bumpy.","proposals":[{"file":"./CLAUDE.md","title":"Use pnpm","why":"npm was used twice","content":"# Repo\\nUse pnpm"},{"file":"src/a.ts","content":"x"},{"file":"CLAUDE.md","content":"dupe"},{"file":".claude/rules/t.md"}]}\n```'
    expect(parseReflectResult(text)).toEqual({
      summary: 'Bumpy.',
      proposals: [{ id: '1', file: 'CLAUDE.md', title: 'Use pnpm', why: 'npm was used twice', before: null, after: '# Repo\nUse pnpm\n' }]
    })
    expect(parseReflectResult('no json')).toBeNull()
    expect(parseReflectResult('{"summary":"fine","proposals":[]}')).toEqual({ summary: 'fine', proposals: [] })
  })

  it('diffs lines', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { kind: 'ctx', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'ctx', text: 'c' },
      { kind: 'add', text: 'd' }
    ])
    expect(lineDiff(null, 'x\n')).toEqual([{ kind: 'add', text: 'x' }])
  })

  it('condenses a transcript and keeps the end when too long', () => {
    const items = [
      { id: '1', kind: 'user' as const, text: 'add a test', ts: 1 },
      { id: '2', kind: 'tool' as const, name: 'Bash', input: { command: 'npm test' }, result: 'boom', isError: true, ts: 2 },
      { id: '3', kind: 'assistant' as const, text: 'Fixed.', ts: 3 }
    ]
    const t = condenseTranscript([{ title: 'Chat', items }])
    expect(t).toContain('USER: add a test')
    expect(t).toContain('TOOL Bash: {"command":"npm test"}\n  ERROR: boom')
    expect(t).toContain('ASSISTANT: Fixed.')
    expect(condenseTranscript([{ title: 'Chat', items }], 20)).toMatch(/^\[earlier part of the session cut\]\n.{20}$/s)
    expect(condenseTranscript([{ title: 'Empty', items: [] }])).toBe('')
  })
})
