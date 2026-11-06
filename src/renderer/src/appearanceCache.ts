import { DEFAULT_APPEARANCE, type AppearanceSettings } from '@shared/themes'

const CACHE_KEY = 'choo:appearance'

/** The last-applied appearance, so the first paint uses it before settings load from disk. */
export function readCachedAppearance(): AppearanceSettings {
  try {
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function writeCachedAppearance(a: AppearanceSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a))
  } catch {
    /* storage disabled */
  }
}
