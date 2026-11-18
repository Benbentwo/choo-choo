import type { Effort, ModelDetails, ModelId } from '@shared/types'
import { MODEL_ROLES, type ModelPick, type ModelRole, type RoleModels } from '@shared/roleModels'
import { modelLabel } from '../store'
import { EFFORT_LABEL, EFFORTS, MODELS } from './Composer'

const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'

/**
 * Model and effort pickers for a project's chat, threads and workspaces. An empty choice inherits:
 * `inherited` says what each role falls back to, shown in the empty option.
 */
export function RoleModelPickers({
  value,
  inherited,
  inheritLabel,
  onChange,
  details,
  compact
}: {
  value: RoleModels
  inherited: Record<ModelRole, { model: ModelId; effort: Effort }>
  inheritLabel: string
  onChange: (next: RoleModels) => void
  details: Partial<Record<ModelId, ModelDetails>>
  compact?: boolean
}) {
  const set = (role: ModelRole, patch: ModelPick) => {
    const pick = { ...value[role], ...patch }
    if (!pick.model) delete pick.model
    if (!pick.effort) delete pick.effort
    const next = { ...value, [role]: pick }
    if (!pick.model && !pick.effort) delete next[role]
    onChange(next)
  }
  return (
    <div className={compact ? 'space-y-2' : ''}>
      {MODEL_ROLES.map(({ role, label, hint }) => (
        <div key={role} className={compact ? 'flex items-center gap-2' : 'flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0'}>
          <div className="flex-1">
            <div className={compact ? 'text-[12.5px]' : ''}>{label}</div>
            {!compact && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
          </div>
          <select aria-label={`${label} model`} className={select} value={value[role]?.model ?? ''} onChange={(e) => set(role, { model: (e.target.value || undefined) as ModelId | undefined })}>
            <option value="">
              {inheritLabel} ({modelLabel(inherited[role].model, details)})
            </option>
            {MODELS.filter((m) => role === 'workspace' || m.id !== 'codex').map((m) => (
              <option key={m.id} value={m.id}>
                {modelLabel(m.id, details)}
              </option>
            ))}
          </select>
          <select aria-label={`${label} thinking`} className={select} value={value[role]?.effort ?? ''} onChange={(e) => set(role, { effort: (e.target.value || undefined) as Effort | undefined })}>
            <option value="">
              {inheritLabel} ({EFFORT_LABEL[inherited[role].effort]})
            </option>
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {EFFORT_LABEL[x]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
