import { describe, it, expect } from 'vitest'
import type { Chat, Repo, RepoGroup, Workspace } from '../src/shared/types'
import { inProject, parseAutoUpdate, resolvedThreads, shouldAutoResolve, threadWorkspaces, workDone, projectThreads, projectTree, routerChat, stripRouted, threadKey, threadTitle, updateTarget, workspaceThread, ROUTED_PREFIX, personTurn, routedMessage, AUTO_UPDATE_PREFIX } from '../src/shared/projects'
import { autoUpdatePrompt } from '../src/main/orchestrator'

const repo = (id: string): Repo => ({ id, name: id, path: `/r/${id}`, defaultBranch: 'main' })
const ws = (id: string, repoId: string, extra: Partial<Workspace> = {}): Workspace => ({ id, repoId, name: id, branch: id, baseRef: 'main', path: `/w/${id}`, title: id, createdAt: 1, ...extra })
const chat = (id: string, extra: Partial<Chat> = {}): Chat => ({ id, workspaceId: 'orch', title: id, model: 'opus', effort: 'high', status: 'idle', createdAt: 1, ...extra })
const group: RepoGroup = { id: 'g', name: 'Launch', repoIds: ['api', 'web', 'docs'], createdAt: 1 }

describe('projects', () => {
  it('groups open work by the thread that owns it, then by repo, newest first', () => {
    const chats = [chat('r'), chat('t1', { thread: true, createdAt: 1 }), chat('t2', { thread: true, createdAt: 2 }), chat('t3', { thread: true, createdAt: 3 })]
    const wss = [
      ws('a', 'api', { orchestratorId: 'g', threadId: 't1', createdAt: 1 }),
      ws('b', 'api', { orchestratorId: 'g', threadId: 't1', createdAt: 2 }),
      ws('w', 'web', { orchestratorId: 'g', threadId: 't1' }),
      ws('x', 'web', { orchestratorId: 'g', threadId: 't2' }),
      ws('c', 'web', { orchestratorId: 'g', threadId: 't2', archived: true }),
      ws('n', 'docs', { orchestratorId: 'g' }),
      ws('gone', 'docs', { orchestratorId: 'g', threadId: 'deleted' }),
      ws('d', 'web'),
      ws('o', 'api', { orchestrator: true, groupId: 'g' })
    ]
    const repos = ['api', 'web', 'docs'].map(repo)
    const tree = projectTree(group, repos, wss, chats, 'orch')
    // Newest thread first, even with no open work (t3); unowned work comes last.
    expect(tree.map((n) => [n.thread?.id ?? null, n.repos.map((r) => [r.repo.id, r.workspaces.map((w) => w.id)])])).toEqual([
      ['t3', []],
      ['t2', [['web', ['x']]]],
      ['t1', [['api', ['b', 'a']], ['web', ['w']]]],
      [null, [['docs', ['n', 'gone']]]]
    ])
    expect(tree.map(threadKey)).toEqual(['t3', 't2', 't1', 'none'])
    expect(workspaceThread(wss[0], chats, 'orch')?.id).toBe('t1')
    expect(workspaceThread(wss[0], chats, undefined)).toBeUndefined()
    // The orchestrator chat isn't a thread, so work it "owns" is unowned.
    expect(workspaceThread(ws('z', 'api', { threadId: 'r' }), chats, 'orch')).toBeUndefined()
    expect(inProject(wss[0], [group])).toBe(true)
    expect(inProject(wss[7], [group])).toBe(false)
  })
  it('tells the orchestrator chat from threads and sends updates to the thread that started the work', () => {
    const chats = [chat('t1', { thread: true, createdAt: 1 }), chat('r'), chat('t2', { thread: true, createdAt: 2 }), chat('other', { workspaceId: 'x' })]
    expect(routerChat(chats, 'orch')?.id).toBe('r')
    expect(projectThreads(chats, 'orch').map((c) => c.id)).toEqual(['t2', 't1'])
    expect(updateTarget(ws('a', 'api', { threadId: 't1' }), chats, 'orch')?.id).toBe('t1')
    expect(updateTarget(ws('a', 'api', { threadId: 'gone' }), chats, 'orch')?.id).toBe('r')
    expect(updateTarget(ws('a', 'api'), chats, 'orch')?.id).toBe('r')
  })
  it('marks forwarded messages and names threads from their first message', () => {
    expect(stripRouted(`${ROUTED_PREFIX}\nStart dark mode`)).toEqual({ routed: true, text: 'Start dark mode' })
    expect(stripRouted('hello')).toEqual({ routed: false, text: 'hello' })
    expect(threadTitle(`${ROUTED_PREFIX}\nStart dark mode\nmore`)).toBe('Start dark mode')
    expect(threadTitle('Rework the signup flow into three steps on web and mobile')).toBe('Rework the signup flow into three steps…')
    expect(threadTitle('   ')).toBe('New thread')
  })
  it('reads back the workspaces an automatic update reported', () => {
    const entries = [
      { title: 'Upgrade libxml2 (CVE fix)', id: 'w1', state: 'finished' as const },
      { title: 'Add tests', id: 'w2', state: 'error' as const },
      { title: 'Deploy', id: 'w3', state: 'needs-approval' as const }
    ]
    expect(parseAutoUpdate(autoUpdatePrompt(entries))).toEqual(entries)
    expect(parseAutoUpdate('- Fix login (w1) finished.')).toBeNull()
  })
})

describe('projectArchived', () => {
  it("lists the project's archived workspaces, last archived first", async () => {
    const { projectArchived } = await import('../src/shared/projects')
    const g = { id: 'g1', name: 'P', repoIds: ['r1'], createdAt: 1 }
    const w = (id: string, extra: Partial<import('../src/shared/types').Workspace>) =>
      ({ id, repoId: 'r1', name: id, branch: id, baseRef: 'main', path: `/${id}`, title: id, createdAt: 1, ...extra }) as import('../src/shared/types').Workspace
    const list = [
      w('a', { orchestratorId: 'g1', archived: true, archivedAt: 5 }),
      w('b', { orchestratorId: 'g1', archived: true, archivedAt: 9 }),
      w('c', { orchestratorId: 'g1' }),
      w('d', { orchestratorId: 'g2', archived: true }),
      w('e', { groupId: 'g1', orchestrator: true, orchestratorId: 'g1', archived: true })
    ]
    expect(projectArchived(g, list).map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('resolved threads', () => {
  const repos = ['api', 'web'].map(repo)
  it('leaves resolved threads and their work out of the sidebar, except the one on screen', () => {
    const chats = [chat('r'), chat('t1', { thread: true, createdAt: 1 }), chat('t2', { thread: true, createdAt: 2, resolved: true, resolvedAt: 5 }), chat('t3', { thread: true, createdAt: 3, resolved: true, resolvedAt: 9 })]
    const wss = [ws('a', 'api', { orchestratorId: 'g', threadId: 't1' }), ws('b', 'web', { orchestratorId: 'g', threadId: 't2' }), ws('n', 'api', { orchestratorId: 'g' })]
    const ids = (tree: ReturnType<typeof projectTree>) => tree.map((n) => [n.thread?.id ?? null, n.repos.flatMap((r) => r.workspaces.map((w) => w.id))])
    expect(ids(projectTree(group, repos, wss, chats, 'orch'))).toEqual([
      ['t1', ['a']],
      [null, ['n']]
    ])
    expect(ids(projectTree(group, repos, wss, chats, 'orch', { keep: 't2' }))).toEqual([
      ['t2', ['b']],
      ['t1', ['a']],
      [null, ['n']]
    ])
    expect(resolvedThreads(chats, 'orch').map((c) => c.id)).toEqual(['t3', 't2'])
    expect(projectThreads(chats, 'orch', { open: true }).map((c) => c.id)).toEqual(['t1'])
    expect(projectThreads(chats, 'orch').map((c) => c.id)).toEqual(['t3', 't2', 't1'])
  })

  it('resolves a thread on its own only when all of its work is merged, closed or archived', () => {
    const t = chat('t1', { thread: true })
    const wss = [ws('a', 'api', { threadId: 't1', createdAt: 10 }), ws('b', 'web', { threadId: 't1', createdAt: 20, archived: true }), ws('o', 'api', { threadId: 't1', orchestrator: true }), ws('x', 'api', { threadId: 't2' })]
    const owned = threadWorkspaces('t1', wss)
    expect(owned.map((w) => w.id)).toEqual(['a', 'b'])
    const merged = () => 'MERGED' as const
    expect(shouldAutoResolve(t, owned, merged)).toBe(true)
    expect(shouldAutoResolve(t, owned, (id) => (id === 'a' ? 'CLOSED' : null))).toBe(true)
    // Open PR or no PR yet: still working.
    expect(shouldAutoResolve(t, owned, () => 'OPEN')).toBe(false)
    expect(shouldAutoResolve(t, owned, () => null)).toBe(false)
    // A thread that never started work is just a conversation: the person resolves it.
    expect(shouldAutoResolve(t, [], merged)).toBe(false)
    // Busy, unread, already resolved, or not a thread.
    expect(shouldAutoResolve({ ...t, status: 'running' }, owned, merged)).toBe(false)
    expect(shouldAutoResolve({ ...t, unread: true }, owned, merged)).toBe(false)
    expect(shouldAutoResolve({ ...t, resolved: true }, owned, merged)).toBe(false)
    expect(shouldAutoResolve({ ...t, thread: false }, owned, merged)).toBe(false)
    // Reopened by the person: wait for work started after that.
    expect(shouldAutoResolve({ ...t, reopenedAt: 25 }, owned, merged)).toBe(false)
    expect(shouldAutoResolve({ ...t, reopenedAt: 15 }, owned, merged)).toBe(true)
    expect(workDone(ws('z', 'api', { archived: true }), 'OPEN')).toBe(true)
    expect(workDone(ws('z', 'api'), undefined)).toBe(false)
  })
})

describe('forwarding the person\'s words', () => {
  it('takes what the person wrote this turn, skipping app-sent messages', () => {
    const items = [
      { id: '1', kind: 'user', text: 'before', ts: 1 },
      { id: '2', kind: 'result', ts: 2 },
      { id: '3', kind: 'user', text: `${AUTO_UPDATE_PREFIX}\n- x (w1) finished.`, ts: 3 },
      { id: '4', kind: 'user', text: 'Ship it', images: ['data:a'], ts: 4 },
      { id: '5', kind: 'user', text: 'advisor says', fromAdvisor: true, ts: 5 }
    ] as never
    expect(personTurn(items)).toEqual({ text: 'Ship it', images: ['data:a'] })
    expect(personTurn([])).toEqual({ text: '', images: [] })
  })
  it('keeps the person\'s words first and the note apart', () => {
    expect(routedMessage('Ship it', 'For the release thread')).toBe(`${ROUTED_PREFIX}\nShip it\n\nNote from the orchestrator chat:\nFor the release thread`)
    expect(routedMessage('Ship it')).toBe(`${ROUTED_PREFIX}\nShip it`)
    expect(routedMessage('', 'Check CI')).toBe(`${ROUTED_PREFIX}\nNote from the orchestrator chat: (no new message from the person)\nCheck CI`)
  })
})
