import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeTrigger, diffInbox, nextRun, runPrompt, type Automation } from '../src/shared/automations'
import type { InboxPr } from '../src/shared/prInbox'
import type { Chat, Workspace } from '../src/shared/types'

const home = mkdtempSync(join(tmpdir(), 'choo-auto-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => home }))
const store = await import('../src/main/store')
const automations = await import('../src/main/automations')
const orch = await import('../src/main/orchestrator')

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('schedules', () => {
  it('finds the next daily, weekday and weekly time in local time', () => {
    // Friday 2026-11-13 10:00.
    const fri = at(2026, 11, 13, 10)
    expect(nextRun({ kind: 'daily', at: '09:00' }, fri)).toBe(at(2026, 11, 14, 9))
    expect(nextRun({ kind: 'daily', at: '11:30' }, fri)).toBe(at(2026, 11, 13, 11, 30))
    expect(nextRun({ kind: 'daily', at: '09:00', weekdaysOnly: true }, fri)).toBe(at(2026, 11, 16, 9))
    expect(nextRun({ kind: 'weekly', day: 1, at: '08:00' }, fri)).toBe(at(2026, 11, 16, 8))
    expect(nextRun({ kind: 'hourly', hours: 2 }, fri)).toBe(fri + 2 * 3_600_000)
    expect(nextRun({ kind: 'github', event: 'checks_failed' }, fri)).toBeUndefined()
    expect(nextRun({ kind: 'manual' }, fri)).toBeUndefined()
  })
  it('labels triggers for the list', () => {
    expect(describeTrigger({ kind: 'daily', at: '09:00', weekdaysOnly: true })).toBe('Weekdays 09:00')
    expect(describeTrigger({ kind: 'hourly', hours: 1 })).toBe('Every hour')
    expect(describeTrigger({ kind: 'weekly', day: 1, at: '08:00' })).toBe('Mondays 08:00')
    expect(describeTrigger({ kind: 'github', event: 'review_requested' })).toBe('A PR asks for my review')
    expect(describeTrigger({ kind: 'github', event: 'issue_opened', label: 'bug' })).toBe('A new issue is opened (bug)')
  })
})

const pr = (n: number, roles: InboxPr['roles'], over: Partial<InboxPr> = {}): InboxPr => ({
  repo: 'acme/web',
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/acme/web/pull/${n}`,
  author: 'sam',
  isDraft: false,
  headRefName: `b${n}`,
  isCrossRepository: false,
  updatedAt: `2026-11-10T10:0${n}:00Z`,
  additions: 1,
  deletions: 1,
  reviewDecision: null,
  checks: 'PENDING',
  roles,
  ...over
})

describe('GitHub events from the PR inbox', () => {
  it('only records where things stand on the first look', () => {
    const { events, next } = diffInbox(undefined, [pr(1, ['review']), pr(2, ['mine'], { checks: 'FAILURE' })])
    expect(events).toEqual([])
    expect(next.review).toEqual(['acme/web#1'])
    expect(next.checks['acme/web#2']).toBe('FAILURE')
  })
  it('notices new review requests, red CI and new reviews', () => {
    const first = diffInbox(undefined, [pr(1, ['review']), pr(2, ['mine']), pr(3, ['mine'])]).next
    const { events } = diffInbox(first, [
      pr(1, ['review']),
      pr(4, ['review']),
      pr(2, ['mine'], { checks: 'FAILURE' }),
      pr(3, ['mine'], { reviewDecision: 'CHANGES_REQUESTED' })
    ])
    expect(events.map((e) => [e.event, e.number])).toEqual([
      ['review_requested', 4],
      ['checks_failed', 2],
      ['reviewed', 3]
    ])
    // Still red on the next look: no second event.
    const again = diffInbox(diffInbox(first, [pr(2, ['mine'], { checks: 'FAILURE' })]).next, [pr(2, ['mine'], { checks: 'FAILURE' })])
    expect(again.events).toEqual([])
  })
  it('puts the events and their finding ids in the run prompt', () => {
    const a = { name: 'Fix red CI', prompt: 'Fix the failing checks.', maxFindings: 3 } as Automation
    const first = diffInbox(undefined, [pr(2, ['mine'])]).next
    const { events } = diffInbox(first, [pr(2, ['mine'], { checks: 'FAILURE' })])
    const p = runPrompt(a, 'acme/web#2 CI checks failed', events)
    expect(p).toContain('[Automation "Fix red CI" from Choo Choo, not from the person.')
    expect(p).toContain(`finding_id: ${events[0].key}`)
    expect(p).toContain('At most 3 this run')
  })
})

describe('runner', () => {
  const s = store.get()
  s.repos.push({ id: 'r1', name: 'web', path: '/x', defaultBranch: 'main' }, { id: 'r2', name: 'api', path: '/y', defaultBranch: 'main' })
  s.groups = [{ id: 'g1', name: 'Launch v2', repoIds: ['r1'], createdAt: 1 }]
  const chats: Chat[] = []
  const sent: [string, string][] = []
  let prs: InboxPr[] = []
  let items: Record<string, import('../src/shared/automations').RepoItem[]> = {}
  automations.init({
    chatFor: async (a) => {
      let c = chats.find((x) => x.automationId === a.id)
      if (!c) {
        c = { id: `c${chats.length + 1}`, workspaceId: 'o', title: a.name, model: 'opus', effort: 'high', status: 'idle', createdAt: 1, automationId: a.id }
        chats.push(c)
      }
      return c
    },
    send: (chat, text) => {
      chat.status = 'running'
      sent.push([chat.id, text])
    },
    isRunning: (id) => chats.find((c) => c.id === id)?.status === 'running',
    loadPrs: async () => prs,
    loadRepoItems: async (repoId) => ({ slug: repoId === 'r1' ? 'acme/web' : 'acme/api', items: items[repoId] ?? [] }),
    changed: () => {}
  })

  it('checks what the editor sends', () => {
    expect(() => automations.save({ name: '', prompt: 'x', trigger: { kind: 'manual' }, target: { kind: 'repo', repoId: 'r1' } })).toThrow(/name/)
    expect(() => automations.save({ name: 'x', prompt: 'x', trigger: { kind: 'manual' }, target: { kind: 'repo', repoId: 'nope' } })).toThrow(/where results go/)
    const a = automations.save({ name: 'Daily', prompt: 'x', trigger: { kind: 'daily', at: '09:00' }, target: { kind: 'project', groupId: 'g1' } })
    expect(a.maxFindings).toBe(5)
    expect(a.nextRunAt).toBeGreaterThan(Date.now())
    automations.remove(a.id)
  })

  it('caps a run and never opens a second workspace for the same finding', async () => {
    const a = automations.save({ name: 'Bugs', prompt: 'Find bugs', trigger: { kind: 'manual' }, target: { kind: 'repo', repoId: 'r1' }, maxFindings: 2 })
    const run = await automations.runNow(a.id)
    expect(run.status).toBe('running')
    const chat = chats.find((c) => c.id === run.chatId)!
    expect(sent.at(-1)![1]).toContain('Find bugs')
    const hooks = automations.hooksFor(chat)!
    const ws = (id: string) => ({ id }) as Workspace
    expect(hooks.claim('BUG-1')).toBeUndefined()
    hooks.record('BUG-1', 'Crash on save', ws('w1'))
    expect(hooks.claim('BUG-1')).toMatch(/already opened a workspace/)
    expect(hooks.claim('BUG-2')).toBeUndefined()
    // BUG-2 holds the last slot while its workspace is being made.
    expect(hooks.claim('BUG-3')).toMatch(/most it may/)
    hooks.release('BUG-2')
    expect(hooks.claim('BUG-3')).toBeUndefined()

    // A run while the last one is going is skipped.
    expect((await automations.runNow(a.id)).status).toBe('skipped')
    chat.status = 'idle'
    automations.onTurnDone(chat)
    const done = store.get().automationRuns!.find((r) => r.id === run.id)!
    expect(done).toMatchObject({ status: 'done', findings: [{ id: 'BUG-1', title: 'Crash on save', workspaceId: 'w1' }], skipped: 2 })

    // The next run still remembers BUG-1.
    await automations.runNow(a.id)
    expect(automations.hooksFor(chat)!.claim('BUG-1')).toMatch(/already opened/)
    chat.status = 'idle'
    automations.remove(a.id)
  })

  it('fires GitHub automations only for events in their repos', async () => {
    s.settings.experimentalProjects = true
    const a = automations.save({ name: 'Red CI', prompt: 'Fix CI', trigger: { kind: 'github', event: 'checks_failed' }, target: { kind: 'project', groupId: 'g1' } })
    prs = [pr(2, ['mine'], { repoId: 'r1' }), pr(5, ['mine'], { repo: 'acme/api', repoId: 'r2' })]
    await automations.pollGithub()
    const before = sent.length
    prs = [pr(2, ['mine'], { repoId: 'r1', checks: 'FAILURE' }), pr(5, ['mine'], { repo: 'acme/api', repoId: 'r2', checks: 'FAILURE' })]
    await automations.pollGithub()
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)![1]).toContain('acme/web#2')
    expect(sent.at(-1)![1]).not.toContain('acme/api#5')
    automations.remove(a.id)
  })

  it('fires on new issues in the target repos, only with the label', async () => {
    const item = (number: number, labels: string[], isPr = false) => ({ number, title: `Item ${number}`, url: `https://github.com/acme/web/issues/${number}`, author: 'sam', labels, isPr })
    const a = automations.save({ name: 'New bugs', prompt: 'Fix it', trigger: { kind: 'github', event: 'issue_opened', label: 'Bug' }, target: { kind: 'repo', repoId: 'r1' } })
    items = { r1: [item(10, ['bug'])] }
    await automations.pollGithub()
    const before = sent.length
    // 11 is a PR, 12 has no label, 13 is a new bug.
    items = { r1: [item(13, ['bug', 'ui']), item(12, []), item(11, ['bug'], true), item(10, ['bug'])] }
    await automations.pollGithub()
    expect(sent.length).toBe(before + 1)
    expect(sent.at(-1)![1]).toContain('acme/web#13')
    expect(sent.at(-1)![1]).not.toContain('acme/web#12')
    expect(sent.at(-1)![1]).not.toContain('acme/web#11')
    expect(store.get().githubWatch!.latest!.r1).toBe(13)
    automations.remove(a.id)
  })
})

describe('start_workspace in an automation run', () => {
  const sdk = {
    tool: (name: string, description: string, shape: object, handler: (a: unknown) => Promise<{ content: { text: string }[] }>) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: { name: string; tools: { name: string }[] }) => o
  } as never
  type Server = { mcpServers: Record<string, { tools: { name: string; shape: Record<string, unknown>; handler(a: unknown): Promise<{ content: { text: string }[] }> }[] }>; autoAllowTools: string[]; systemPrompt: { append: string } }

  it('takes a finding id, skips handled ones, and files the workspace under the run', async () => {
    const repo = orch.repoScope({ id: 'r9', name: 'svc', path: '/z', defaultBranch: 'main' })
    const handled = new Set(['OLD-1'])
    const recorded: string[] = []
    const run: import('../src/main/orchestrator').AutomationHooks = {
      name: 'Bugs',
      chatId: 'run-chat',
      maxFindings: 5,
      claim: (id) => (handled.has(id) ? 'already handled.' : undefined),
      release: () => {},
      record: (id) => void recorded.push(id)
    }
    const made: Workspace[] = []
    const host = {
      createWorkspace: async () => {
        const w = { id: 'w9', name: 'oslo', repoId: 'r9', branch: 'b', title: 't' } as Workspace
        made.push(w)
        return { workspace: w, chat: { id: 'wc' } as Chat }
      },
      sendToChat: () => {}
    } as never
    const o = orch.queryOptions(sdk, repo, host, [], undefined, run) as Server
    const start = o.mcpServers.choo.tools.find((t) => t.name === 'start_workspace')!
    expect(Object.keys(start.shape)).toContain('finding_id')
    expect(o.autoAllowTools).toContain('mcp__choo__start_workspace')
    expect(o.systemPrompt.append).toContain('This chat belongs to the automation "Bugs"')
    expect((await start.handler({ task: 'Fix it', finding_id: 'OLD-1' })).content[0].text).toBe('Skipped: already handled.')
    expect(made).toHaveLength(0)
    await start.handler({ task: 'Fix the crash', finding_id: 'NEW-2' })
    expect(made[0].threadId).toBe('run-chat')
    expect(recorded).toEqual(['NEW-2'])
    // Without an automation, start_workspace has no finding id.
    const plain = orch.queryOptions(sdk, repo, host, []) as Server
    expect(Object.keys(plain.mcpServers.choo.tools.find((t) => t.name === 'start_workspace')!.shape)).not.toContain('finding_id')
  })
})

describe('run marker', () => {
  it('splits the opening line off a run message', async () => {
    const { stripRunMarker } = await import('../src/shared/automations')
    const p = runPrompt({ name: 'X', prompt: 'Check things.', maxFindings: 1 } as Automation, 'Run now')
    expect(stripRunMarker(p)).toMatchObject({ reason: 'Run now' })
    expect(stripRunMarker(p).text.startsWith('Check things.')).toBe(true)
    expect(stripRunMarker('hello')).toEqual({ text: 'hello' })
  })
})
