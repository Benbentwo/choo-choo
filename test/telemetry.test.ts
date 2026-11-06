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
