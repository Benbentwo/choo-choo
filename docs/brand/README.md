# Choo Choo brand

Assets from the Choo Choo Brand Kit v1.0. The full guidelines are in [Choo-Choo-Brand-Guidelines.pdf](Choo-Choo-Brand-Guidelines.pdf) and the one-page summary is [brand-overview.png](brand-overview.png).

| Color | Hex | Use |
| --- | --- | --- |
| Charcoal | `#202226` | Dark background |
| Midnight | `#111218` | Deepest surfaces (code blocks) |
| Cream | `#F4EBD8` | Text on dark, light background |
| Paper | `#FFFCF5` | Light panels |
| Amber | `#FFC46B` | Headlight |
| Orange | `#F4773D` | Accent on dark |
| Copper | `#9C431A` | Accent text on light |
| Slate | `#676B73` | Muted text on light |
| Ash | `#A6A7AE` | Muted text on dark |

Fonts: Manrope for UI and the wordmark (750 weight, -0.025em tracking), JetBrains Mono for code.

Where it's used in the app:

- Colors and fonts: the "Choo Choo" and "Choo Choo Light" themes and the "Choo Choo Orange" accent in `src/shared/themes.ts`, which are the defaults.
- Logo: `src/renderer/src/components/BrandMark.tsx` draws the mark in the theme's text color.
- App icon: `resources/icon.icns` (packaged builds) and `resources/icon.png` (Dock icon in dev).

Logo files: "dark" means a cream logo for dark backgrounds, "light" a charcoal logo for light backgrounds.

The Choo Choo name and marks are not covered by the repository's MIT license.
