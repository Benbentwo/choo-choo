// Reads Conductor's local database (read-only, from a temporary copy) and maps it onto Choo Choo's state.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatItem, Effort, ImportPreview, ModelId, Scripts } from '@shared/types'

export const CONDUCTOR_DB = join(homedir(), 'Library', 'Application Support', 'com.conductor.app', 'conductor.db')

export interface CRepo {
  id: string
  name: string
  root_path: string
  default_branch: string | null
  hidden: number | null
  setup_script: string | null
  run_script: string | null
  archive_script: string | null
}
export interface CWorkspace {
  id: string
  repository_id: string
  directory_name: string
  workspace_name: string | null
  pr_title: string | null
  branch: string | null
  state: string | null
  workspace_path: string | null
  intended_target_branch: string | null
  created_at: string
}
export interface CSession {
  id: string
  workspace_id: string
  title: string | null
  model: string | null
  agent_type: string | null
  claude_effort_level: string | null
  permission_mode: string | null
  claude_session_id: string | null
  is_hidden: number | null
  created_at: string
}
export interface CMessage {
  session_id: string
  role: string
  content: string | null
  created_at: string
}
export interface ConductorData {
  repos: CRepo[]
  workspaces: CWorkspace[]
  sessions: CSession[]
  settings: Record<string, string>
}

type Db = { prepare(sql: string): { all(...a: unknown[]): unknown[] }; close(): void }

/** Opens a temporary copy of Conductor's database so Conductor's own file is never touched or locked. */
export async function withConductorDb<T>(dbPath: string, fn: (db: Db) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'choo-conductor-'))
  let db: Db | null = null
  try {
    const copy = join(dir, 'conductor.db')
    copyFileSync(dbPath, copy)
    for (const ext of ['-wal', '-shm']) if (existsSync(dbPath + ext)) copyFileSync(dbPath + ext, copy + ext)
    const { DatabaseSync } = (await import('node:sqlite')) as unknown as { DatabaseSync: new (p: string) => Db }
    db = new DatabaseSync(copy)
    return await fn(db)
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

export function readConductor(db: Db): ConductorData {
  const all = <T>(sql: string) => db.prepare(sql).all() as T[]
  const settings: Record<string, string> = {}
  for (const r of all<{ key: string; value: string }>('select key, value from settings')) settings[r.key] = r.value
  return {
    repos: all<CRepo>('select id, name, root_path, default_branch, hidden, setup_script, run_script, archive_script from repos'),
    workspaces: all<CWorkspace>(
      "select coalesce(id, local_id) as id, repository_id, directory_name, workspace_name, pr_title, branch, state, workspace_path, intended_target_branch, created_at from workspaces"
    ),
    sessions: all<CSession>(
      'select id, workspace_id, title, model, agent_type, claude_effort_level, permission_mode, claude_session_id, is_hidden, created_at from sessions order by created_at'
    ),
    settings
  }
}

export function readMessages(db: Db, sessionId: string): CMessage[] {
  return db.prepare('select session_id, role, content, created_at from session_messages where session_id = ? order by created_at, rowid').all(sessionId) as CMessage[]
}

export function mapModel(model: string | null, agent: string | null): ModelId {
  const m = (model ?? '').toLowerCase()
  if (agent === 'codex' || m.includes('codex') || m.startsWith('gpt')) return 'codex'
  if (m.includes('fable')) return 'fable'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return 'opus'
}

export function mapEffort(level: string | null, fallback: Effort): Effort {
  return level === 'low' || level === 'medium' || level === 'high' ? level : fallback
}

export function repoScripts(r: CRepo): Scripts | undefined {
  const s: Scripts = {}
  if (r.setup_script?.trim()) s.setup = r.setup_script
  if (r.run_script?.trim()) s.run = r.run_script
  if (r.archive_script?.trim()) s.archive = r.archive_script
  return Object.keys(s).length ? s : undefined
}

const ts = (s: string) => {
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`)
  return Number.isFinite(t) ? t : Date.now()
}

function stringify(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((b) => (b?.type === 'text' ? b.text : '')).join('')
  return content == null ? '' : JSON.stringify(content)
}

/** Turns Conductor's stored messages (user text plus raw Agent SDK messages) into chat items. */
export function convertMessages(rows: CMessage[]): ChatItem[] {
  const out: ChatItem[] = []
  const tools = new Map<string, Extract<ChatItem, { kind: 'tool' }>>()
  for (const row of rows) {
    const at = ts(row.created_at)
    if (row.role === 'user') {
      if (row.content?.trim()) out.push({ id: randomUUID(), kind: 'user', text: row.content, ts: at })
      continue
    }
    let msg: any
    try {
      msg = JSON.parse(row.content ?? '')
    } catch {
      continue
    }
    if (msg?.type === 'assistant') {
      for (const b of msg.message?.content ?? []) {
        if (b.type === 'text' && b.text) out.push({ id: randomUUID(), kind: 'assistant', text: b.text, ts: at })
        else if (b.type === 'tool_use') {
          const item: Extract<ChatItem, { kind: 'tool' }> = { id: b.id ?? randomUUID(), kind: 'tool', name: b.name, input: b.input, ts: at }
          tools.set(item.id, item)
          out.push(item)
        }
      }
    } else if (msg?.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const b of msg.message.content) {
        const t = b.type === 'tool_result' ? tools.get(b.tool_use_id) : undefined
        if (!t) continue
        t.result = stringify(b.content).slice(0, 20000)
        t.isError = !!b.is_error
      }
    } else if (msg?.type === 'result') {
      out.push({ id: randomUUID(), kind: 'result', ok: msg.subtype === 'success' && !msg.is_error, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns, ts: at })
    } else if (msg?.type === 'error') {
      out.push({ id: randomUUID(), kind: 'error', text: stringify(msg.error ?? msg.message ?? 'Error'), ts: at })
    }
  }
  return out
}

/** Active workspaces whose folder still exists, with their repo and visible chats. */
export function activeWorkspaces(data: ConductorData, exists: (p: string) => boolean = existsSync) {
  return data.workspaces
    .filter((w) => w.state !== 'archived' && w.workspace_path && exists(w.workspace_path))
    .map((w) => ({ ws: w, repo: data.repos.find((r) => r.id === w.repository_id), sessions: data.sessions.filter((s) => s.workspace_id === w.id && !s.is_hidden) }))
    .filter((x): x is typeof x & { repo: CRepo } => !!x.repo)
}

/** The folder Conductor puts workspaces in, from where existing ones live (…/workspaces/<repo>/<name>). */
export function workspacesRootOf(data: ConductorData): string | undefined {
  const counts = new Map<string, number>()
  for (const w of data.workspaces) if (w.workspace_path) counts.set(dirname(dirname(w.workspace_path)), (counts.get(dirname(dirname(w.workspace_path))) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export function preview(
  data: ConductorData,
  have: { repoPaths: string[]; workspacePaths: string[] },
  exists: (p: string) => boolean = existsSync
): ImportPreview {
  const active = activeWorkspaces(data, exists)
  const s = data.settings
  const settings: ImportPreview['settings'] = []
  if (s.default_model) settings.push({ label: 'Default model', value: mapModel(s.default_model, null) })
  if (s.branch_prefix_type) settings.push({ label: 'Branch prefix', value: s.branch_prefix_type === 'github_username' ? 'GitHub username' : s.branch_prefix_type })
  return {
    found: true,
    repos: data.repos.map((r) => ({
      name: r.name,
      path: r.root_path,
      status: have.repoPaths.includes(r.root_path) ? 'already' : exists(r.root_path) ? 'new' : 'missing',
      hasScripts: !!repoScripts(r)
    })),
    workspaces: active.map(({ ws, repo, sessions }) => ({
      repo: repo.name,
      name: ws.workspace_name || ws.pr_title || ws.directory_name,
      branch: ws.branch ?? '',
      path: ws.workspace_path!,
      chats: sessions.length,
      status: have.workspacePaths.includes(ws.workspace_path!) ? 'already' : 'new'
    })),
    archivedSkipped: data.workspaces.filter((w) => w.state === 'archived').length,
    settings,
    workspacesRoot: workspacesRootOf(data)
  }
}
