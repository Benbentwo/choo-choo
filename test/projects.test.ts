import { describe, it, expect } from 'vitest'
import type { Chat, Repo, RepoGroup, Workspace } from '../src/shared/types'
import { inProject, projectThreads, projectTree, routerChat, stripRouted, threadTitle, updateTarget, ROUTED_PREFIX } from '../src/shared/projects'

const repo = (id: string): Repo => ({ id, name: id, path: `/r/${id}`, defaultBranch: 'main' })
const ws = (id: string, repoId: string, extra: Partial<Workspace> = {}): Workspace => ({ id, repoId, name: id, branch: id, baseRef: 'main', path: `/w/${id}`, title: id, createdAt: 1, ...extra })
const chat = (id: string, extra: Partial<Chat> = {}): Chat => ({ id, workspaceId: 'orch', title: id, model: 'opus', effort: 'high', status: 'idle', createdAt: 1, ...extra })
const group: RepoGroup = { id: 'g', name: 'Launch', repoIds: ['api', 'web', 'docs'], createdAt: 1 }

describe('projects', () => {
  it('lists only repos with open work, newest first, unless asked for all', () => {
    const wss = [
      ws('a', 'api', { orchestratorId: 'g', createdAt: 1 }),
      ws('b', 'api', { orchestratorId: 'g', createdAt: 2 }),
      ws('c', 'web', { orchestratorId: 'g', archived: true }),
      ws('d', 'web'),
      ws('o', 'api', { orchestrator: true, groupId: 'g' })
    ]
    const repos = ['api', 'web', 'docs'].map(repo)
    expect(projectTree(group, repos, wss).map((n) => [n.repo.id, n.workspaces.map((w) => w.id)])).toEqual([['api', ['b', 'a']]])
    expect(projectTree(group, repos, wss, true).map((n) => n.repo.id)).toEqual(['api', 'web', 'docs'])
    expect(inProject(wss[0], [group])).toBe(true)
    expect(inProject(wss[3], [group])).toBe(false)
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
