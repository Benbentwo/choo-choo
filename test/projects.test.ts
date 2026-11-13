import { describe, it, expect } from 'vitest'
import type { Chat, Repo, RepoGroup, Workspace } from '../src/shared/types'
import { inProject, parseAutoUpdate, projectThreads, projectTree, routerChat, stripRouted, threadKey, threadTitle, updateTarget, workspaceThread, ROUTED_PREFIX } from '../src/shared/projects'
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
    // Newest thread first; t3 has no open work so it stays out; unowned work comes last.
    expect(tree.map((n) => [n.thread?.id ?? null, n.repos.map((r) => [r.repo.id, r.workspaces.map((w) => w.id)])])).toEqual([
      ['t2', [['web', ['x']]]],
      ['t1', [['api', ['b', 'a']], ['web', ['w']]]],
      [null, [['docs', ['n', 'gone']]]]
    ])
    expect(tree.map(threadKey)).toEqual(['t2', 't1', 'none'])
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
