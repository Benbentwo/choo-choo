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
        forward: (c, text) => void sent.push([c.id, text]),
        resolve: (c, resolved) => Object.assign(c, { resolved: resolved || undefined })
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
  it('resolves threads: a thread itself, or any thread from the orchestrator chat', async () => {
    const call = async (o: Server, name: string, a: unknown) => (await o.mcpServers.choo.tools.find((t) => t.name === name)!.handler(a)).content[0].text
    const t = role('thread')
    const own = orch.queryOptions(sdk, repo, {} as never, [], t.r) as Server & { autoAllowTools: string[] }
    expect(await call(own, 'resolve_thread', {})).toMatch(/^Resolved/)
    expect(t.threads[0].resolved).toBe(true)
    expect(own.autoAllowTools).toContain('mcp__choo__resolve_thread')
    const rt = role('router')
    const router = orch.queryOptions(sdk, repo, {} as never, [], rt.r) as Server
    expect(await call(router, 'resolve_thread', { thread_id: 't1' })).toBe('Resolved "Signup flow".')
    expect(JSON.parse(await call(router, 'list_threads', {}))[0]).toMatchObject({ id: 't1', resolved: true })
    // Sending to a resolved thread reopens it (the app does that when the message lands); the result says so.
    expect(JSON.parse(await call(router, 'send_to_thread', { thread_id: 't1', message: 'One more thing' }))).toMatchObject({ reopened: true })
    expect(await call(router, 'resolve_thread', { thread_id: 't1', reopen: true })).toBe('Reopened "Signup flow".')
    expect(rt.threads[0].resolved).toBeUndefined()
    await expect(call(router, 'resolve_thread', { thread_id: 'nope' })).rejects.toThrow(/No thread nope/)
    const plain = orch.queryOptions(sdk, repo, {} as never, []) as Server & { autoAllowTools: string[] }
    expect(plain.mcpServers.choo.tools.map((x) => x.name)).not.toContain('resolve_thread')
    expect(plain.autoAllowTools).not.toContain('mcp__choo__resolve_thread')
  })
  it('tells each chat its role', () => {
    expect(orch.systemPrompt(repo, '', [], role('router').r)).toContain("This is the project's orchestrator chat")
    expect(orch.systemPrompt(repo, '', [], role('thread').r)).toContain('You are in the thread "Signup flow"')
    expect(orch.systemPrompt(repo, '')).not.toContain('This chat:')
  })
  it("lists a thread's own workspaces unless asked for all, and takes one over", async () => {
    const store = await import('../src/main/store')
    store.load()
    const w = (id: string, threadId?: string) => ({ id, repoId: 'r1', name: id, branch: id, baseRef: 'main', path: `/w/${id}`, title: id, createdAt: 1, orchestratorId: 'r1', threadId }) as import('../src/shared/types').Workspace
    store.get().workspaces.push(w('mine', 't1'), w('theirs', 't2'), w('loose'))
    store.get().chats.push(...['mine', 'theirs', 'loose'].map((id) => ({ ...chat(`c-${id}`, id), workspaceId: id, thread: false })))
    const { r, threads } = role('thread')
    threads.push(chat('t2', 'Dark mode'))
    let changed = 0
    const o = orch.queryOptions(sdk, repo, { pendingChatIds: () => new Set(), changed: () => changed++ } as never, [], r) as Server
    const call = async (name: string, a: unknown) => (await o.mcpServers.choo.tools.find((t) => t.name === name)!.handler(a)).content[0].text
    const list = async (a: unknown) => (JSON.parse(await call('list_workspaces', a)) as { id: string; thread: string | null; yours: boolean }[]).map((x) => [x.id, x.thread, x.yours])
    expect(await list({})).toEqual([['mine', 'Signup flow', true]])
    expect(await list({ all: true })).toEqual([
      ['mine', 'Signup flow', true],
      ['theirs', 'Dark mode', false],
      ['loose', null, false]
    ])
    expect(await call('take_workspace', { workspace_id: 'theirs' })).toBe('This thread now owns theirs (was "Dark mode").')
    expect(changed).toBe(1)
    expect(await call('take_workspace', { workspace_id: 'theirs' })).toMatch(/already this thread's/)
    expect((await list({})).map(([id]) => id)).toEqual(['mine', 'theirs'])
    expect(orch.systemPrompt(repo, '', [], r)).toContain('This thread owns the workspaces it starts')
    const router = orch.queryOptions(sdk, repo, {} as never, [], role('router').r) as Server
    expect(router.mcpServers.choo.tools.map((t) => t.name)).not.toContain('take_workspace')
  })
})

describe('project repos', () => {
  const sdk = {
    tool: (name: string, description: string, shape: object, handler: (a: unknown) => Promise<{ content: { text: string }[] }>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: { name: string }[] }) => o
  } as never
  type Server = { mcpServers: Record<string, { tools: { name: string; handler(a: unknown): Promise<{ content: { text: string }[] }> }[] }>; alwaysAskTools: string[] }

  it('lets a project find and add repos, and asks before cloning', async () => {
    const scope = orch.groupScope({ id: 'g7', name: 'Launch', repoIds: ['a'], createdAt: 1 }, [{ id: 'a', name: 'api', path: '/a', defaultBranch: 'main' }])
    const calls: [string, string, boolean][] = []
    const host = {
      findRepos: async () => ({ local: [{ name: 'web', path: '/w', inProject: false }], github: [{ nameWithOwner: 'acme/sdk' }] }),
      addRepoToProject: async (g: string, ref: string, o: { clone: boolean }) => {
        calls.push([g, ref, o.clone])
        return { id: ref, name: ref.split('/').pop()!, path: `/${ref}`, defaultBranch: 'main' }
      }
    } as never
    const o = orch.queryOptions(sdk, scope, host) as Server
    const tool = (n: string) => o.mcpServers.choo.tools.find((t) => t.name === n)!
    expect(JSON.parse((await tool('find_repos').handler({ query: 'web' })).content[0].text).github[0].nameWithOwner).toBe('acme/sdk')
    await tool('add_repo_to_project').handler({ repo: 'web' })
    await tool('clone_repo').handler({ repo: 'acme/sdk', reason: 'The doc says the client lives there' })
    expect(calls).toEqual([
      ['g7', 'web', false],
      ['g7', 'acme/sdk', true]
    ])
    expect(scope.repos.map((r) => r.name)).toEqual(['api', 'web', 'sdk'])
    expect(o.alwaysAskTools).toEqual(['mcp__choo__clone_repo'])
    expect(needsApproval('full', [], 'mcp__choo__find_repos')).toBe(false)
    // A single repo's orchestrator has none of these.
    const single = orch.queryOptions(sdk, repo, host) as Server
    expect(single.mcpServers.choo.tools.map((t) => t.name)).not.toContain('find_repos')
  })
})

describe('usage savings', () => {
  const sdk = {
    tool: (name: string, description: string, shape: object, handler: (a: unknown) => Promise<{ content: { text: string }[] }>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: { name: string }[] }) => o
  } as never
  type Out = { turnPrefix?: string; onSessionStart?: () => void; systemPrompt: { append: string }; mcpServers: { choo: { tools: { name: string; description: string; handler(a: unknown): Promise<unknown> }[] } } }
  it('keeps memory out of the prompt and tells threads not to wait', () => {
    const p = orch.systemPrompt(repo, 'remember this', [], undefined, undefined, true)
    expect(p).not.toContain('remember this')
    expect(p).toContain('<project-memory>')
    expect(p).toContain('end your turn instead of waiting')
  })
  it('sends memory with the turn only until the session has this version', async () => {
    orch.writeMemory(repo, '- squash merges\n')
    const chat = { id: 'c', workspaceId: 'w', sdkSessionId: 's1' } as import('../src/shared/types').Chat
    const first = orch.queryOptions(sdk, repo, {} as never, [], undefined, undefined, { chat }) as Out
    expect(first.turnPrefix).toContain('- squash merges')
    expect(first.systemPrompt.append).not.toContain('- squash merges')
    first.onSessionStart!()
    expect((orch.queryOptions(sdk, repo, {} as never, [], undefined, undefined, { chat }) as Out).turnPrefix).toBeUndefined()
    // Saving memory from this chat doesn't send it back to the same chat.
    await first.mcpServers.choo.tools.find((t) => t.name === 'update_memory')!.handler({ content: '- rebase merges\n' })
    expect((orch.queryOptions(sdk, repo, {} as never, [], undefined, undefined, { chat }) as Out).turnPrefix).toBeUndefined()
    // Another chat on the same memory gets the new version.
    const other = { id: 'd', workspaceId: 'w', sdkSessionId: 's2', memoryHash: chat.memoryHash } as import('../src/shared/types').Chat
    orch.writeMemory(repo, '- merge queue\n')
    expect((orch.queryOptions(sdk, repo, {} as never, [], undefined, undefined, { chat: other }) as Out).turnPrefix).toContain('- merge queue')
    // Off: memory stays in the prompt and nothing rides with the turn.
    const off = orch.queryOptions(sdk, repo, {} as never) as Out
    expect(off.turnPrefix).toBeUndefined()
    expect(off.systemPrompt.append).toContain('- merge queue')
  })
  it('reads the handoff report rather than the transcript by default', () => {
    const o = orch.queryOptions(sdk, repo, {} as never, [], undefined, undefined, { chat: { id: 'c' } as never }) as Out
    expect(o.mcpServers.choo.tools.find((t) => t.name === 'read_workspace')!.description).toContain('handoff report')
  })
})

describe('models for workspaces a project starts', () => {
  it('starts them on the project workspace model unless the thread picks one', async () => {
    const chats: { model: string; effort: string }[] = []
    const host = {
      createWorkspace: async () => {
        const chat = { id: `c${chats.length}`, model: 'opus', effort: 'high' }
        chats.push(chat)
        return { workspace: { id: `w${chats.length}`, name: 'w', branch: 'b' }, chat }
      },
      sendToChat: () => {},
      modelFor: (role: string, groupId?: string) => (role === 'workspace' && groupId === 'g9' ? { model: 'sonnet', effort: 'medium' } : { model: 'opus', effort: 'high' })
    } as never
    const sdk = {
      tool: (name: string, _d: string, _s: object, handler: (a: unknown) => Promise<unknown>) => ({ name, handler }),
      createSdkMcpServer: (o: object) => o
    } as never
    const scope = orch.groupScope({ id: 'g9', name: 'P', repoIds: ['r1'], createdAt: 0 }, [{ id: 'r1', name: 'api', path: '/a', defaultBranch: 'main' }])
    const o = orch.queryOptions(sdk, scope, host) as { mcpServers: { choo: { tools: { name: string; handler(a: unknown): Promise<unknown> }[] } } }
    const start = o.mcpServers.choo.tools.find((t) => t.name === 'start_workspace')!
    await start.handler({ task: 'one', repo: 'api' })
    await start.handler({ task: 'two', repo: 'api', model: 'haiku' })
    expect(chats).toEqual([
      { id: 'c0', model: 'sonnet', effort: 'medium' },
      { id: 'c1', model: 'haiku', effort: 'medium' }
    ])
  })
})
