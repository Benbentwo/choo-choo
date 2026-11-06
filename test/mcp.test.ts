import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/main/claudeBinary', () => ({ claudeExecutable: () => '/usr/local/bin/claude' }))
import { mcpAddArgs, mcpRemoveArgs, signInScript, splitCommand, toView } from '../src/main/mcp'

describe('claude mcp add arguments', () => {
  it('builds an HTTP server with headers', () => {
    expect(mcpAddArgs({ name: 'sentry', scope: 'user', transport: 'http', target: 'https://mcp.sentry.dev/mcp', headers: 'X-Api-Key: abc\n' })).toEqual([
      'mcp', 'add', '-s', 'user', '-t', 'http', 'sentry', 'https://mcp.sentry.dev/mcp', '-H', 'X-Api-Key: abc'
    ])
  })
  it('builds a stdio server with env and a quoted argument', () => {
    expect(mcpAddArgs({ name: 'fs', scope: 'project', transport: 'stdio', target: 'npx -y server "My Notes"', env: 'TOKEN=1' })).toEqual([
      'mcp', 'add', '-s', 'project', '-t', 'stdio', 'fs', '-e', 'TOKEN=1', '--', 'npx', '-y', 'server', 'My Notes'
    ])
  })
  it('rejects bad input before calling Claude Code', () => {
    expect(() => mcpAddArgs({ name: 'bad name', scope: 'user', transport: 'http', target: 'https://x' })).toThrow(/name/)
    expect(() => mcpAddArgs({ name: 'x', scope: 'user', transport: 'http', target: 'ftp://x' })).toThrow(/http/)
    expect(() => mcpAddArgs({ name: 'x', scope: 'user', transport: 'stdio', target: 'node s.js', env: 'not a pair' })).toThrow(/KEY=value/)
    expect(() => mcpAddArgs({ name: 'x', scope: 'user', transport: 'http', target: 'https://x', headers: 'nocolon' })).toThrow(/Name: value/)
  })
  it('splits commands on spaces and quotes', () => {
    expect(splitCommand(`node 'a b.js' --x "y z"`)).toEqual(['node', 'a b.js', '--x', 'y z'])
  })
})

describe('claude mcp remove arguments', () => {
  it('removes only config-scoped servers', () => {
    expect(mcpRemoveArgs('fs', 'project')).toEqual(['mcp', 'remove', 'fs', '-s', 'project'])
    expect(() => mcpRemoveArgs('linear', 'claudeai')).toThrow(/Turn it off/)
  })
})

describe('server view', () => {
  it('reads a stdio server and a claude.ai connector', () => {
    const v = toView({ name: 'echo', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'node', args: ['s.js'] }, tools: [{ name: 'echo', description: 'Echo' }] })
    expect(v).toMatchObject({ transport: 'stdio', target: 'node s.js', removable: true, tools: [{ name: 'echo', description: 'Echo' }] })
    expect(toView({ name: 'Linear', status: 'needs-auth', scope: 'claudeai', config: { type: 'claudeai-proxy', url: 'https://mcp.linear.app' } })).toMatchObject({ source: 'claudeai', removable: false, tools: [] })
  })
})

describe('sign-in script', () => {
  it('quotes paths for the shell and for AppleScript', () => {
    const s = signInScript(`/Users/ben/it's "here"`, '/usr/local/bin/claude')
    expect(s).toContain('tell application "Terminal"')
    expect(s).toContain(`cd '/Users/ben/it'\\\\''s \\"here\\"' && '/usr/local/bin/claude' /mcp`)
  })
})
