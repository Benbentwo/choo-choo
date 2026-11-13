/**
 * Search for the Settings window. Every setting a person might look for is listed here with
 * its section, its label as drawn, and the words someone might type instead. A test reads the
 * settings components and fails when a label there is missing from this list, so a new setting
 * shows up in search as soon as it ships.
 */

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'reviews'
  | 'projects'
  | 'continue'
  | 'usage'
  | 'agents'
  | 'prompts'
  | 'mcp'
  | 'plugins'
  | 'addons'
  | 'integrations'
  | 'updates'
  | 'telemetry'
  | 'experimental'

export interface SettingEntry {
  section: SettingsSectionId
  /** The label as it appears in Settings. Also the text the window scrolls to. */
  label: string
  hint?: string
  /** Other words people use for it. Searched, never shown. */
  keywords?: string
  /** Shown under a result when the row only appears after something else is turned on. */
  needs?: string
}

const TELEMETRY_ON = 'Shown once Export telemetry is on.'
const ADVISOR_ON = 'Shown once Advisor is on.'

export const SETTINGS_INDEX: SettingEntry[] = [
  // General
  { section: 'general', label: 'Default model', keywords: 'opus sonnet haiku llm' },
  { section: 'general', label: 'Default effort', keywords: 'thinking reasoning' },
  { section: 'general', label: 'Default permissions', hint: 'Full access, Auto, or ask before tools that change things.', keywords: 'approve allow bypass yolo auto mode prompt' },
  { section: 'general', label: 'Messages sent while Claude works', hint: 'Steer sends now; Queue sends after Claude finishes.', keywords: 'steer queue interrupt follow up' },
  { section: 'general', label: 'Spend cap per message', hint: 'Stop a run once it costs this many dollars.', keywords: 'budget cost dollars limit money' },
  { section: 'general', label: 'Branch prefix', hint: 'New workspaces branch as prefix/name.', keywords: 'git branch name username' },
  { section: 'general', label: 'Claude Code', hint: 'Bundled with the app or your installed claude.', keywords: 'binary cli installed bundled executable' },
  { section: 'general', label: 'Anthropic API key', keywords: 'token login sign in sk-ant' },
  { section: 'general', label: 'Notifications', hint: 'Notify when an agent finishes while the app is in the background.', keywords: 'alert notify done finished macos banner' },
  { section: 'general', label: 'Orchestrator updates', hint: 'Wake the orchestrator when a workspace it started finishes.', keywords: 'orchestrator wake report' },
  { section: 'general', label: 'Workspaces folder', hint: 'Where new workspaces are created.', keywords: 'directory path worktree location disk' },
  { section: 'general', label: 'Import from Conductor', keywords: 'migrate conductor import move' },
  { section: 'general', label: 'Delete archived workspaces after', keywords: 'archive retention cleanup days' },

  // Appearance
  { section: 'appearance', label: 'Theme', keywords: 'dark light mode color scheme skin' },
  { section: 'appearance', label: 'Accent', hint: 'Used for highlights, unread dots, focus rings, links and the cursor.', keywords: 'color colour highlight' },
  { section: 'appearance', label: 'Interface size', hint: 'Scales text and controls together.', keywords: 'zoom text size font size bigger smaller scale' },
  { section: 'appearance', label: 'Density', hint: 'How much space sits around rows, buttons and panels.', keywords: 'compact comfortable spacing padding' },
  { section: 'appearance', label: 'Chat format', hint: 'Compact folds tool calls into one Working row.', keywords: 'compact verbose tool calls transcript' },
  { section: 'appearance', label: 'Fonts', keywords: 'typeface font family' },
  { section: 'appearance', label: 'Interface', hint: 'The font for menus, chats and buttons.', keywords: 'font ui typeface' },
  { section: 'appearance', label: 'Code and terminal', hint: 'The monospace font.', keywords: 'font mono monospace typeface' },
  { section: 'appearance', label: 'Motion', keywords: 'animation' },
  { section: 'appearance', label: 'Reduce motion', hint: 'Turns off transitions and animations.', keywords: 'animation accessibility a11y' },

  // Reviews
  { section: 'reviews', label: 'Notify me when someone asks for my review', hint: 'A macOS notification when a new PR asks for your review.', keywords: 'review request requested new pr notification alert' },
  { section: 'reviews', label: "Tell me when a PR I'm reviewing changes for me", keywords: 'review updates notify pull request reviewer' },
  { section: 'reviews', label: "The PR's own changes moved", hint: 'New or edited code in the PR, not counting the base branch.', keywords: 'push commit' },
  { section: 'reviews', label: 'Someone answers my comment', keywords: 'reply thread' },
  { section: 'reviews', label: "I'm asked to review again", keywords: 're-request review request' },
  { section: 'reviews', label: 'A draft is marked ready for review', keywords: 'draft ready' },
  { section: 'reviews', label: 'Checks start failing', keywords: 'ci failing red build tests' },
  { section: 'reviews', label: 'Any push at all', hint: 'Even ones that change nothing in the PR.', keywords: 'push' },
  { section: 'reviews', label: 'Keep quiet about', keywords: 'ignore mute' },
  { section: 'reviews', label: 'Merges from the base branch', keywords: 'ignore merge main' },
  { section: 'reviews', label: 'Rebases that leave the changes the same', keywords: 'ignore rebase force push' },
  { section: 'reviews', label: 'Files matching these patterns', hint: 'Also left out of Since your review.', keywords: 'ignore glob lockfile generated' },
  { section: 'reviews', label: 'Changes under', hint: 'Skip changes smaller than this many lines.', keywords: 'ignore small lines threshold' },
  { section: 'reviews', label: 'Show it', hint: 'How review updates reach you.', keywords: 'notify display' },
  { section: 'reviews', label: 'Bold with a dot on the PRs page, and "new" on the sidebar', keywords: 'unread badge dot' },
  { section: 'reviews', label: 'macOS notification', hint: 'Clicking it opens the PR on Since your review.', keywords: 'notify alert banner' },
  { section: 'reviews', label: 'Only between', hint: 'Quiet hours for review notifications.', keywords: 'quiet hours do not disturb schedule time' },
  { section: 'reviews', label: 'Open reviewed PRs on "Since your review"', keywords: 'interdiff since last review' },
  { section: 'reviews', label: 'Sync "Viewed" ticks with GitHub', hint: "Each file in the diff gets GitHub's own Viewed tick.", keywords: 'viewed files checkbox' },
  { section: 'reviews', label: 'Check GitHub every', keywords: 'poll interval refresh minutes' },

  // Projects
  { section: 'projects', label: 'Projects', hint: 'Your projects and their workspaces.', keywords: 'repos repositories remove delete workspaces manage' },
  { section: 'projects', label: 'Left on disk', hint: 'Workspace folders kept when these projects were removed.', keywords: 'orphan folders cleanup disk space' },

  // Continue work
  { section: 'continue', label: 'Resume paused chats when the limit resets', keywords: 'usage limit rate limit reset up next continue resume' },
  { section: 'continue', label: 'Start at most', hint: 'How many Up next items run at once.', keywords: 'concurrent parallel' },
  { section: 'continue', label: 'Stop starting new work once the window is at', keywords: 'percent usage window limit' },
  { section: 'continue', label: 'Order new paused chats by', keywords: 'priority sort queue' },
  { section: 'continue', label: 'Continue prompt', hint: 'Sent to a paused chat when it resumes.', keywords: 'resume message' },
  { section: 'continue', label: 'Also wait for weekly limits', keywords: 'weekly limit' },
  { section: 'continue', label: 'Keep Mac awake while work is waiting', keywords: 'sleep caffeinate power' },
  { section: 'continue', label: 'Notify me when Up next starts after a reset', keywords: 'notification alert' },

  // Usage history
  { section: 'usage', label: 'Keep usage history', keywords: 'usage tokens history dashboard privacy' },
  { section: 'usage', label: 'Keep for', hint: 'Older months are deleted when Choo Choo starts.', keywords: 'retention months usage history' },

  // Agents
  { section: 'agents', label: 'Scout', hint: 'Fast read-only explorer on Haiku.', keywords: 'agent subagent research' },
  { section: 'agents', label: 'Reviewer', hint: 'Bug-hunting reviewer on Opus.', keywords: 'agent subagent code review' },
  { section: 'agents', label: 'Security reviewer', hint: 'Adds a Security review button to the Review tab.', keywords: 'agent subagent security' },
  { section: 'agents', label: 'Quick worker', hint: 'Low-cost Haiku worker for mechanical edits.', keywords: 'agent subagent /quick' },
  { section: 'agents', label: 'Review before opening a PR', hint: 'Create PR has the reviewer check the changes first.', keywords: 'pull request review', needs: 'Shown once Reviewer is on.' },
  { section: 'agents', label: 'Advisor', hint: 'A second model reviews each finished turn.', keywords: 'second opinion check' },
  { section: 'agents', label: 'Advisor model', needs: ADVISOR_ON },
  { section: 'agents', label: 'Send blockers automatically', hint: 'Pass the advisor\'s blocker notes to the agent without waiting for you.', keywords: 'advisor blocker', needs: ADVISOR_ON },
  { section: 'agents', label: 'Claude Code advisor', keywords: 'advisor built in' },

  // Prompts
  { section: 'prompts', label: 'All repos', hint: 'Instructions added to every chat.', keywords: 'system prompt custom instructions global' },
  { section: 'prompts', label: 'This repo', hint: 'Instructions added to chats in one repo.', keywords: 'system prompt custom instructions project' },

  // MCP, Plugins, Add-ons, Integrations
  { section: 'mcp', label: 'Servers Claude Code loads in', hint: 'Add, sign in to and remove MCP servers.', keywords: 'mcp server tools add model context protocol' },
  { section: 'plugins', label: 'Installed', hint: 'Claude Code plugins installed for every repo or one.', keywords: 'plugin uninstall' },
  { section: 'plugins', label: 'Browse', hint: 'Find plugins in your marketplaces.', keywords: 'plugin install marketplace' },
  { section: 'plugins', label: 'Your skills', hint: 'Skills, commands and agents in ~/.claude and the repo.', keywords: 'skill slash command' },
  { section: 'addons', label: 'Develop add-on…', hint: 'Load an add-on from a folder; it reloads as you save.', keywords: 'addon dev local folder' },
  { section: 'addons', label: 'Add source', hint: 'A git repo or folder that offers add-ons.', keywords: 'addon marketplace repo install' },
  { section: 'addons', label: 'From your sources', hint: 'Add-ons you can install.', keywords: 'addon install available' },
  { section: 'integrations', label: 'Linear', hint: 'Sign in to Linear.', keywords: 'issues tickets oauth integration' },
  { section: 'integrations', label: 'Notion', hint: 'Sign in to Notion.', keywords: 'docs pages oauth integration' },

  // Updates
  { section: 'updates', label: 'Check for Choo Choo updates', keywords: 'update version upgrade release' },
  { section: 'updates', label: 'Update channel', hint: 'Stable or Beta.', keywords: 'beta prerelease stable' },
  { section: 'updates', label: 'Check for Claude Code updates', keywords: 'update version upgrade cli npm' },

  // Telemetry
  { section: 'telemetry', label: 'Export telemetry', keywords: 'opentelemetry otel otlp observability' },
  { section: 'telemetry', label: 'Endpoint', hint: 'OTLP base URL.', keywords: 'otlp url collector', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Protocol', keywords: 'grpc http otlp', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Headers', hint: 'Sent with every export, for auth.', keywords: 'auth api key otlp', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Service name', keywords: 'service.name otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Resource attributes', keywords: 'tags otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Metrics', keywords: 'counters otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Log events', keywords: 'logs otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Traces', keywords: 'spans tracing otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Include prompts', keywords: 'privacy otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Include tool inputs', keywords: 'privacy otel', needs: TELEMETRY_ON },
  { section: 'telemetry', label: 'Include tool output', keywords: 'privacy otel', needs: 'Shown once Include tool inputs is on.' },

  // Experimental
  { section: 'experimental', label: 'Projects', hint: 'Orchestrator chats that route work to threads, plus Automations.', keywords: 'experimental orchestrator threads automations beta flag' }
]

export interface SettingMatch {
  entry: SettingEntry
  score: number
}

const norm = (s: string) => s.toLowerCase().replace(/[“”"'’…]/g, '').replace(/\s+/g, ' ').trim()

/** How well one word matches an entry. Lower is better; -1 is no match. */
function wordScore(word: string, label: string, hint: string, keywords: string, sectionLabel: string): number {
  const starts = (s: string) => s.startsWith(word) || s.includes(' ' + word)
  if (starts(label)) return 0
  if (label.includes(word)) return 1
  if (starts(keywords)) return 2
  if (starts(hint)) return 3
  if (starts(sectionLabel)) return 4
  if (keywords.includes(word) || hint.includes(word)) return 5
  return -1
}

/**
 * Settings that match every word of the query, best first: label matches, then other words for
 * it, then its hint, then its section name. An empty query matches nothing.
 */
export function searchSettings(query: string, sectionLabels: Partial<Record<SettingsSectionId, string>> = {}, index: SettingEntry[] = SETTINGS_INDEX): SettingMatch[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const out: SettingMatch[] = []
  index.forEach((entry, i) => {
    const label = norm(entry.label)
    const hint = norm(entry.hint ?? '')
    const keywords = norm(entry.keywords ?? '')
    const sectionLabel = norm(sectionLabels[entry.section] ?? entry.section)
    let score = 0
    for (const w of words) {
      const s = wordScore(w, label, hint, keywords, sectionLabel)
      if (s < 0) return
      score += s
    }
    if (label === norm(query)) score -= 1
    out.push({ entry, score: score * 1000 + i })
  })
  return out.sort((a, b) => a.score - b.score)
}

/** Sections with at least one match, and how many. */
export function matchCounts(matches: SettingMatch[]): Partial<Record<SettingsSectionId, number>> {
  const counts: Partial<Record<SettingsSectionId, number>> = {}
  for (const m of matches) counts[m.entry.section] = (counts[m.entry.section] ?? 0) + 1
  return counts
}

/**
 * Finds the row that draws a setting: the element holding the label text, widened to its row
 * (a <label> or a bordered row block). Returns null when the row isn't on screen, such as a
 * field shown only once another switch is on.
 */
export function findSettingRow(container: HTMLElement, label: string): HTMLElement | null {
  const want = norm(label)
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let hit: HTMLElement | null = null
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (norm(n.textContent ?? '') === want && n.parentElement) {
      hit = n.parentElement
      break
    }
  }
  if (!hit) return null
  for (let el: HTMLElement | null = hit; el && el !== container; el = el.parentElement) {
    if (el.tagName === 'LABEL' || el.classList.contains('border-b')) return el
  }
  return hit
}
