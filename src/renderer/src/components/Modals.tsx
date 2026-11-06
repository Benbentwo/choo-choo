import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtraAgentId, Extras, GithubRepo, ImportPreview, ImportResult, ModelId, PromptCustom, Settings, Telemetry } from '@shared/types'
import { IconFolder, IconLock } from '../icons'
import { useStore, openGroupOrchestrator, addRepository, newWorkspace, newChatTab, refreshState, reportError, goToNextUnread, modelLabel } from '../store'
import { EFFORT_LABEL, EFFORTS, MODELS, PERMISSIONS } from './Composer'
import { rank } from '../autocomplete'
import { QuickStartModalBody } from './AddProject'
import { AppearanceSettings } from './Appearance'
import { IntegrationsSettings } from './Integrations'
import { McpSettings } from './McpSettings'
import { PluginSettings } from './PluginSettings'
import { OpenShareModal, ShareModal } from './ShareModals'
import { CommandPalette } from './CommandPalette'
import { UsageGraphs } from './UsageGraphs'

function Shell({ children, onClose, width = 'w-[560px]' }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="anim-backdrop fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div className={`anim-pop ${width} max-w-[92vw] rounded-xl border border-line bg-panel shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Modals() {
  const modal = useStore((s) => s.modal)
  const close = () => useStore.getState().set({ modal: null })
  if (modal === 'settings') return <SettingsModal onClose={close} />
  if (modal === 'palette') return <CommandPalette onClose={close} />
  if (modal === 'create') return <CreateModal onClose={close} />
  if (modal === 'conductor') return <ConductorImportModal onClose={close} />
  if (modal === 'quickstart')
    return (
      <Shell onClose={close} width="w-[480px]">
        <QuickStartModalBody onClose={close} />
      </Shell>
    )
  if (modal === 'open-share') return <OpenShareModal onClose={close} />
  if (modal === 'share') return <ShareFor onClose={close} />
  if (modal === 'usage') return <UsageFor onClose={close} />
  if (modal === 'group') return <GroupModal onClose={close} />
  return null
}

/** Create or edit a project group: a name and the repos its orchestrator directs. */
function GroupModal({ onClose }: { onClose: () => void }) {
  const repos = useStore((s) => s.repos)
  const existing = useStore((s) => s.groups.find((g) => g.id === s.editGroup))
  const [name, setName] = useState(existing?.name ?? '')
  const [picked, setPicked] = useState<string[]>(existing?.repoIds ?? [])
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const submit = async () => {
    setBusy(true)
    try {
      const g = await window.api.saveGroup({ id: existing?.id, name, repoIds: picked })
      await refreshState()
      onClose()
      if (!existing) await openGroupOrchestrator(g.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!existing) return
    try {
      await window.api.deleteGroup(existing.id)
      await refreshState()
      onClose()
    } catch (e) {
      reportError(e)
    }
  }
  return (
    <Shell onClose={onClose} width="w-[460px]">
      <div className="border-b border-line px-5 py-3 font-medium">{existing ? 'Edit project group' : 'New project group'}</div>
      <div className="space-y-4 px-5 py-4">
        <div className="text-[12px] text-muted">
          A project group gives several repositories one orchestrator and one shared memory. It starts workspaces in whichever repo each piece of work belongs to.
        </div>
        <input
          autoFocus
          className="w-full rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-accent"
          placeholder="Name, e.g. Storefront"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && picked.length && void submit()}
        />
        <div className="max-h-64 overflow-y-auto rounded-md border border-line">
          {repos.length === 0 && <div className="px-3 py-2 text-faint">Add a repository first.</div>}
          {repos.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 last:border-0 hover:bg-hover">
              <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
              <span className="flex-1 truncate">{r.name}</span>
              {picked[0] === r.id && <span className="text-[11px] text-faint">runs here</span>}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {existing && (
          <button className="rounded-md px-2.5 py-1 text-del hover:bg-hover" onClick={() => void remove()}>
            Delete group
          </button>
        )}
        <div className="flex-1" />
        <button className="rounded-md px-2.5 py-1 hover:bg-hover" onClick={onClose}>
          Cancel
        </button>
        <button className="rounded-md bg-fg px-3 py-1 font-medium text-bg disabled:opacity-40" disabled={busy || !name.trim() || !picked.length} onClick={() => void submit()}>
          {existing ? 'Save' : 'Create and open orchestrator'}
        </button>
      </div>
    </Shell>
  )
}

function UsageFor({ onClose }: { onClose: () => void }) {
  const chat = useStore((s) => s.chats.find((c) => c.id === s.usageChat))
  if (!chat) return null
  return (
    <Shell onClose={onClose} width="w-[780px]">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="font-medium">Session usage</span>
        <span className="truncate text-faint">{chat.title}</span>
      </div>
      <UsageGraphs chat={chat} />
    </Shell>
  )
}

function ShareFor({ onClose }: { onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWs))
  return ws ? <ShareModal ws={ws} onClose={onClose} /> : null
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex-1">
        <div>{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const modelDetails = useStore((s) => s.modelDetails)
  const save = async (patch: Partial<Settings>) => {
    useStore.getState().set({ settings: await window.api.saveSettings(patch) })
  }
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  const [tab, setTab] = useState<'general' | 'agents' | 'prompts' | 'mcp' | 'plugins' | 'integrations' | 'telemetry' | 'appearance'>(() => useStore.getState().settingsTab)
  useEffect(() => () => useStore.getState().set({ settingsTab: 'general' }), [])
  return (
    <Shell onClose={onClose} width="w-[620px]">
      <div className="flex items-center gap-4 border-b border-line px-5 pt-3">
        <div className="pb-3 font-medium">Settings</div>
        <div className="ml-auto flex gap-1">
          {(['general', 'agents', 'prompts', 'mcp', 'plugins', 'integrations', 'telemetry', 'appearance'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-2.5 pb-2.5 capitalize ${tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {t === 'mcp' ? 'MCP' : t}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {tab === 'appearance' ? (
          <AppearanceSettings />
        ) : tab === 'integrations' ? (
          <IntegrationsSettings />
        ) : tab === 'mcp' ? (
          <McpSettings />
        ) : tab === 'plugins' ? (
          <PluginSettings />
        ) : tab === 'prompts' ? (
          <PromptsSection global={settings.systemPrompt} saveGlobal={(systemPrompt) => void save({ systemPrompt })} />
        ) : tab === 'telemetry' ? (
          <TelemetrySection t={settings.telemetry} save={(patch) => void save({ telemetry: { ...settings.telemetry, ...patch } })} />
        ) : tab === 'agents' ? (
          <ExtrasSection extras={settings.extras} save={(patch) => void save({ extras: { ...settings.extras, ...patch } })} />
        ) : (
          <>
            <Row label="Default model" hint={modelDetails[settings.defaultModel]?.description}>
              <select className={select} value={settings.defaultModel} onChange={(e) => void save({ defaultModel: e.target.value as Settings['defaultModel'] })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelLabel(m.id, modelDetails)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Default effort">
              <select className={select} value={settings.defaultEffort} onChange={(e) => void save({ defaultEffort: e.target.value as Settings['defaultEffort'] })}>
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABEL[e]}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Default permissions" hint="Full access runs agents unattended, like Conductor. Auto lets Claude Code's classifier approve safe tool calls and block risky ones. The others ask before tools that change things.">
              <select className={select} value={settings.defaultPermission} onChange={(e) => void save({ defaultPermission: e.target.value as Settings['defaultPermission'] })}>
                {PERMISSIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Spend cap per message" hint="Claude chats stop a message's run once it has cost this many dollars. Change it per chat in the model menu. Empty means no cap.">
              <input
                type="number"
                min={0}
                className={`${select} w-24`}
                defaultValue={settings.defaultBudgetUsd || ''}
                placeholder="none"
                onBlur={(e) => void save({ defaultBudgetUsd: Number(e.target.value) || 0 })}
              />
            </Row>
            <Row label="Branch prefix" hint="New workspaces branch as prefix/name. Empty uses your GitHub username.">
              <input className={`${select} w-44`} defaultValue={settings.branchPrefix} placeholder="auto" onBlur={(e) => void save({ branchPrefix: e.target.value })} />
            </Row>
            <Row label="Claude Code" hint="Which Claude Code runs your agents. Your installed copy uses its own updates and settings. Falls back to the bundled one if it isn't found.">
              <select className={select} value={settings.claudeBinary} onChange={(e) => void save({ claudeBinary: e.target.value as Settings['claudeBinary'] })}>
                <option value="bundled">Bundled with the app</option>
                <option value="installed">My installed claude</option>
              </select>
            </Row>
            <Row label="Anthropic API key" hint="Optional. Without one, agents use your own Claude login: run claude in Terminal and type /login to sign in.">
              <input type="password" className={`${select} w-44`} defaultValue={settings.anthropicApiKey} placeholder="sk-ant-…" onBlur={(e) => void save({ anthropicApiKey: e.target.value })} />
            </Row>
            <Row label="Notifications" hint="Notify when an agent finishes while the app is in the background.">
              <input type="checkbox" checked={settings.notifications} onChange={(e) => void save({ notifications: e.target.checked })} />
            </Row>
            <Row label="Orchestrator updates" hint="When a workspace the orchestrator started finishes, wake the orchestrator so it checks the work and reports back.">
              <input type="checkbox" checked={settings.orchestratorAutoUpdates} onChange={(e) => void save({ orchestratorAutoUpdates: e.target.checked })} />
            </Row>
            <Row label="Workspaces folder" hint="Where new workspaces are created. Empty uses ~/choo-choo/workspaces.">
              <input className={`${select} w-44`} defaultValue={settings.workspacesRoot ?? ''} placeholder="~/choo-choo/workspaces" onBlur={(e) => void save({ workspacesRoot: e.target.value })} />
            </Row>
            <Row label="Import from Conductor" hint="Bring over your projects, open workspaces, chats and settings. Conductor's own data is only read, never changed.">
              <button className="rounded-md border border-line px-2.5 py-1 hover:bg-hover" onClick={() => useStore.getState().set({ modal: 'conductor' })}>
                Import…
              </button>
            </Row>
            <Row label="Delete archived workspaces after" hint="Archived worktrees, with their uncommitted files, are kept in ~/choo-choo/archive until then. The branch and chat history are never deleted, so you can still restore.">
              <select className={select} value={settings.archiveRetentionDays} onChange={(e) => void save({ archiveRetentionDays: Number(e.target.value) })}>
                {RETENTION.map(([d, label]) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}
      </div>
    </Shell>
  )
}

const EMPTY_PROMPT: PromptCustom = { mode: 'append', text: '' }

/** One prompt editor: append to or replace Claude Code's system prompt. */
function PromptEditor({ value, save, scope }: { value?: PromptCustom; save: (p: PromptCustom) => void; scope: 'global' | 'repo' }) {
  const [draft, setDraft] = useState<PromptCustom>(value ?? EMPTY_PROMPT)
  const field = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  const commit = (p: PromptCustom) => {
    setDraft(p)
    save(p)
  }
  return (
    <div className="px-5 py-3.5">
      <div className="mb-2 flex items-center gap-3">
        <select className={field} value={draft.mode} onChange={(e) => commit({ ...draft, mode: e.target.value as PromptCustom['mode'] })}>
          <option value="append">Add to Claude Code's prompt</option>
          <option value="replace">Replace Claude Code's prompt</option>
        </select>
        <span className="text-[12px] text-faint">
          {draft.mode === 'append'
            ? scope === 'global'
              ? 'Keeps Claude Code\'s tools guidance and safety rules.'
              : 'Added after your global instructions.'
            : scope === 'global'
              ? 'Sends only your text. A repo prompt is added after it.'
              : 'Sends only this text in this repo, ignoring the global one.'}
        </span>
      </div>
      {draft.mode === 'replace' && (
        <div className="mb-2 rounded-md border border-line bg-raised px-3 py-2 text-[12px] text-muted">
          Replacing drops Claude Code's guidance on tools, git and safety, so the agent only knows what you write here. CLAUDE.md files, skills and subagents still load.
        </div>
      )}
      <textarea
        className={`${field} h-40 w-full resize-y font-mono text-[12px] leading-relaxed`}
        value={draft.text}
        placeholder={draft.mode === 'append' ? 'e.g. Write tests with vitest. Keep commits small and explain why in the message.' : 'You are a coding agent working in a git worktree…'}
        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        onBlur={() => save(draft)}
      />
    </div>
  )
}

function PromptsSection({ global, saveGlobal }: { global?: PromptCustom; saveGlobal: (p: PromptCustom) => void }) {
  const repos = useStore((s) => s.repos)
  const [repoId, setRepoId] = useState(() => {
    const s = useStore.getState()
    return s.workspaces.find((w) => w.id === s.selectedWs)?.repoId ?? repos[0]?.id ?? ''
  })
  const repo = repos.find((r) => r.id === repoId)
  const saveRepo = (p: PromptCustom) => {
    if (!repo) return
    const systemPrompt = p.text.trim() ? p : undefined
    void window.api.setRepoPrompt(repo.id, systemPrompt).then(() =>
      useStore.getState().set({ repos: useStore.getState().repos.map((r) => (r.id === repo.id ? { ...r, systemPrompt } : r)) })
    )
  }
  return (
    <>
      <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">
        Instructions for Claude agents. Changes apply to new chats; a chat keeps the prompt it started with. For instructions you want in git, use the repo's CLAUDE.md instead.
      </div>
      <div className="px-5 pt-3.5 font-medium">All repos</div>
      <PromptEditor value={global} save={saveGlobal} scope="global" />
      <div className="flex items-center gap-3 border-t border-line px-5 pt-3.5">
        <div className="font-medium">This repo</div>
        {repos.length > 0 && (
          <select className="ml-auto rounded-md border border-line bg-bg px-2 py-1 outline-none" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {repo ? <PromptEditor key={repo.id} value={repo.systemPrompt} save={saveRepo} scope="repo" /> : <div className="px-5 py-3.5 text-faint">Add a repository first.</div>}
    </>
  )
}

function TelemetrySection({ t, save }: { t: Telemetry; save: (patch: Partial<Telemetry>) => void }) {
  const input = 'w-56 rounded-md border border-line bg-bg px-2 py-1 outline-none'
  const check = (k: 'metrics' | 'logs' | 'traces' | 'logPrompts' | 'logToolDetails' | 'logToolContent') => (
    <input type="checkbox" checked={t[k]} onChange={(e) => save({ [k]: e.target.checked })} />
  )
  return (
    <>
      <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">
        Send OpenTelemetry metrics, events and traces from Claude agents to any OTLP collector, such as Honeycomb, Datadog, Grafana or a local collector. Each export is tagged with choo.repo, choo.workspace and choo.branch. Applies from the next message you send.
      </div>
      <Row label="Export telemetry" hint="Off by default. Export errors never stop the agent.">
        <input type="checkbox" checked={t.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
      </Row>
      {t.enabled && (
        <>
          <Row label="Endpoint" hint="OTLP base URL. HTTP usually listens on port 4318, gRPC on 4317.">
            <input key={`e${t.endpoint}`} className={input} defaultValue={t.endpoint} placeholder="http://localhost:4318" onBlur={(e) => save({ endpoint: e.target.value.trim() })} />
          </Row>
          <Row label="Protocol">
            <select className="rounded-md border border-line bg-bg px-2 py-1 outline-none" value={t.protocol} onChange={(e) => save({ protocol: e.target.value as Telemetry['protocol'] })}>
              <option value="http/protobuf">HTTP (protobuf)</option>
              <option value="http/json">HTTP (JSON)</option>
              <option value="grpc">gRPC</option>
            </select>
          </Row>
          <Row label="Headers" hint="Sent with every export, for auth. Comma-separated key=value pairs.">
            <input key={`h${t.headers}`} type="password" className={input} defaultValue={t.headers} placeholder="Authorization=Bearer …" onBlur={(e) => save({ headers: e.target.value })} />
          </Row>
          <Row label="Service name" hint="Reported as service.name.">
            <input key={`s${t.serviceName}`} className={input} defaultValue={t.serviceName} placeholder="choo-choo" onBlur={(e) => save({ serviceName: e.target.value })} />
          </Row>
          <Row label="Resource attributes" hint="Extra tags on everything exported, e.g. team=platform,env=dev.">
            <input key={`r${t.resourceAttributes}`} className={input} defaultValue={t.resourceAttributes} placeholder="key=value,key2=value2" onBlur={(e) => save({ resourceAttributes: e.target.value })} />
          </Row>
          <Row label="Metrics" hint="Counters for tokens, cost, sessions, lines changed and tool decisions.">
            {check('metrics')}
          </Row>
          <Row label="Log events" hint="A record for each prompt, API request, API error and tool result.">
            {check('logs')}
          </Row>
          <Row label="Traces" hint="Spans for each turn, model request and tool call, with subagents nested under their parent. Beta in Claude Code.">
            {check('traces')}
          </Row>
          <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">Content. By default only structure is exported, never what the agent reads or writes. Turn these on only if your backend may store your code.</div>
          <Row label="Include prompts" hint="Your message text on prompt events and turn spans.">
            {check('logPrompts')}
          </Row>
          <Row label="Include tool inputs" hint="File paths, shell commands and search patterns on tool events.">
            {check('logToolDetails')}
          </Row>
          {t.traces && (
            <Row label="Include tool output" hint="File contents, command output and web results on tool spans, up to 60 KB each.">
              {check('logToolContent')}
            </Row>
          )}
        </>
      )}
    </>
  )
}

const EXTRA_AGENTS: { id: ExtraAgentId; label: string; hint: string }[] = [
  { id: 'scout', label: 'Scout', hint: 'Fast read-only explorer on Haiku. Used for research in plan mode, or ask for it with @scout.' },
  { id: 'reviewer', label: 'Reviewer', hint: 'Bug-hunting reviewer on Opus. Powers the Review tab with stricter rules, or ask for it with @reviewer.' },
  { id: 'securityReviewer', label: 'Security reviewer', hint: 'Adds a Security review button to the Review tab, or ask for it with @security-reviewer.' },
  { id: 'quickWorker', label: 'Quick worker', hint: 'Low-cost Haiku worker for mechanical edits. Type /quick followed by the task.' }
]

function ExtrasSection({ extras, save }: { extras: Extras; save: (patch: Partial<Extras>) => void }) {
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'
  return (
    <>
      <div className="border-b border-line px-5 py-2.5 text-[12px] text-faint">Extra agents adapted from oh-my-pi. Subagents work in Claude chats; the advisor works in every chat.</div>
      {EXTRA_AGENTS.map((a) => (
        <div key={a.id}>
          <Row label={a.label} hint={a.hint}>
            <input type="checkbox" checked={extras.agents[a.id]} onChange={(e) => save({ agents: { ...extras.agents, [a.id]: e.target.checked } })} />
          </Row>
          {a.id === 'reviewer' && extras.agents.reviewer && (
            <Row label="Review before opening a PR" hint="Create PR has the reviewer check the changes first, and stops if it finds a serious bug.">
              <input type="checkbox" checked={extras.reviewBeforePr} onChange={(e) => save({ reviewBeforePr: e.target.checked })} />
            </Row>
          )}
        </div>
      ))}
      <Row label="Advisor" hint="A second model reviews each finished turn and points out bugs, drift from your ask, or unverified claims. On for every chat; switch it off per chat in the composer. Costs one extra model call per turn.">
        <input type="checkbox" checked={extras.advisor} onChange={(e) => save({ advisor: e.target.checked })} />
      </Row>
      {extras.advisor && (
        <>
          <Row label="Advisor model">
            <select className={select} value={extras.advisorModel} onChange={(e) => save({ advisorModel: e.target.value as Extras['advisorModel'] })}>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </Row>
          <Row label="Send blockers automatically" hint="Pass blocker notes to the agent without waiting for you to click Send to agent. At most once per message you send.">
            <input type="checkbox" checked={extras.advisorSteer} onChange={(e) => save({ advisorSteer: e.target.checked })} />
          </Row>
        </>
      )}
      <Row
        label="Claude Code advisor"
        hint="Claude Code's own advisor tool. In Claude chats, Claude consults a stronger model mid-task when it decides to (before picking an approach, when stuck, before saying it's done). Different from the advisor above, which reviews after each turn. Needs a Claude sign-in or Anthropic API key and a main model the advisor can advise; counts toward your usage."
      >
        <select className={select} value={extras.claudeAdvisor} onChange={(e) => save({ claudeAdvisor: e.target.value as Extras['claudeAdvisor'] })}>
          <option value="inherit">Use my Claude Code setting</option>
          <option value="off">Off</option>
          <option value="fable">Fable</option>
          <option value="opus">Opus</option>
          <option value="sonnet">Sonnet</option>
        </select>
      </Row>
    </>
  )
}

const LOCATION_KEY = 'clone-location'
const DEFAULT_LOCATION = '~/choo-choo/repos'

export const RETENTION: [number, string][] = [
  [1, '1 day'],
  [7, '7 days'],
  [14, '14 days'],
  [30, '30 days'],
  [90, '90 days'],
  [0, 'Never']
]

function CreateModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [location, setLocation] = useState(() => {
    try {
      return localStorage.getItem(LOCATION_KEY) || DEFAULT_LOCATION
    } catch {
      return DEFAULT_LOCATION
    }
  })
  const [busy, setBusy] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [ghError, setGhError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listGithubRepos().then(setRepos, (e) => setGhError(String(e?.message ?? e)))
  }, [])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (repos ?? []).filter((r) => !t || r.nameWithOwner.toLowerCase().includes(t) || r.description?.toLowerCase().includes(t)).slice(0, 100)
  }, [repos, q])

  const target = url.trim() || picked
  const clone = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      localStorage.setItem(LOCATION_KEY, location)
    } catch {
      /* storage unavailable */
    }
    try {
      const repo = await window.api.cloneRepo(target, location)
      await refreshState()
      onClose()
      newWorkspace(repo.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-faint'
  return (
    <Shell onClose={onClose} width="w-[520px]">
      <div
        className="p-5"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.target === e.currentTarget.querySelector('input'))) {
            e.preventDefault()
            void clone()
          }
        }}
      >
        <div className="mb-4 text-lg font-semibold">Clone GitHub repo</div>
        <div className="mb-1.5 text-[12px] text-muted">Repository URL</div>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/user/repo.git" className={`${field} mb-4`} />

        <div className="mb-1.5 text-[12px] text-muted">Your repos</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories…" className={`${field} mb-2`} />
        <div className="mb-4 h-56 overflow-y-auto rounded-md border border-line">
          {repos === null && !ghError && <div className="px-3 py-3 text-[12px] text-faint">Loading your repositories…</div>}
          {ghError && <div className="px-3 py-3 text-[12px] text-faint">Couldn't list GitHub repositories. Run <code>gh auth login</code>, or paste a URL above.</div>}
          {repos && shown.length === 0 && <div className="px-3 py-3 text-[12px] text-faint">No matching repositories.</div>}
          {shown.map((r) => {
            const [owner, name] = r.nameWithOwner.split('/')
            const on = picked === r.nameWithOwner && !url.trim()
            return (
              <button
                key={r.nameWithOwner}
                onClick={() => {
                  setPicked(r.nameWithOwner)
                  setUrl('')
                }}
                onDoubleClick={() => void clone()}
                className={`flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 ${on ? 'bg-raised' : 'hover:bg-hover'}`}
              >
                <img src={`https://avatars.githubusercontent.com/${owner}?s=64`} alt="" className="h-7 w-7 shrink-0 rounded-md bg-raised" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    {owner}/{name}
                    {r.private && <IconLock width={12} height={12} className="shrink-0 text-faint" />}
                  </div>
                  {r.description && <div className="truncate text-[12px] text-faint">{r.description}</div>}
                </div>
              </button>
            )
          })}
        </div>

        <div className="mb-1.5 text-[12px] text-muted">Location</div>
        <div className="mb-5 flex gap-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${field} flex-1`} />
          <button
            className="rounded-md border border-line px-3 hover:bg-hover"
            onClick={() => void window.api.pickFolder().then((p) => p && setLocation(p))}
          >
            Browse
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 text-[12px] text-muted hover:text-fg"
            onClick={() => {
              onClose()
              void addRepository()
            }}
          >
            <IconFolder width={13} height={13} /> Open a local folder instead
          </button>
          <button disabled={!target || busy} onClick={() => void clone()} className="flex items-center gap-2 rounded-md bg-fg px-4 py-2 font-medium text-bg disabled:opacity-40">
            {busy ? `Cloning ${target}…` : 'Clone repo'} <span className="text-[11px] opacity-60">⌘↵</span>
          </button>
        </div>
      </div>
    </Shell>
  )
}

function ConductorImportModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const modelDetails = useStore((s) => s.modelDetails)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [useRoot, setUseRoot] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ImportResult | null>(null)

  useEffect(() => {
    window.api.previewConductorImport().then(setPreview, reportError)
  }, [])

  const run = async () => {
    setBusy(true)
    try {
      setDone(await window.api.importFromConductor({ useWorkspacesRoot: useRoot }))
      await refreshState()
      useStore.getState().set({ settings: (await window.api.getState()).settings })
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }

  const tag = (s: string) =>
    s === 'already' ? <span className="text-faint">already added</span> : s === 'missing' ? <span className="text-del">folder missing</span> : <span className="text-add">new</span>
  const newRepos = preview?.repos.filter((r) => r.status === 'new').length ?? 0
  const newWs = preview?.workspaces.filter((w) => w.status === 'new') ?? []
  const nothing = preview && newRepos === 0 && newWs.length === 0

  return (
    <Shell onClose={onClose} width="w-[620px]">
      <div className="border-b border-line px-5 py-3 font-medium">Import from Conductor</div>
      <div className="max-h-[60vh] overflow-y-auto p-5">
        {!preview && <div className="text-muted">Reading Conductor's data…</div>}
        {preview && !preview.found && <div className="text-muted">Conductor's data wasn't found on this Mac.</div>}
        {done && (
          <div className="mb-4 rounded-md border border-line bg-raised px-3 py-2">
            Imported {done.repos} projects, {done.workspaces} workspaces and {done.chats} chats ({done.messages} messages).
          </div>
        )}
        {preview?.found && !done && (
          <>
            <div className="mb-1 text-[12px] font-medium text-faint">Projects</div>
            {preview.repos.map((r) => (
              <div key={r.path} className="flex items-center gap-3 py-1">
                <span className="w-44 shrink-0 truncate">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint" title={r.path}>
                  {r.path.replace(/^\/Users\/[^/]+/, '~')}
                  {r.hasScripts && ' · scripts'}
                </span>
                <span className="shrink-0 text-[12px]">{tag(r.status)}</span>
              </div>
            ))}
            <div className="mt-4 mb-1 text-[12px] font-medium text-faint">Open workspaces</div>
            {preview.workspaces.length === 0 && <div className="text-[12px] text-faint">None</div>}
            {preview.workspaces.map((w) => (
              <div key={w.path} className="flex items-center gap-3 py-1">
                <span className="w-44 shrink-0 truncate">{w.name}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint">
                  {w.repo} · {w.branch} · {w.chats} {w.chats === 1 ? 'chat' : 'chats'}
                </span>
                <span className="shrink-0 text-[12px]">{tag(w.status)}</span>
              </div>
            ))}
            {preview.archivedSkipped > 0 && <div className="mt-1 text-[12px] text-faint">{preview.archivedSkipped} archived workspaces are skipped.</div>}
            {preview.settings.length > 0 && (
              <>
                <div className="mt-4 mb-1 text-[12px] font-medium text-faint">Settings</div>
                {preview.settings.map((s) => (
                  <div key={s.label} className="flex gap-3 py-0.5 text-[12px]">
                    <span className="w-44 shrink-0 text-muted">{s.label}</span>
                    <span>{s.label === 'Default model' ? modelLabel(s.value as ModelId, modelDetails) : s.value === 'true' ? 'Yes' : s.value === 'false' ? 'No' : s.value}</span>
                  </div>
                ))}
              </>
            )}
            {preview.workspacesRoot && (
              <label className="mt-4 flex items-start gap-2 text-[12px]">
                <input type="checkbox" className="mt-0.5" checked={useRoot} onChange={(e) => setUseRoot(e.target.checked)} />
                <span>
                  Create new workspaces in Conductor's folder, <span className="text-muted">{preview.workspacesRoot.replace(/^\/Users\/[^/]+/, '~')}</span>
                </span>
              </label>
            )}
            <div className="mt-3 text-[12px] text-faint">
              {(() => {
                const conductorDir = preview.workspacesRoot?.replace(/^\/Users\/[^/]+/, '~')
                const current = (settings.workspacesRoot?.trim() || '~/choo-choo/workspaces').replace(/^\/Users\/[^/]+/, '~')
                const where = useRoot && conductorDir ? conductorDir : current
                return `Imported workspaces stay where they are${conductorDir ? ` in ${conductorDir}` : ''}; nothing is moved or copied. New workspaces you create will go in ${where}. Claude chats resume with their full history.`
              })()}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="rounded-md px-3 py-1.5 text-muted hover:text-fg" onClick={onClose}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {preview?.found && !done && (
          <button disabled={busy || !!nothing} onClick={() => void run()} className="rounded-md bg-fg px-3 py-1.5 font-medium text-bg disabled:opacity-40">
            {busy ? 'Importing…' : nothing ? 'Nothing new to import' : `Import ${newRepos} projects and ${newWs.length} workspaces`}
          </button>
        )}
      </div>
    </Shell>
  )
}
