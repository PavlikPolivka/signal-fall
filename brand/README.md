# Signal Fall design kit

Everything here is generated from the mark geometry the game itself uses (`apps/client/src/ui/mark.ts`)
and the Saira Stencil One typeface. To regenerate after a change:

```sh
pnpm --filter @signal-fall/assets brand
```

The script also copies the favicons and the social image into `apps/client/public/`.

## The mark

A signal-strength meter whose last bar is falling away: the network breaking on the night of Signal Fall.
Three gold bars rise; the fourth, in signal cyan, tips out of line. It always stays inside its 46 × 40 grid.

## Files

| Folder | What | Use it for |
|---|---|---|
| `svg/` | Vector logos. The text is converted to outlines, so no font is needed. | Print, web, any size |
| `png/` | The same logos at 256–2048 px wide (marks at 16–1024 px), transparent | Docs, slides, store pages |
| `icons/` | Favicons (SVG, 16, 32), Apple touch icon (180), app icons (192, 512, maskable 512) | Browsers, home screens |
| `social/og-image.jpg` | 1200 × 630, menu art with the logo | Link previews (Open Graph, X, Discord) |

Each logo comes as `logo` (horizontal), `logo-stacked`, `wordmark` (text only) and `mark` (symbol only), in four
colourways:

| Variant | On | Colours |
|---|---|---|
| `dark` | dark backgrounds (the game's own) | gold `#e8c35a`, bone `#f2efe6`, signal cyan `#3ee6ff` |
| `light` | light backgrounds | deep gold `#a8801c`, ink `#14181d`, cyan `#0a9fbd` |
| `mono-white` | photos, colored backgrounds | white only |
| `mono-black` | one-color print, light photos | black only |

## Colours

| Name | Hex | Role |
|---|---|---|
| Gold | `#e8c35a` | Primary: the bars, "SIGNAL", buttons |
| Bone | `#f2efe6` | "FALL", text on dark |
| Signal cyan | `#3ee6ff` | The falling bar; also Echo, the crystal |
| Night | `#0a0c10` | Backgrounds |
| Holdout | `#c98a3a` | Faction accent (olive and rust in art) |
| Halcyon | `#3ee6ff` | Faction accent (white, graphite, cyan) |
| Choir | `#a78bfa` | Faction accent (violet and amber crystal) |

## Type

- **Saira Stencil One** for the logo and big titles, uppercase, letter-spacing 0.04 em. SIL Open Font License.
- **Rajdhani** (500, 700) for UI text and the website. SIL Open Font License.

## Rules of thumb

- Leave clear space around the logo of at least the height of the "S".
- Don't recolour the falling bar to match the other bars except in the mono variants; it is the point of the mark.
- Don't rotate, stretch or outline the logo. Below about 120 px wide, use the mark alone.
