import { describe, expect, it } from 'vitest'
import { changeCount, cleanItem, notesBetween, parseNotes, type GithubRelease } from '../src/shared/releaseNotes'

// Shaped like Release Drafter's stable notes and the Beta workflow's notes, with made-up changes.
const stable = (v: string, changes: string) => `## Download

Grab the \`.dmg\` for your Mac below: \`arm64\` for Apple silicon, \`x64\` for Intel.

## What's changed

${changes}

**Full changelog:** https://github.com/example/app/compare/v0.0.1...v${v}`

const beta = (sha: string, lines: string[]) => `Beta build of ${sha}.

## What's changed

${lines.map((l) => `- ${l}`).join('\n')}

Turn on Settings > Updates > Update channel > Beta to get these builds automatically.`

const rel = (tag: string, body: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  body,
  html_url: `https://github.com/example/app/releases/tag/${tag}`,
  prerelease: tag.includes('-'),
  published_at: '2026-11-01T12:00:00Z',
  ...extra
})

describe('cleanItem', () => {
  it('drops the PR number, author and escapes', () => {
    expect(cleanItem('- Dark mode for the settings page (#12) @maya-chen')).toBe('Dark mode for the settings page')
    expect(cleanItem('- Faster \\<b> \\_and\\_ rendering (#3, #4)')).toBe('Faster <b> _and_ rendering')
    expect(cleanItem('- deps: bump x (#109) @[dependabot[bot]](https://github.com/apps/dependabot)')).toBe('deps: bump x')
    expect(cleanItem('* Sidebar search by @maya-chen in https://github.com/example/app/pull/7')).toBe('Sidebar search')
  })
})

describe('parseNotes', () => {
  it('keeps the change sections and drops download steps, docs and repo chores', () => {
    const body = stable(
      '0.4.0',
      `- Sidebar: drag to reorder (#20) @maya-chen

## New features

- Command palette (#21) @maya-chen

## Fixes

- Fix a crash when a repo is renamed (#22) @sam-lee

## Docs

- Docs: explain worktrees (#23) @sam-lee

## Maintenance

- deps: bump left-pad from 1.0.0 to 1.0.1 (#24) @[dependabot[bot]](https://github.com/apps/dependabot)
- deps: bump @anthropic-ai/claude-agent-sdk from 0.3.1 to 0.3.2 (#25) @[dependabot[bot]](https://github.com/apps/dependabot)
- ci: cache npm (#26) @sam-lee`
    )
    expect(parseNotes(body).sections).toEqual([
      { title: '', items: ['Sidebar: drag to reorder'] },
      { title: 'New', items: ['Command palette'] },
      { title: 'Fixes', items: ['Fix a crash when a repo is renamed'] },
      { title: 'Other changes', items: ['Updated the bundled Claude Code'] }
    ])
  })

  it('reads beta notes, including the older single-line kind', () => {
    expect(parseNotes(beta('abc1234', ['Chat: copy as Markdown (#30)', 'README: new screenshots (#29)'])).sections).toEqual([{ title: '', items: ['Chat: copy as Markdown'] }])
    const old = 'Beta build of abc1234.\n\nChat: copy as Markdown (#30)\n\nTurn on Settings > Updates > Update channel > Beta to get these builds automatically.\n'
    expect(parseNotes(old).sections).toEqual([{ title: '', items: ['Chat: copy as Markdown'] }])
  })

  it('handles an empty body', () => {
    expect(parseNotes(null).sections).toEqual([])
    expect(parseNotes(stable('0.4.1', '- Small fixes and polish')).sections).toEqual([])
  })
})

describe('notesBetween', () => {
  const releases = [
    rel('v0.5.0-beta.12', beta('ccc', ['Usage page: weekly totals (#41)'])),
    rel('v0.4.0', stable('0.4.0', '- Command palette (#21)\n- Sidebar search (#22)')),
    rel('v0.4.0-beta.11', beta('bbb', ['Sidebar search (#22)'])),
    rel('v0.4.0-beta.10', beta('aaa', ['Command palette (#21)'])),
    rel('v0.3.2', stable('0.3.2', '- Fix the diff scrollbar (#15)')),
    rel('v0.3.1', stable('0.3.1', '- Faster startup (#14)')),
    rel('v0.4.1', stable('0.4.1', '- Draft notes'), { draft: true })
  ]

  it('lists every stable release after yours, newest first', () => {
    const notes = notesBetween(releases, '0.3.1', '0.4.0', 'stable')
    expect(notes.map((n) => n.version)).toEqual(['0.4.0', '0.3.2'])
    expect(notes[0].sections[0].items).toEqual(['Command palette', 'Sidebar search'])
    expect(notes[0].url).toContain('v0.4.0')
    expect(notes[0].publishedAt).toBe(Date.parse('2026-11-01T12:00:00Z'))
    expect(changeCount(notes)).toBe(3)
  })

  it('never shows drafts, or betas to stable people', () => {
    expect(notesBetween(releases, '0.4.0', '0.4.1', 'stable')).toEqual([])
    expect(notesBetween(releases, '0.4.0', '0.5.0-beta.12', 'stable')).toEqual([])
  })

  it('shows betas newer than you on the beta channel', () => {
    const notes = notesBetween(releases, '0.4.0-beta.10', '0.4.0-beta.11', 'beta')
    expect(notes.map((n) => [n.version, n.prerelease])).toEqual([['0.4.0-beta.11', true]])
    expect(notes[0].sections[0].items).toEqual(['Sidebar search'])
  })

  it('lets a stable release in the range stand in for the betas before it', () => {
    const notes = notesBetween(releases, '0.3.2', '0.5.0-beta.12', 'beta')
    expect(notes.map((n) => n.version)).toEqual(['0.5.0-beta.12', '0.4.0'])
  })

  it('lists a change once, under the newest version that has it', () => {
    const dup = [rel('v0.6.0-beta.2', beta('b', ['Tabs: pin a tab (#50)', 'Tabs: close others (#51)'])), rel('v0.6.0-beta.1', beta('a', ['Tabs: pin a tab (#50)']))]
    const notes = notesBetween(dup, '0.5.0', '0.6.0-beta.2', 'beta')
    expect(notes[0].sections[0].items).toEqual(['Tabs: pin a tab', 'Tabs: close others'])
    expect(notes[1].sections).toEqual([])
  })
})
