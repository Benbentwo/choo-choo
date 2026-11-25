import type { Settings } from './types'

/** Claude Code's own name for its default output style. Passing it overrides a style set in ~/.claude/settings.json. */
export const DEFAULT_OUTPUT_STYLE = 'default'

/** Our marker for "use the custom output style prompt from Settings". Not a Claude Code style name. */
export const CUSTOM_OUTPUT_STYLE = '@custom'

/**
 * What to send Claude Code for a chat's output style.
 * `style` goes in the SDK's `settings.outputStyle`; nothing means Claude Code uses its own setting.
 * `append` is the custom prompt, added to the end of the system prompt.
 *
 * The chat's own pick wins; without one, the Settings default applies. A custom prompt runs on top of
 * Claude Code's default style, so a style set in ~/.claude doesn't pull the other way.
 */
export function resolveOutputStyle(chatStyle: string | undefined, settings: Pick<Settings, 'outputStyle' | 'outputStyleCustom'>): { style?: string; append?: string } {
  const pick = chatStyle || settings.outputStyle
  if (!pick) return {}
  if (pick !== CUSTOM_OUTPUT_STYLE) return { style: pick }
  const custom = settings.outputStyleCustom?.trim()
  return custom ? { style: DEFAULT_OUTPUT_STYLE, append: `# Output style\n\n${custom}` } : {}
}

/** How to show a style name in a menu. */
export function outputStyleLabel(name: string | undefined): string {
  if (!name) return "Claude Code's setting"
  if (name === DEFAULT_OUTPUT_STYLE) return 'Default'
  if (name === CUSTOM_OUTPUT_STYLE) return 'Custom'
  return name
}
