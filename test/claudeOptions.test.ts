import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyTaskEvent, budgetFor, chatSettings, goalCommand, goalFrom, listOutputStyles, permissionMode, questionReply, runningTasks } from '../src/main/claudeOptions'
import { alwaysAskNeedsOk, needsApproval } from '../src/main/agent'
import { codexEffort } from '../src/main/codex'
import { reportedFindings, findingsFromItems } from '../src/renderer/src/review'
import { DEFAULT_EXTRAS, type BackgroundTask, type ChatItem } from '../src/shared/types'

describe('permission modes', () => {
  it('maps each chat setting to an SDK mode', () => {
    expect(permissionMode({})).toBe('bypassPermissions')
    expect(permissionMode({ permission: 'full' })).toBe('bypassPermissions')
    expect(permissionMode({ permission: 'auto' })).toBe('auto')
    expect(permissionMode({ permission: 'edits' })).toBe('default')
    expect(permissionMode({ permission: 'auto', planMode: true })).toBe('plan')
  })
  it('asks in auto mode only for what the classifier escalates, never for read-only tools', () => {
    expect(needsApproval('auto', [], 'Read')).toBe(false)
    expect(needsApproval('auto', [], 'Bash')).toBe(true)
  })
})

describe('chat session settings', () => {
  it('passes nothing by default', () => {
    expect(chatSettings({}, DEFAULT_EXTRAS)).toEqual({ settings: undefined, env: {} })
  })
  it('combines fast mode, output style and the advisor', () => {
    expect(chatSettings({ fast: true, outputStyle: 'Explanatory' }, { ...DEFAULT_EXTRAS, claudeAdvisor: 'opus' }).settings).toEqual({
      advisorModel: 'opus',
      fastMode: true,
      outputStyle: 'Explanatory'
    })
    expect(chatSettings({}, { ...DEFAULT_EXTRAS, claudeAdvisor: 'off' }).env).toEqual({ CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1' })
  })
  it('uses the chat cap, then the default, and treats 0 as none', () => {
    expect(budgetFor({}, {})).toBeUndefined()
    expect(budgetFor({}, { defaultBudgetUsd: 5 })).toBe(5)
    expect(budgetFor({ budgetUsd: 2 }, { defaultBudgetUsd: 5 })).toBe(2)
    expect(budgetFor({ budgetUsd: 0 }, { defaultBudgetUsd: 5 })).toBeUndefined()
  })
  it('maps max effort to Codex xhigh', () => {
    expect(codexEffort('max')).toBe('xhigh')
    expect(codexEffort('high')).toBe('high')
  })
})

describe('/goal', () => {
  it('reads set, clear and status commands', () => {
    expect(goalCommand('/goal all tests pass')).toBe('all tests pass')
    expect(goalCommand('/goal clear')).toBeNull()
    expect(goalCommand('/goal Cancel')).toBeNull()
    expect(goalCommand('/goal')).toBeUndefined()
    expect(goalCommand('set a goal')).toBeUndefined()
  })
  it('reads active_goal messages', () => {
    expect(goalFrom(null)).toBeUndefined()
    expect(goalFrom({ condition: 'tests pass', set_at: 1, iterations: 2, last_reason: 'one fails' })).toEqual({ condition: 'tests pass', setAt: 1, iterations: 2, lastReason: 'one fails' })
  })
})

describe('background tasks', () => {
  it('tracks a task from start to finish and skips ambient ones', () => {
    const tasks = new Map<string, BackgroundTask>()
    expect(applyTaskEvent(tasks, { type: 'system', subtype: 'task_started', task_id: 'a', description: 'npm test', task_type: 'local_bash' })).toBe(true)
    expect(applyTaskEvent(tasks, { type: 'system', subtype: 'task_started', task_id: 'b', description: 'watch', ambient: true })).toBe(false)
    expect(runningTasks(tasks).map((t) => t.id)).toEqual(['a'])
    applyTaskEvent(tasks, { type: 'system', subtype: 'task_progress', task_id: 'a', summary: '12 passed' })
    expect(tasks.get('a')!.summary).toBe('12 passed')
    applyTaskEvent(tasks, { type: 'system', subtype: 'task_notification', task_id: 'a', status: 'completed', summary: 'done' })
    expect(runningTasks(tasks)).toEqual([])
    expect(applyTaskEvent(tasks, { type: 'assistant' })).toBe(false)
  })
})

describe('output styles', () => {
  it('lists built-ins, then user and project styles, project winning on a name clash', () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-home-'))
    const repo = mkdtempSync(join(tmpdir(), 'cc-repo-'))
    mkdirSync(join(home, '.claude', 'output-styles'), { recursive: true })
    mkdirSync(join(repo, '.claude', 'output-styles'), { recursive: true })
    writeFileSync(join(home, '.claude', 'output-styles', 'terse.md'), '---\nname: Terse\ndescription: Short answers\n---\nBe brief.')
    writeFileSync(join(repo, '.claude', 'output-styles', 'terse.md'), '---\nname: Terse\ndescription: Team version\n---\nBe brief.')
    writeFileSync(join(repo, '.claude', 'output-styles', 'pirate.md'), 'Talk like a pirate.')
    const styles = listOutputStyles(repo, home)
    expect(styles.map((s) => s.name)).toEqual(['Explanatory', 'Learning', 'Terse', 'pirate'])
    expect(styles.find((s) => s.name === 'Terse')).toMatchObject({ source: 'project', description: 'Team version' })
  })
})

describe('Claude Code /code-review findings', () => {
  it('reads the ReportFindings tool call', () => {
    const input = { findings: [{ file: './src/a.ts', line: 3, summary: 'Off by one.', failure_scenario: 'Empty list crashes.', verdict: 'CONFIRMED' }, { file: 'b.ts', summary: 'Maybe slow.' }] }
    expect(reportedFindings(input)).toEqual([
      { file: 'src/a.ts', line: 3, severity: 'high', message: 'Off by one. Empty list crashes.' },
      { file: 'b.ts', line: undefined, severity: 'low', message: 'Maybe slow.' }
    ])
    const items: ChatItem[] = [
      { id: '1', kind: 'user', text: '/code-review', ts: 1 },
      { id: '2', kind: 'tool', name: 'ReportFindings', input, ts: 2 }
    ]
    expect(findingsFromItems(items)).toHaveLength(2)
  })
})

describe('AskUserQuestion answers', () => {
  const input = { questions: [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }] }

  it('hands the picks back to Claude in answers', () => {
    expect(questionReply(input, 'allow', { 'Which color?': 'Blue' })).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Which color?': 'Blue' } } })
  })

  it('tells Claude the question was skipped', () => {
    expect(questionReply(input, 'deny', undefined).behavior).toBe('deny')
    expect(questionReply(input, 'allow', { 'Which color?': '  ' }).behavior).toBe('deny')
  })
})

describe('always-ask tools', () => {
  it('ask until the person picks Always allow for that tool in the chat', () => {
    expect(alwaysAskNeedsOk(undefined, 'mcp__choo__clone_repo')).toBe(true)
    expect(alwaysAskNeedsOk(['Bash'], 'mcp__choo__clone_repo')).toBe(true)
    expect(alwaysAskNeedsOk(['mcp__choo__clone_repo'], 'mcp__choo__clone_repo')).toBe(false)
  })
})
