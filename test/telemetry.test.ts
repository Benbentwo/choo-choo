import { describe, expect, it } from 'vitest'
import { DEFAULT_TELEMETRY, normalizeTelemetry, telemetryEnv } from '../src/shared/types'

const on = { ...DEFAULT_TELEMETRY, enabled: true }

describe('telemetryEnv', () => {
  it('is empty when off', () => {
    expect(telemetryEnv(DEFAULT_TELEMETRY)).toEqual({})
    expect(telemetryEnv({ ...on, endpoint: ' ' })).toEqual({})
    expect(telemetryEnv({ ...on, metrics: false, logs: false, traces: false })).toEqual({})
  })

  it('exports all three signals over OTLP with traces beta on', () => {
    const env = telemetryEnv(on)
    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_SERVICE_NAME: 'choo-choo'
    })
    expect(env.OTEL_LOG_USER_PROMPTS).toBeUndefined()
    expect(env.OTEL_LOG_TOOL_CONTENT).toBeUndefined()
    expect(Object.values(env)).not.toContain('console')
  })

  it('turns off single signals and the beta flag', () => {
    const env = telemetryEnv({ ...on, traces: false, logToolContent: true })
    expect(env.OTEL_TRACES_EXPORTER).toBe('none')
    expect(env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBeUndefined()
    // Tool content rides on spans, so it needs traces.
    expect(env.OTEL_LOG_TOOL_CONTENT).toBeUndefined()
  })

  it('encodes tags and appends user attributes', () => {
    const env = telemetryEnv({ ...on, resourceAttributes: 'team=platform, junk ,env=dev', headers: 'Authorization=Bearer x' }, { 'choo.repo': 'my repo', 'choo.branch': 'a,b', empty: '' })
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe('choo.repo=my%20repo,choo.branch=a%2Cb,team=platform,env=dev')
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Bearer x')
  })

  it('passes content opt-ins through', () => {
    const env = telemetryEnv({ ...on, logPrompts: true, logToolDetails: true, logToolContent: true })
    expect(env).toMatchObject({ OTEL_LOG_USER_PROMPTS: '1', OTEL_LOG_TOOL_DETAILS: '1', OTEL_LOG_TOOL_CONTENT: '1' })
  })

  it('fills missing fields from defaults', () => {
    expect(normalizeTelemetry(undefined)).toEqual(DEFAULT_TELEMETRY)
    expect(normalizeTelemetry({ enabled: true }).endpoint).toBe('http://localhost:4318')
  })
})

import { telemetryTags } from '../src/shared/projects'
import type { Chat, Workspace } from '../src/shared/types'

describe('telemetryTags', () => {
  const repos = [{ id: 'r1', name: 'web-app', path: '/r', defaultBranch: 'main' }]
  const groups = [{ id: 'g1', name: 'Search revamp', repoIds: ['r1'], createdAt: 0 }]
  const ws = (w: Partial<Workspace>): Workspace => ({ id: 'w', repoId: 'r1', name: 'lisbon', branch: 'add-search', baseRef: 'main', path: '/w', title: 't', createdAt: 0, ...w })
  const chat = (c: Partial<Chat>): Chat => ({ id: 'c', workspaceId: 'orch', title: 'Orchestrator', model: 'opus', effort: 'high', status: 'idle', createdAt: 0, ...c })
  const orch = ws({ id: 'orch', name: 'orchestrator', branch: 'main', orchestrator: true, groupId: 'g1' })
  const thread = chat({ id: 't1', title: 'Search box', thread: true })
  const work = ws({ id: 'w1', orchestrated: true, orchestratorId: 'g1', threadId: 't1' })
  const s = { repos, groups, workspaces: [orch, work], chats: [chat({ id: 'router' }), thread] }

  it('tags a plain workspace with repo, workspace and branch only', () => {
    expect(telemetryTags(ws({}), undefined, s)).toEqual({ 'choo.repo': 'web-app', 'choo.workspace': 'lisbon', 'choo.branch': 'add-search' })
  })

  it('adds the project to its orchestrator chat, and the thread to a thread', () => {
    expect(telemetryTags(orch, s.chats[0], s)).toEqual({ 'choo.repo': 'web-app', 'choo.workspace': 'orchestrator', 'choo.branch': 'main', 'choo.project': 'Search revamp' })
    expect(telemetryTags(orch, thread, s)['choo.thread']).toBe('Search box')
  })

  it('tags a workspace a thread started with its project and thread', () => {
    expect(telemetryTags(work, undefined, s)).toMatchObject({ 'choo.project': 'Search revamp', 'choo.thread': 'Search box' })
  })

  it('works without groups', () => {
    expect(telemetryTags(work, undefined, { ...s, groups: undefined })['choo.project']).toBeUndefined()
  })
})
