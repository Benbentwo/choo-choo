import { describe, it, expect } from 'vitest'
import { codexArgs, codexItem } from '../src/main/codex'

describe('codex', () => {
  it('builds exec args, resuming when there is a thread', () => {
    expect(codexArgs({ cwd: '/w', effort: 'high', imagePaths: [], prompt: 'hi' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', '/w', '-c', 'model_reasoning_effort="high"', 'hi'
    ])
    const a = codexArgs({ cwd: '/w', effort: 'low', readOnly: true, threadId: 't1', imagePaths: ['/i.png'], prompt: 'go' })
    expect(a).toContain('read-only')
    expect(a.slice(-5)).toEqual(['resume', 't1', '-i', '/i.png', 'go'])
  })

  it('maps events to chat items', () => {
    expect(codexItem({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'Done' } }, 1)).toEqual({
      id: 'a', kind: 'assistant', text: 'Done', streaming: false, ts: 1
    })
    expect(codexItem({ type: 'item.started', item: { id: 'c', type: 'command_execution', command: 'ls', aggregated_output: '', status: 'in_progress' } }, 1)).toMatchObject({
      kind: 'tool', name: 'Bash', input: { command: 'ls' }, result: undefined
    })
    expect(codexItem({ type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'ls', aggregated_output: 'x', exit_code: 1, status: 'failed' } }, 1)).toMatchObject({
      result: 'x', isError: true
    })
    expect(codexItem({ type: 'item.completed', item: { id: 'f', type: 'file_change', changes: [{ path: 'a.ts', kind: 'update' }], status: 'completed' } }, 1)).toMatchObject({
      name: 'Edit', input: { file_path: 'a.ts' }, result: 'Applied'
    })
    expect(codexItem({ type: 'turn.failed', error: { message: 'boom' } }, 1)).toMatchObject({ kind: 'error', text: 'boom' })
    expect(codexItem({ type: 'turn.started' })).toBeNull()
  })
})
