import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { needsApproval } = await import('../src/main/agent')

describe('needsApproval', () => {
  it('never asks with full access', () => {
    expect(needsApproval('full', [], 'Bash')).toBe(false)
    expect(needsApproval(undefined, [], 'Write')).toBe(false)
  })
  it('skips read-only tools and always-allowed tools', () => {
    expect(needsApproval('ask', [], 'Read')).toBe(false)
    expect(needsApproval('ask', ['Bash'], 'Bash')).toBe(false)
    expect(needsApproval('ask', [], 'Bash')).toBe(true)
  })
  it('auto-accepts edits but not commands in edits mode', () => {
    expect(needsApproval('edits', [], 'Edit')).toBe(false)
    expect(needsApproval('edits', [], 'Bash')).toBe(true)
    expect(needsApproval('ask', [], 'Edit')).toBe(true)
  })
})
