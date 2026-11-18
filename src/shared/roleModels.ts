/**
 * Model and thinking level by role in a project: its orchestrator chat ("router"), its threads, and the
 * workspaces they start. Settings › General holds the defaults; each project can override them
 * (RepoGroup.models); each chat's own model menu changes that chat. See docs/prd/usage-savings.md.
 */
import type { Effort, ModelId, RepoGroup, Settings } from './types'

export type ModelRole = 'router' | 'thread' | 'workspace'

/** Unset fields fall through to the next level: project, then Settings for the role, then the default model. */
export interface ModelPick {
  model?: ModelId
  effort?: Effort
}

export type RoleModels = Partial<Record<ModelRole, ModelPick>>

export const MODEL_ROLES: { role: ModelRole; label: string; hint: string }[] = [
  { role: 'router', label: 'Project chat', hint: 'Sends each message to the right thread. Light work, so Sonnet at low effort is plenty.' },
  { role: 'thread', label: 'Threads', hint: 'Plans the work, writes tasks for workspaces and follows them to merge.' },
  { role: 'workspace', label: 'Workspaces threads start', hint: 'Does the coding. A thread can still pick another model for one task.' }
]

/** Out of the box the project chat routes on Sonnet at low effort; the rest use the default model. */
export const DEFAULT_ROLE_MODELS: RoleModels = { router: { model: 'sonnet', effort: 'low' } }

export function roleModels(s: Pick<Settings, 'roleModels'>): RoleModels {
  return s.roleModels ?? DEFAULT_ROLE_MODELS
}

/** The model and effort a new chat in this role starts on. Codex can't run orchestrator chats. */
export function pickFor(role: ModelRole, s: Pick<Settings, 'defaultModel' | 'defaultEffort' | 'roleModels'>, group?: Pick<RepoGroup, 'models'>): { model: ModelId; effort: Effort } {
  const own = group?.models?.[role]
  const app = roleModels(s)[role]
  let model = own?.model ?? app?.model ?? s.defaultModel
  if (model === 'codex' && role !== 'workspace') model = 'opus'
  return { model, effort: own?.effort ?? app?.effort ?? s.defaultEffort }
}

/** Keeps only known roles and values, dropping empty picks, for saving. */
export function cleanRoleModels(input: unknown, models: readonly string[], efforts: readonly string[]): RoleModels {
  const out: RoleModels = {}
  if (!input || typeof input !== 'object') return out
  for (const { role } of MODEL_ROLES) {
    const p = (input as Record<string, ModelPick | undefined>)[role]
    if (!p || typeof p !== 'object') continue
    const pick: ModelPick = {}
    if (typeof p.model === 'string' && models.includes(p.model)) pick.model = p.model
    if (typeof p.effort === 'string' && efforts.includes(p.effort)) pick.effort = p.effort
    if (pick.model || pick.effort) out[role] = pick
  }
  return out
}
