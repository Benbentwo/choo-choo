import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { convertMessages, mapEffort, mapModel, preview, readConductor, readMessages, withConductorDb, workspacesRootOf, type CMessage } from '../src/main/conductorImport'

const sdk = (m: unknown) => JSON.stringify(m)

describe('convertMessages', () => {
  it('turns user text and Agent SDK messages into chat items', () => {
    const rows: CMessage[] = [
      { session_id: 's', role: 'user', content: 'fix the bug', created_at: '2026-01-01 10:00:00' },
      { session_id: 's', role: 'assistant', content: sdk({ type: 'system', subtype: 'init' }), created_at: '2026-01-01 10:00:01' },
      {
        session_id: 's',
        role: 'assistant',
        content: sdk({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }] } }),
        created_at: '2026-01-01 10:00:02'
      },
      { session_id: 's', role: 'assistant', content: sdk({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }] } }), created_at: '2026-01-01 10:00:03' },
      { session_id: 's', role: 'assistant', content: sdk({ type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 2 }), created_at: '2026-01-01 10:00:04' },
      { session_id: 's', role: 'assistant', content: 'not json', created_at: '2026-01-01 10:00:05' }
    ]
    const items = convertMessages(rows)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'result'])
    expect(items[2]).toMatchObject({ name: 'Read', result: 'file body', isError: false })
    expect(items[0].ts).toBe(Date.parse('2026-01-01T10:00:00Z'))
  })
})

describe('mapping', () => {
  it('maps Conductor model ids', () => {
    expect(mapModel('opus-5-1m', 'claude')).toBe('opus')
    expect(mapModel('sonnet-5-1m', 'claude')).toBe('sonnet')
    expect(mapModel('gpt-5.3-codex', 'codex')).toBe('codex')
    expect(mapModel('claude:opus-5-1m', null)).toBe('opus')
    expect(mapEffort('high', 'low')).toBe('high')
    expect(mapEffort(null, 'medium')).toBe('medium')
  })
})

describe('reading a Conductor database', () => {
  it('previews repos and active workspaces from a copy of the db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdb-test-'))
    try {
      const path = join(dir, 'conductor.db')
      const db = new DatabaseSync(path)
      db.exec(`
        create table repos (id text, name text, root_path text, default_branch text, hidden integer, setup_script text, run_script text, archive_script text);
        create table workspaces (local_id text, id text, repository_id text, directory_name text, workspace_name text, pr_title text, branch text, state text, workspace_path text, intended_target_branch text, created_at text);
        create table sessions (id text, workspace_id text, title text, model text, agent_type text, claude_effort_level text, permission_mode text, claude_session_id text, is_hidden integer, created_at text);
        create table session_messages (session_id text, role text, content text, created_at text);
        create table settings (key text, value text);
        insert into repos values ('r1', 'app', '/code/app', 'main', 0, 'npm i', null, null), ('r2', 'gone', '/code/gone', 'main', 0, null, null, null);
        insert into workspaces values ('w1', 'w1', 'r1', 'oslo', 'Fix login', null, 'me/fix-login', 'ready', '/ws/app/oslo', 'main', '2026-01-01 00:00:00'),
                                      ('w2', 'w2', 'r1', 'rome', null, null, 'me/old', 'archived', '/ws/app/rome', 'main', '2026-01-01 00:00:00');
        insert into sessions values ('s1', 'w1', 'Login', 'opus', 'claude', 'high', 'default', 'cs-1', 0, '2026-01-01 00:00:00'),
                                    ('s2', 'w1', 'hidden', 'opus', 'claude', null, 'default', null, 1, '2026-01-01 00:00:00');
        insert into session_messages values ('s1', 'user', 'hello', '2026-01-01 00:00:01');
        insert into settings values ('default_model', 'sonnet'), ('branch_prefix_type', 'github_username');
      `)
      db.close()
      const exists = (p: string) => ['/code/app', '/ws/app/oslo'].includes(p)
      const { data, msgs } = await withConductorDb(path, (d) => ({ data: readConductor(d), msgs: readMessages(d, 's1') }))
      expect(msgs).toHaveLength(1)
      expect(workspacesRootOf(data)).toBe('/ws')
      const p = preview(data, { repoPaths: [], workspacePaths: [] }, exists)
      expect(p.repos).toEqual([
        { name: 'app', path: '/code/app', status: 'new', hasScripts: true },
        { name: 'gone', path: '/code/gone', status: 'missing', hasScripts: false }
      ])
      expect(p.workspaces).toEqual([{ repo: 'app', name: 'Fix login', branch: 'me/fix-login', path: '/ws/app/oslo', chats: 1, status: 'new' }])
      expect(p.archivedSkipped).toBe(1)
      expect(p.settings[0]).toEqual({ label: 'Default model', value: 'sonnet' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
