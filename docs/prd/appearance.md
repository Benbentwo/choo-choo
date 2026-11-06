# PRD: Appearance

| | |
|---|---|
| Status | Shipped (PR #15; brand kit PR #17) |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

People spend all day in this window. They want it to look the way they like, and Choo Choo needs its own brand rather than borrowing Conductor's look.

## Goals

- Themes, accent color, interface size, density, fonts and reduced motion, all applied live.
- Choo Choo's brand theme and accent as the default.

## User experience

Settings > Appearance:

- **Theme**: Choo Choo (dark), Choo Choo Light, Dark, Light, Midnight, Graphite, Forest, Plum, Cyber Wave (from Warp), Paper, or System (follows macOS, using the Choo Choo pair).
- **Accent**: Choo Choo Orange (default), Sky, Blue, Violet, Pink, Orange, Amber, Green, Teal, Cyber Wave Magenta, or any `#rrggbb`.
- **Size** (interface zoom), **density** (comfortable or compact).
- **UI font**: Manrope (bundled, default), System, Inter, Rounded, Serif. **Code font**: JetBrains Mono (bundled, default), SF Mono, Fira Code, Menlo.
- **Reduce motion**.

## Requirements

1. All colors and font stacks live in `src/shared/themes.ts`. Re-skin there, not in `styles.css`.
2. Appearance is cached so the first paint uses the saved theme (no flash).
3. Each accent has a dark and a light variant with readable contrast.

## Design

`src/shared/themes.ts` (`THEMES`, accents, fonts, `DEFAULT_APPEARANCE`, `resolveTheme`), `src/renderer/src/appearance.ts` and `appearanceCache.ts`, `components/Appearance.tsx`. Brand assets in `docs/brand/`; logo component `BrandMark.tsx`; app icon `resources/icon.icns`. Fonts are bundled under OFL in `src/renderer/src/assets/fonts`.

## Testing

`test/themes.test.ts`.

## Future work

- DMG background art (not in the brand kit).
- Ben wants to keep iterating on the branding.
