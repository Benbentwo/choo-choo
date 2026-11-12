import type { Settings } from '@shared/types'
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  DENSITIES,
  MONO_FONTS,
  THEMES,
  UI_FONTS,
  UI_SCALES,
  resolveAccent,
  type Theme
} from '@shared/themes'
import { useStore } from '../store'

/** Updates the store right away so changes preview live, then persists. */
async function save(patch: Partial<Settings>) {
  const st = useStore.getState()
  st.set({ settings: { ...st.settings, ...patch } })
  useStore.getState().set({ settings: await window.api.saveSettings(patch) })
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4 last:border-0">
      <div className="mb-0.5 font-medium">{title}</div>
      {hint && <div className="mb-2.5 text-[12px] text-faint">{hint}</div>}
      <div className={hint ? '' : 'mt-2.5'}>{children}</div>
    </div>
  )
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1 text-[12px] ${value === o.id ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A tiny mock of the app window in a theme's colors. */
function Preview({ theme, accent }: { theme: Theme; accent: string }) {
  const t = theme.tokens
  return (
    <div className="flex h-14 overflow-hidden rounded-md" style={{ background: t.bg, border: `1px solid ${t.line}` }}>
      <div className="flex w-1/3 flex-col gap-1 p-1.5" style={{ background: t.sidebar, borderRight: `1px solid ${t.line}` }}>
        <div className="h-1.5 w-4/5 rounded-full" style={{ background: t.raised }} />
        <div className="flex items-center gap-1">
          <div className="h-1.5 flex-1 rounded-full" style={{ background: t.faint }} />
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        </div>
        <div className="h-1.5 w-3/5 rounded-full" style={{ background: t.raised }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <div className="h-1.5 w-11/12 rounded-full" style={{ background: t.muted }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.faint }} />
        <div className="mt-auto h-3 rounded" style={{ background: t.panel, border: `1px solid ${t.line}` }} />
      </div>
    </div>
  )
}

function ThemeCard({ id, label, selected, children }: { id: string; label: string; selected: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={() => void save({ theme: id })}
      className={`group rounded-lg border p-1.5 text-left ${selected ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-faint'}`}
    >
      <div className="transition-transform duration-150 group-hover:-translate-y-px">{children}</div>
      <div className={`mt-1.5 px-0.5 text-[12px] ${selected ? 'text-fg' : 'text-muted'}`}>{label}</div>
    </button>
  )
}

export function AppearanceSettings() {
  const s = useStore((x) => x.settings)
  const a = { ...DEFAULT_APPEARANCE, ...s }
  const dark = THEMES.find((t) => t.id === 'choo')!
  const light = THEMES.find((t) => t.id === 'choo-light')!
  const isCustom = a.accent.startsWith('#')
  const select = 'rounded-md border border-line bg-bg px-2 py-1 outline-none'

  return (
    <div>
      <Section title="Theme">
        <div className="grid grid-cols-4 gap-2">
          <ThemeCard id="system" label="System" selected={a.theme === 'system'}>
            <div className="relative">
              <Preview theme={dark} accent={resolveAccent(a.accent, true)} />
              <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                <Preview theme={light} accent={resolveAccent(a.accent, false)} />
              </div>
            </div>
          </ThemeCard>
          {THEMES.map((t) => (
            <ThemeCard key={t.id} id={t.id} label={t.label} selected={a.theme === t.id}>
              <Preview theme={t} accent={resolveAccent(a.accent, t.dark)} />
            </ThemeCard>
          ))}
        </div>
      </Section>

      <Section title="Accent" hint="Used for highlights, unread dots, focus rings, links and the cursor.">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c.id}
              title={c.label}
              onClick={() => void save({ accent: c.id })}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${a.accent === c.id ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : ''}`}
              style={{ background: `linear-gradient(135deg, ${c.dark}, ${c.light})` }}
            />
          ))}
          <label
            title="Custom color"
            className={`relative h-6 w-6 cursor-pointer overflow-hidden rounded-full transition-transform hover:scale-110 ${isCustom ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : ''}`}
            style={{ background: isCustom ? a.accent : 'conic-gradient(#f87171, #fbbf24, #4ade80, #38bdf8, #a78bfa, #f472b6, #f87171)' }}
          >
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={isCustom ? a.accent : '#38bdf8'}
              onChange={(e) => void save({ accent: e.target.value })}
            />
          </label>
        </div>
      </Section>

      <Section title="Interface size" hint="Scales text and controls together.">
        <Segmented value={a.uiScale} options={UI_SCALES.map((v) => ({ id: v, label: `${Math.round(v * 100)}%` }))} onChange={(v) => void save({ uiScale: v })} />
      </Section>

      <Section title="Density" hint="How much space sits around rows, buttons and panels.">
        <Segmented value={a.density} options={DENSITIES.map((d) => ({ id: d, label: d[0].toUpperCase() + d.slice(1) }))} onChange={(v) => void save({ density: v })} />
      </Section>

      <Section title="Chat format" hint="Compact folds each stretch of tool calls, and Claude's notes between them, into one Working row you can open. Claude's answer stays in view.">
        <Segmented
          value={s.chatFormat ?? 'full'}
          options={[
            { id: 'full', label: 'Full' },
            { id: 'compact', label: 'Compact' }
          ]}
          onChange={(v) => void save({ chatFormat: v })}
        />
      </Section>

      <Section title="Fonts">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-muted">
            Interface
            <select className={`${select} text-fg`} value={a.uiFont} onChange={(e) => void save({ uiFont: e.target.value })}>
              {UI_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted">
            Code and terminal
            <select className={`${select} text-fg`} value={a.monoFont} onChange={(e) => void save({ monoFont: e.target.value })}>
              {MONO_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 text-[12px] text-faint">Fonts that aren't installed fall back to the system font.</div>
      </Section>

      <Section title="Motion">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={a.reduceMotion} onChange={(e) => void save({ reduceMotion: e.target.checked })} />
          Reduce motion
          <span className="text-[12px] text-faint">Turns off transitions and animations. Spinners keep spinning.</span>
        </label>
      </Section>

      <div className="flex justify-end px-5 py-3">
        <button className="text-[12px] text-muted hover:text-fg" onClick={() => void save({ ...DEFAULT_APPEARANCE })}>
          Reset appearance
        </button>
      </div>
    </div>
  )
}
