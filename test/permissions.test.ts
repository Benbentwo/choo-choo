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

const { authHint } = await import('../src/main/agent')
const { installedExecutable } = await import('../src/main/claudeBinary')

describe('authHint', () => {
  it('explains how to sign in when Claude Code is logged out', () => {
    expect(authHint('Not logged in · Please run /login')).toContain('/login')
    expect(authHint('Invalid API key · Fix external API key')).toContain('API key')
    expect(authHint('Something else broke')).toBeNull()
    expect(authHint(undefined)).toBeNull()
  })
})

describe('installedExecutable', () => {
  it('finds claude on PATH', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(join(tmpdir(), 'cc-'))
    writeFileSync(join(dir, 'claude'), '')
    expect(installedExecutable(dir, dir)).toBe(join(dir, 'claude'))
  })
})
