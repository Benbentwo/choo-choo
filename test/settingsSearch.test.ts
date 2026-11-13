// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SETTINGS_INDEX, findSettingRow, matchCounts, searchSettings } from '../src/renderer/src/settingsSearch'

const labels = (q: string) => searchSettings(q).map((m) => m.entry.label)

describe('searchSettings', () => {
  it('matches nothing for an empty query', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })

  it('ranks label matches above hint and keyword matches', () => {
    const got = labels('notif')
    expect(got[0]).toBe('Notifications')
    expect(got).toContain('macOS notification')
    expect(got).toContain('Notify me when Up next starts after a reset')
  })

  it('finds settings by other words people use for them', () => {
    expect(labels('dark mode')).toEqual(['Theme'])
    expect(labels('budget')).toContain('Spend cap per message')
    expect(labels('otel')[0]).toBe('Export telemetry')
  })

  it('needs every word to match, in any order', () => {
    expect(labels('model default')).toContain('Default model')
    expect(labels('default zebra')).toEqual([])
  })

  it('ignores case and quotes', () => {
    expect(labels('VIEWED TICKS')).toEqual(['Sync "Viewed" ticks with GitHub'])
    expect(labels('"since your review"')).toContain('Open reviewed PRs on "Since your review"')
  })

  it('matches section names, after labels', () => {
    const got = searchSettings('telemetry', { telemetry: 'Telemetry' })
    expect(got[0].entry.label).toBe('Export telemetry')
    expect(got.every((m) => m.entry.section === 'telemetry')).toBe(true)
  })

  it('counts matches per section', () => {
    const counts = matchCounts(searchSettings('advisor'))
    expect(counts.agents).toBe(4)
    expect(counts.general).toBeUndefined()
  })
})

describe('SETTINGS_INDEX', () => {
  it('has no duplicate entries', () => {
    const keys = SETTINGS_INDEX.map((e) => `${e.section}:${e.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // A new setting should be searchable the day it ships. This reads the labels the settings
  // components draw and fails if one is missing from SETTINGS_INDEX.
  it('lists every labelled setting the settings components draw', () => {
    const dir = join(__dirname, '../src/renderer/src/components')
    const files = ['Modals.tsx', 'Appearance.tsx', 'ReviewSettings.tsx', 'ContinueWork.tsx', 'Updates.tsx']
    const patterns = [
      /<Row\s+label="([^"]+)"/g, // <Row label="…">
      /<Section title="([^"]+)"/g, // Appearance sections
      /<Group\s+title=(?:"([^"]+)"|'([^']+)')/g, // Review groups
      /\blabel: (?:"([^"]+)"|'([^']+)'),/g, // Review check rows and agent lists
      /\{row\(\s*'((?:[^'\\]|\\.)+)'/g // ContinueWork and Usage history rows
    ]
    const known = new Set(SETTINGS_INDEX.map((e) => e.label))
    const missing: string[] = []
    for (const f of files) {
      // The section list itself isn't a setting.
      const src = readFileSync(join(dir, f), 'utf8').replace(/const SETTINGS_SECTIONS[\s\S]*?\n\]\n/, '')
      for (const re of patterns)
        for (const m of src.matchAll(re)) {
          const label = (m[1] ?? m[2]).replace(/\\'/g, "'")
          if (!known.has(label)) missing.push(`${f}: ${label}`)
        }
    }
    expect(missing).toEqual([])
  })
})

describe('findSettingRow', () => {
  const html = `
    <div id="box">
      <div class="flex border-b"><div class="flex-1"><div>Default model</div><div>hint</div></div><select></select></div>
      <div class="border-b"><div>Show it</div>
        <label><input type="checkbox"><span>macOS notification<span>Clicking it…</span></span></label>
      </div>
      <div class="border-b"><label>
        Interface
        <select></select>
      </label></div>
      <div class="border-b"><div>Open reviewed PRs on “Since your review”</div></div>
    </div>`

  it('widens the label to its row or <label>', () => {
    document.body.innerHTML = html
    const box = document.getElementById('box')!
    expect(findSettingRow(box, 'Default model')?.className).toBe('flex border-b')
    expect(findSettingRow(box, 'macOS notification')?.tagName).toBe('LABEL')
    expect(findSettingRow(box, 'Interface')?.tagName).toBe('LABEL')
    expect(findSettingRow(box, 'Open reviewed PRs on "Since your review"')).not.toBeNull()
  })

  it('returns null when the row is not drawn', () => {
    document.body.innerHTML = html
    expect(findSettingRow(document.getElementById('box')!, 'Endpoint')).toBeNull()
  })
})
