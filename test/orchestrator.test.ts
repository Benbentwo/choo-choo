import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'choo-orch-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
const orch = await import('../src/main/orchestrator')
const { needsApproval } = await import('../src/main/agent')

const repo = orch.repoScope({ id: 'r1', name: 'my repo', path: '/x', defaultBranch: 'main' })

describe('orchestrator memory', () => {
  it('starts empty, then round-trips', () => {
    expect(orch.readMemory(repo)).toBe('')
    orch.writeMemory(repo, '- Ben prefers small PRs\n')
    expect(orch.readMemory(repo)).toContain('small PRs')
    expect(orch.memoryPath(repo)).toBe(join(home, 'choo-choo', 'memory', 'my_repo.md'))
  })
  it('puts memory in the system prompt', () => {
    const p = orch.systemPrompt(repo, 'remember this')
    expect(p).toContain('remember this')
    expect(orch.systemPrompt(repo, '')).toContain('(empty)')
  })
})

describe('transcript', () => {
  it('summarizes items compactly', () => {
    const t = orch.transcript(
      [
        { id: '1', kind: 'user', text: 'fix it', ts: 0 },
        { id: '2', kind: 'tool', name: 'Edit', input: { file_path: 'a.ts' }, ts: 0 },
        { id: '3', kind: 'assistant', text: 'Done', ts: 0 },
        { id: '4', kind: 'result', ok: true, ts: 0 }
      ],
      10
    )
    expect(t.split('\n')).toEqual(['USER: fix it', 'TOOL Edit: {"file_path":"a.ts"}', 'AGENT: Done', '-- turn finished --'])
  })
})

describe('permissions', () => {
  it('never asks before the orchestrator reads or waits', () => {
    expect(needsApproval('ask', [], 'mcp__choo__wait_for_workspaces')).toBe(false)
    expect(needsApproval('ask', [], 'mcp__choo__start_workspace')).toBe(true)
  })
})

describe('project groups', () => {
  const repos = [
    { id: 'a', name: 'api', path: '/a', defaultBranch: 'main' },
    { id: 'b', name: 'web', path: '/b', defaultBranch: 'main' }
  ]
  const group = { id: 'g1', name: 'Shop', repoIds: ['b', 'gone', 'a'], createdAt: 0 }
  it('keeps the group order and drops removed repos', () => {
    const scope = orch.groupScope(group, repos)
    expect(scope.repos.map((r) => r.name)).toEqual(['web', 'api'])
    expect(scope.group).toBe(true)
  })
  it('keeps group memory apart from repo memory', () => {
    const scope = orch.groupScope(group, repos)
    expect(orch.memoryPath(scope)).toBe(join(home, 'choo-choo', 'memory', 'groups', 'Shop.md'))
    orch.writeMemory(scope, 'shared note')
    expect(orch.readMemory(scope)).toBe('shared note')
    expect(orch.readMemory(orch.repoScope(repos[0]))).toBe('')
  })
  it('lists every repo in the prompt', () => {
    const p = orch.systemPrompt(orch.groupScope(group, repos), '')
    expect(p).toContain('Shop project')
    expect(p).toContain('- web at /b')
    expect(p).toContain('- api at /a')
  })
})

describe('checks summary', () => {
  const run = (name: string, bucket: 'pass' | 'fail' | 'pending') => ({ name, bucket, state: '', link: '', workflow: 'ci', description: '' })
  it('reports the worst state, failures first', () => {
    expect(orch.checksSummary([])).toEqual({ state: 'none', lines: [] })
    expect(orch.checksSummary([run('a', 'pass'), run('b', 'pending')]).state).toBe('pending')
    const s = orch.checksSummary([run('ok', 'pass'), run('bad', 'fail')])
    expect(s.state).toBe('fail')
    expect(s.lines[0]).toBe('FAIL ci / bad')
  })
})

describe('automatic updates', () => {
  it('says it is not from the person and names each workspace', () => {
    const p = orch.autoUpdatePrompt([
      { title: 'Fix login', id: 'w1', state: 'finished' },
      { title: 'Add tests', id: 'w2', state: 'error' }
    ])
    expect(p).toContain('not from the person')
    expect(p).toContain('Fix login (w1) finished.')
    expect(p).toContain('Add tests (w2) hit an error.')
  })
  it('lets pr_status run without asking', () => {
    expect(needsApproval('ask', [], 'mcp__choo__pr_status')).toBe(false)
  })
})

describe('tools from add-ons', () => {
  // The two SDK functions queryOptions uses, recording what they were given.
  const sdk = {
    tool: (name: string, description: string, shape: object, handler: (a: unknown) => Promise<{ content: { text: string }[] }>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: { name: string }[] }) => o
  } as never
  const host = {} as never
  const calls: unknown[][] = []
  const board: import('../src/main/orchestrator').AddonToolset = {
    server: 'addon-plan-board',
    addon: 'Plan board',
    description: 'Plans that run one workspace per task.',
    tools: [
      { name: 'plan_read', description: 'Read the plan.', readOnly: true, call: async (input, context) => (calls.push([input, context]), { tasks: 3 }) },
      { name: 'plan_start', description: 'Start ready tasks.', input: { type: 'object', properties: { limit: { type: 'integer' } } }, call: async () => 'Started 2.' }
    ]
  }

  it('adds a server per add-on beside the built-in tools', () => {
    const o = orch.queryOptions(sdk, repo, host, [board]) as { mcpServers: Record<string, { tools: { name: string; shape: object }[] }> }
    expect(Object.keys(o.mcpServers)).toEqual(['choo', 'addon-plan-board'])
    expect(o.mcpServers['addon-plan-board'].tools.map((t) => t.name)).toEqual(['plan_read', 'plan_start'])
    expect(Object.keys(o.mcpServers['addon-plan-board'].tools[1].shape)).toEqual(['limit'])
    expect(Object.keys((orch.queryOptions(sdk, repo, host) as typeof o).mcpServers)).toEqual(['choo'])
  })
  it("passes the orchestrator's projects to the tool and returns what it answered as text", async () => {
    const o = orch.queryOptions(sdk, repo, host, [board]) as { mcpServers: Record<string, { tools: { handler(a: unknown): Promise<{ content: { text: string }[] }> }[] }> }
    const [read, start] = o.mcpServers['addon-plan-board'].tools
    expect((await read.handler({ plan: 'q3' })).content[0].text).toBe(JSON.stringify({ tasks: 3 }, null, 2))
    expect(calls).toEqual([[{ plan: 'q3' }, { repoIds: ['r1'] }]])
    expect((await start.handler({})).content[0].text).toBe('Started 2.')
  })
  it('lets read-only add-on tools run without asking, and no others', () => {
    const o = orch.queryOptions(sdk, repo, host, [board]) as { autoAllowTools: string[] }
    expect(o.autoAllowTools).toEqual(['mcp__addon-plan-board__plan_read'])
    expect(needsApproval('ask', [], 'mcp__addon-plan-board__plan_start')).toBe(true)
  })
  it('tells the orchestrator which add-ons it has, and only when it has some', () => {
    const p = orch.systemPrompt(repo, '', [board])
    expect(p).toContain('- Plan board (tools named mcp__addon-plan-board__*): Plans that run one workspace per task.')
    expect(p).toContain('comes from the add-on, not from the person')
    expect(orch.systemPrompt(repo, '')).not.toContain('Add-ons:')
  })
  it('cuts an answer that is too long to read', () => {
    expect(orch.renderToolResult('ok')).toBe('ok')
    expect(orch.renderToolResult(undefined)).toBe('null')
    const long = orch.renderToolResult('x'.repeat(150_000))
    expect(long.length).toBeLessThan(100_100)
    expect(long).toMatch(/cut: the answer was 150000 characters/)
  })
})

describe('project threads', () => {
  const sdk = {
    tool: (name: string, description: string, shape: object, handler: (a: unknown) => Promise<{ content: { text: string }[] }>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: { name: string }[] }) => o
  } as never
  type Server = { mcpServers: Record<string, { tools: { name: string; handler(a: unknown): Promise<{ content: { text: string }[] }> }[] }> }
  const chat = (id: string, title: string) => ({ id, workspaceId: 'o', title, model: 'opus', effort: 'high', status: 'idle', createdAt: 1, thread: true }) as import('../src/shared/types').Chat
  const role = (kind: 'router' | 'thread') => {
    const threads = [chat('t1', 'Signup flow')]
    const sent: [string, string][] = []
    const r: import('../src/main/orchestrator').ProjectRole = {
      kind,
      chatId: kind === 'router' ? 'r' : 't1',
      title: kind === 'router' ? 'Orchestrator' : 'Signup flow',
      threads: {
        list: () => threads,
        create: (title) => {
          const c = chat(`t${threads.length + 1}`, title)
          threads.push(c)
          return c
        },
        forward: (c, text) => void sent.push([c.id, text])
      }
    }
    return { r, threads, sent }
  }

  it('gives the orchestrator chat routing tools instead of start_workspace', () => {
    const names = (o: Server) => o.mcpServers.choo.tools.map((t) => t.name)
    const router = orch.queryOptions(sdk, repo, {} as never, [], role('router').r) as Server
    expect(names(router)).toContain('send_to_thread')
    expect(names(router)).toContain('list_threads')
    expect(names(router)).not.toContain('start_workspace')
    const thread = orch.queryOptions(sdk, repo, {} as never, [], role('thread').r) as Server
    expect(names(thread)).toContain('start_workspace')
    expect(names(thread)).not.toContain('send_to_thread')
  })
  it('forwards to an existing thread or starts one, marking the message', async () => {
    const { r, threads, sent } = role('router')
    const o = orch.queryOptions(sdk, repo, {} as never, [], r) as Server
    const send = o.mcpServers.choo.tools.find((t) => t.name === 'send_to_thread')!
    const a = JSON.parse((await send.handler({ thread_id: 't1', message: 'Skip invites for solo accounts' })).content[0].text)
    expect(a).toEqual({ thread_id: 't1', title: 'Signup flow', created: false })
    const b = JSON.parse((await send.handler({ new_thread_title: 'Dark mode', message: 'Start dark mode' })).content[0].text)
    expect(b).toMatchObject({ title: 'Dark mode', created: true })
    expect(threads).toHaveLength(2)
    expect(sent.map(([id, t]) => [id, t.split('\n')[0]])).toEqual([
      ['t1', '[Sent here from the orchestrator chat]'],
      [b.thread_id, '[Sent here from the orchestrator chat]']
    ])
    await expect(send.handler({ message: 'x' })).rejects.toThrow(/thread_id or new_thread_title/)
    await expect(send.handler({ thread_id: 'nope', message: 'x' })).rejects.toThrow(/No thread nope/)
  })
  it('tells each chat its role', () => {
    expect(orch.systemPrompt(repo, '', [], role('router').r)).toContain("This is the project's orchestrator chat")
    expect(orch.systemPrompt(repo, '', [], role('thread').r)).toContain('You are in the thread "Signup flow"')
    expect(orch.systemPrompt(repo, '')).not.toContain('This chat:')
  })
})
