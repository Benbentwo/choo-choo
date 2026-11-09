import { useEffect } from 'react'
import {
  DEFAULT_APPEARANCE,
  DENSITY_SPACING,
  monoFontStack,
  resolveAccent,
  resolveTheme,
  uiFontStack,
  type AppearanceSettings
} from '@shared/themes'
import { useStore } from './store'
import { readCachedAppearance, writeCachedAppearance } from './appearanceCache'

export const APPEARANCE_EVENT = 'choo:appearance'
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** Light themes darken the few Tailwind palette colors used for status text so they stay readable. */
const LIGHT_OVERRIDES: Record<string, string> = {
  '--color-sky-400': '#0284c7',
  '--color-sky-500': '#0284c7',
  '--color-yellow-400': '#a16207',
  '--color-amber-400': '#b45309',
  '--color-violet-400': '#7c3aed',
  '--color-advisor': '#7c3aed'
}

export function resolved(a: AppearanceSettings) {
  const theme = resolveTheme(a.theme, systemDark())
  return { theme, accent: resolveAccent(a.accent, theme.dark), mono: monoFontStack(a.monoFont) }
}

/** Colors for xterm, which can't read CSS variables. */
export function terminalTheme(a: AppearanceSettings) {
  const { theme, accent } = resolved(a)
  const t = theme.tokens
  return { background: t.bg, foreground: t.fg, cursor: accent, cursorAccent: t.bg, selectionBackground: `${accent}40` }
}

let last = ''
export function applyAppearance(a: AppearanceSettings, animate = true) {
  const { theme, accent, mono } = resolved(a)
  const vars: Record<string, string> = {
    ...Object.fromEntries(Object.entries(theme.tokens).map(([k, v]) => [`--color-${k}`, v])),
    '--color-accent': accent,
    '--font-sans': uiFontStack(a.uiFont),
    '--font-mono': mono,
    '--spacing': DENSITY_SPACING[a.density] ?? DENSITY_SPACING.comfortable
  }
  if (!theme.dark) Object.assign(vars, LIGHT_OVERRIDES)
  const key = JSON.stringify([vars, a.uiScale, a.reduceMotion])
  if (key === last) return
  const root = document.documentElement
  for (const k of Object.keys(LIGHT_OVERRIDES)) root.style.removeProperty(k)
  const themeChanged = last !== '' && root.dataset.theme !== theme.id
  last = key

  // Cross-fade colors when switching themes, then drop the transition so it costs nothing later.
  if (animate && themeChanged && !a.reduceMotion) {
    root.classList.add('theme-fade')
    window.setTimeout(() => root.classList.remove('theme-fade'), 320)
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.toggleAttribute('data-reduce-motion', a.reduceMotion)
  window.api?.setZoom(a.uiScale || 1)
  writeCachedAppearance(a)
  window.dispatchEvent(new Event(APPEARANCE_EVENT))
}

/** Apply the last-used appearance before first paint, so a light theme doesn't flash dark at launch. */
export function applyCachedAppearance() {
  applyAppearance(readCachedAppearance(), false)
}

export function pickAppearance(s: AppearanceSettings): AppearanceSettings {
  const { theme, accent, uiScale, density, uiFont, monoFont, reduceMotion } = { ...DEFAULT_APPEARANCE, ...s }
  return { theme, accent, uiScale, density, uiFont, monoFont, reduceMotion }
}

/** Keeps the document in sync with saved settings and with macOS light/dark when the theme is "system". */
export function useAppearance() {
  const settings = useStore((s) => s.settings)
  const a = pickAppearance(settings)
  const key = JSON.stringify(a)
  useEffect(() => {
    applyAppearance(a)
    if (a.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyAppearance(a)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
