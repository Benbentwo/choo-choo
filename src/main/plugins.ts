/**
 * Claude Code plugins, marketplaces and local skills for Settings > Plugins. Plugins are managed with
 * `claude plugin …` from the same binary agents use, so the terminal sees the same state.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AvailablePlugin, InstalledPlugin, LocalSkill, Marketplace, PluginInstallResult } from '@shared/types'
import { lastJson, runClaude, runClaudeCli } from './claudeCli'

const ID = /^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$/
const SCOPES = ['user', 'project', 'local']

function checkId(id: string) {
  if (!ID.test(id)) throw new Error(`Not a plugin id: ${id}`)
}

/** JSON from a command's whole output, or its last JSON line. */
function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return lastJson(text)
  }
}

export function toInstalled(p: any): InstalledPlugin {
  const [name, marketplace] = String(p.id).split('@')
  return {
    id: p.id,
    name,
    marketplace: marketplace ?? '',
    version: p.version ?? '',
    scope: p.scope ?? 'user',
    enabled: !!p.enabled,
    manageable: SCOPES.includes(p.scope)
  }
}

export function toAvailable(p: any): AvailablePlugin {
  return { id: p.pluginId, name: p.name, description: p.description ?? '', marketplace: p.marketplaceName ?? '', installs: p.installCount }
}

export async function installed(cwd: string, env: Record<string, string>): Promise<InstalledPlugin[]> {
  const list = parseJson(await runClaude(['plugin', 'list', '--json'], cwd, env))
  return (Array.isArray(list) ? list : (list?.installed ?? [])).map(toInstalled)
}

let availableCache: { at: number; cwd: string; list: AvailablePlugin[] } | null = null

/** Every plugin the configured marketplaces offer. Cached for five minutes; installs and marketplace changes clear it. */
export async function available(cwd: string, env: Record<string, string>, fresh = false): Promise<AvailablePlugin[]> {
  if (!fresh && availableCache && availableCache.cwd === cwd && Date.now() - availableCache.at < 5 * 60_000) return availableCache.list
  const data = parseJson(await runClaude(['plugin', 'list', '--available', '--json'], cwd, env))
  const list = ((data?.available ?? []) as any[]).map(toAvailable).sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
  availableCache = { at: Date.now(), cwd, list }
  return list
}

export async function marketplaces(cwd: string, env: Record<string, string>): Promise<Marketplace[]> {
  const list = parseJson(await runClaude(['plugin', 'marketplace', 'list', '--json'], cwd, env))
  return (Array.isArray(list) ? list : []).map((m: any) => ({ name: m.name, source: m.repo ?? m.url ?? m.path ?? m.source ?? '' }))
}

export async function addMarketplace(cwd: string, env: Record<string, string>, source: string) {
  const s = source.trim()
  if (!s || /\s/.test(s)) throw new Error('Enter a GitHub owner/repo, a git URL, or a path')
  availableCache = null
  await runClaude(['plugin', 'marketplace', 'add', s, '--json'], cwd, env, 300_000)
}

export async function removeMarketplace(cwd: string, env: Record<string, string>, name: string) {
  checkId(name)
  availableCache = null
  await runClaude(['plugin', 'marketplace', 'remove', name], cwd, env)
}

/**
 * Installs a plugin. Some plugins install by running a command their marketplace declares; Claude Code
 * then refuses until a person has seen that command, so it comes back as `confirm` and the person
 * can approve that exact command (by its sha256).
 */
export async function install(cwd: string, env: Record<string, string>, id: string, scope: string, acceptSha?: string): Promise<PluginInstallResult> {
  checkId(id)
  if (!['user', 'project'].includes(scope)) throw new Error('Install for every repo or for this repo')
  const args = ['plugin', 'install', id, '-s', scope, '--json']
  if (acceptSha) {
    if (!/^[a-f0-9]{64}$/i.test(acceptSha)) throw new Error('Bad command hash')
    args.push('--accept-command', acceptSha)
  }
  const r = await runClaudeCli(args, cwd, env, 600_000)
  const out = lastJson(r.stdout)
  const shown = out?.shownCommand
  if (shown?.sha256 && !acceptSha && out?.outcome !== 'ok') return { ok: false, confirm: { command: String(shown.command ?? shown.text ?? ''), sha256: String(shown.sha256) } }
  if (!r.ok || (out && out.outcome && out.outcome !== 'ok')) throw new Error(out?.message || r.stderr.trim() || 'Install failed')
  availableCache = null
  return { ok: true, message: out?.message }
}

export async function uninstall(cwd: string, env: Record<string, string>, id: string, scope: string) {
  checkId(id)
  if (!SCOPES.includes(scope)) throw new Error('This plugin is managed outside Claude Code settings')
  await runClaude(['plugin', 'uninstall', id, '-s', scope, '--json'], cwd, env)
}

export async function setEnabled(cwd: string, env: Record<string, string>, id: string, enabled: boolean, scope: string) {
  checkId(id)
  const args = ['plugin', enabled ? 'enable' : 'disable', id, '--json']
  if (SCOPES.includes(scope)) args.push('-s', scope)
  try {
    await runClaude(args, cwd, env)
  } catch (e) {
    // Already in the state asked for: nothing to do.
    if (!/already (enabled|disabled)/i.test((e as Error).message)) throw e
  }
}

/** Claude Code's own summary of a plugin: its skills, agents, hooks and servers, and their token cost. */
export async function details(cwd: string, env: Record<string, string>, id: string): Promise<string> {
  checkId(id)
  return (await runClaude(['plugin', 'details', id], cwd, env)).trim()
}

function frontmatter(file: string): { name?: string; description?: string } {
  try {
    const fm = readFileSync(file, 'utf8').match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? ''
    const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
    return { name: field('name'), description: field('description') }
  } catch {
    return {}
  }
}

/** Skills, commands and agents defined in ~/.claude and in the checkout's .claude folder. */
export function localSkills(cwd: string, home = homedir()): LocalSkill[] {
  const out: LocalSkill[] = []
  for (const [root, scope] of [
    [join(home, '.claude'), 'user'],
    [join(cwd, '.claude'), 'project']
  ] as const) {
    const skills = join(root, 'skills')
    if (existsSync(skills)) {
      for (const e of readdirSync(skills).sort()) {
        const f = join(skills, e, 'SKILL.md')
        if (existsSync(f)) out.push({ kind: 'skill', name: frontmatter(f).name || e, description: frontmatter(f).description ?? '', scope, path: join(skills, e) })
      }
    }
    for (const kind of ['commands', 'agents'] as const) {
      const dir = join(root, kind)
      if (!existsSync(dir)) continue
      const walk = (d: string, prefix: string) => {
        for (const e of readdirSync(d).sort()) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p, `${prefix}${e}:`)
          else if (e.endsWith('.md')) {
            const fm = frontmatter(p)
            out.push({ kind: kind === 'commands' ? 'command' : 'agent', name: kind === 'agents' && fm.name ? fm.name : prefix + e.replace(/\.md$/, ''), description: fm.description ?? '', scope, path: p })
          }
        }
      }
      walk(dir, '')
    }
  }
  return out
}
