/**
 * Appearance themes and accents. Each theme is a set of color tokens that map onto the
 * `--color-*` variables in styles.css, so re-skinning the app means editing this file only.
 * "choo" is the default look (the Choo Choo brand, see docs/brand) and matches styles.css exactly.
 */

export type ThemeTokens = {
  bg: string
  panel: string
  sidebar: string
  raised: string
  hover: string
  line: string
  fg: string
  muted: string
  faint: string
  add: string
  del: string
  /** Code block background. */
  code: string
  scroll: string
}

export interface Theme {
  id: string
  label: string
  dark: boolean
  tokens: ThemeTokens
}

export const THEMES: Theme[] = [
  {
    // Brand kit: charcoal #202226, midnight #111218, cream #F4EBD8, ash #A6A7AE, slate #676B73.
    id: 'choo',
    label: 'Choo Choo',
    dark: true,
    tokens: {
      bg: '#202226',
      panel: '#24262b',
      sidebar: '#1a1b20',
      raised: '#2d2f35',
      hover: '#33363c',
      line: '#383b42',
      fg: '#f4ebd8',
      muted: '#a6a7ae',
      faint: '#767a83',
      add: '#4ade80',
      del: '#f87171',
      code: '#111218',
      scroll: '#3f424a'
    }
  },
  {
    // Brand kit light treatment: paper #FFFCF5 and cream #F4EBD8 with charcoal text.
    id: 'choo-light',
    label: 'Choo Choo Light',
    dark: false,
    tokens: {
      bg: '#fbf6ec',
      panel: '#fffcf5',
      sidebar: '#f4ebd8',
      raised: '#ece2cc',
      hover: '#e7dcc4',
      line: '#e2d6bd',
      fg: '#202226',
      muted: '#676b73',
      faint: '#8d9098',
      add: '#15803d',
      del: '#dc2626',
      code: '#f4ebd8',
      scroll: '#d7cab0'
    }
  },
  {
    id: 'dark',
    label: 'Dark',
    dark: true,
    tokens: {
      bg: '#1a1817',
      panel: '#1f1d1c',
      sidebar: '#201e1d',
      raised: '#2a2827',
      hover: '#2f2c2b',
      line: '#33302e',
      fg: '#e8e4e1',
      muted: '#9b9591',
      faint: '#6c6763',
      add: '#4ade80',
      del: '#f87171',
      code: '#141211',
      scroll: '#3a3735'
    }
  },
  {
    id: 'light',
    label: 'Light',
    dark: false,
    tokens: {
      bg: '#fbfaf8',
      panel: '#ffffff',
      sidebar: '#f3f1ee',
      raised: '#ebe8e4',
      hover: '#e6e2dd',
      line: '#e0dcd7',
      fg: '#1f1d1c',
      muted: '#64605c',
      faint: '#99948f',
      add: '#15803d',
      del: '#dc2626',
      code: '#f3f1ee',
      scroll: '#d4cfca'
    }
  },
  {
    id: 'midnight',
    label: 'Midnight',
    dark: true,
    tokens: {
      bg: '#0f141c',
      panel: '#131a24',
      sidebar: '#111720',
      raised: '#1b2431',
      hover: '#212c3b',
      line: '#232e3d',
      fg: '#dfe6ef',
      muted: '#8b98a9',
      faint: '#5c6878',
      add: '#4ade80',
      del: '#f87171',
      code: '#0b0f15',
      scroll: '#2a3646'
    }
  },
  {
    id: 'graphite',
    label: 'Graphite',
    dark: true,
    tokens: {
      bg: '#0d0d0d',
      panel: '#121212',
      sidebar: '#101010',
      raised: '#1c1c1c',
      hover: '#232323',
      line: '#262626',
      fg: '#ededed',
      muted: '#a0a0a0',
      faint: '#6b6b6b',
      add: '#4ade80',
      del: '#f87171',
      code: '#080808',
      scroll: '#333333'
    }
  },
  {
    id: 'forest',
    label: 'Forest',
    dark: true,
    tokens: {
      bg: '#141a17',
      panel: '#18201c',
      sidebar: '#161d19',
      raised: '#212b26',
      hover: '#27332d',
      line: '#2b3731',
      fg: '#e2ebe5',
      muted: '#93a39a',
      faint: '#62716a',
      add: '#6ee7a0',
      del: '#f58b8b',
      code: '#0f1411',
      scroll: '#33423a'
    }
  },
  {
    id: 'plum',
    label: 'Plum',
    dark: true,
    tokens: {
      bg: '#1a1620',
      panel: '#1f1a26',
      sidebar: '#1d1823',
      raised: '#2a2333',
      hover: '#30283a',
      line: '#342c3f',
      fg: '#ebe4f0',
      muted: '#a196ab',
      faint: '#6f6579',
      add: '#4ade80',
      del: '#fb7185',
      code: '#141019',
      scroll: '#3d3449'
    }
  },
  {
    // Warp's bundled "Cyber Wave": deep teal fading to black (#002633 → #000000), white text,
    // and its terminal green/red for diffs. Flattened to solid colors along that gradient.
    id: 'cyberwave',
    label: 'Cyber Wave',
    dark: true,
    tokens: {
      bg: '#001820',
      panel: '#001c26',
      sidebar: '#001219',
      raised: '#062a36',
      hover: '#0a3240',
      line: '#0d3644',
      fg: '#f1f1f1',
      muted: '#8fb0bc',
      faint: '#557a87',
      add: '#b4fa72',
      del: '#ff8272',
      code: '#000d12',
      scroll: '#14404e'
    }
  },
  {
    id: 'paper',
    label: 'Paper',
    dark: false,
    tokens: {
      bg: '#f6f1e7',
      panel: '#fbf7ef',
      sidebar: '#efe8db',
      raised: '#e7dfd0',
      hover: '#e1d8c7',
      line: '#ddd3c1',
      fg: '#2b2620',
      muted: '#6b6255',
      faint: '#9c9282',
      add: '#3f7d20',
      del: '#c2410c',
      code: '#efe8db',
      scroll: '#cfc4b0'
    }
  }
]

/** Accent presets as [on dark, on light] so contrast holds in both. */
export const ACCENTS: { id: string; label: string; dark: string; light: string }[] = [
  // Brand orange on dark; copper on light, as the brand guidelines ask for accent text on light UI.
  { id: 'choo', label: 'Choo Choo Orange', dark: '#f4773d', light: '#9c431a' },
  { id: 'sky', label: 'Sky', dark: '#38bdf8', light: '#0284c7' },
  { id: 'blue', label: 'Blue', dark: '#60a5fa', light: '#2563eb' },
  { id: 'violet', label: 'Violet', dark: '#a78bfa', light: '#7c3aed' },
  { id: 'pink', label: 'Pink', dark: '#f472b6', light: '#db2777' },
  { id: 'orange', label: 'Orange', dark: '#fb923c', light: '#ea580c' },
  { id: 'amber', label: 'Amber', dark: '#fbbf24', light: '#b45309' },
  { id: 'green', label: 'Green', dark: '#4ade80', light: '#16a34a' },
  { id: 'teal', label: 'Teal', dark: '#2dd4bf', light: '#0d9488' },
  // Pairs with the Cyber Wave theme: Warp's terminal magenta on dark, its purple accent on light.
  { id: 'cyberwave', label: 'Cyber Wave Magenta', dark: '#ff8ffd', light: '#7b008f' }
]

// Manrope and JetBrains Mono are bundled with the app (src/renderer/src/assets/fonts).
export const UI_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'manrope', label: 'Manrope', stack: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" },
  { id: 'inter', label: 'Inter', stack: "'Inter', 'Inter Variable', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'rounded', label: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif" },
  { id: 'serif', label: 'Serif', stack: "ui-serif, 'New York', Charter, Georgia, serif" }
]

export const MONO_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'sf', label: 'SF Mono', stack: "'SF Mono', 'JetBrains Mono', Menlo, monospace" },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', 'SF Mono', Menlo, monospace" },
  { id: 'fira', label: 'Fira Code', stack: "'Fira Code', 'SF Mono', Menlo, monospace" },
  { id: 'menlo', label: 'Menlo', stack: "Menlo, Monaco, monospace" }
]

export const UI_SCALES = [0.9, 1, 1.1, 1.25] as const
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const
export type Density = (typeof DENSITIES)[number]

/** Tailwind spacing unit per density (default Tailwind is 0.25rem). */
export const DENSITY_SPACING: Record<Density, string> = { compact: '0.22rem', comfortable: '0.25rem', spacious: '0.285rem' }

export interface AppearanceSettings {
  /** A theme id, or "system" to follow macOS light/dark. */
  theme: string
  /** An accent preset id, or a #rrggbb color. */
  accent: string
  uiScale: number
  density: Density
  uiFont: string
  monoFont: string
  reduceMotion: boolean
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'choo',
  accent: 'choo',
  uiScale: 1,
  density: 'comfortable',
  uiFont: 'manrope',
  monoFont: 'jetbrains',
  reduceMotion: false
}

export function resolveTheme(id: string, systemDark: boolean): Theme {
  if (id === 'system') id = systemDark ? 'choo' : 'choo-light'
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function resolveAccent(accent: string, dark: boolean): string {
  if (/^#[0-9a-f]{6}$/i.test(accent)) return accent
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0]
  return dark ? a.dark : a.light
}

export const uiFontStack = (id: string): string => (UI_FONTS.find((f) => f.id === id) ?? UI_FONTS[0]).stack
export const monoFontStack = (id: string): string => (MONO_FONTS.find((f) => f.id === id) ?? MONO_FONTS[1]).stack
