# Signal Fall

A fast, C&C-style sci-fi RTS for the browser: three asymmetric factions (Holdout, Halcyon, Choir), procedural isometric maps, skirmish vs AI and 1v1 peer-to-peer multiplayer. Built end to end by Claude Code, assets included.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Status

| Milestone | State |
|---|---|
| M0 Foundations | ✅ |
| M1 Sim core | ⏳ |
| M2 Client | |
| M3 Economy and base building | |
| M4 Map generator | |
| M5 AI, first playable | |
| M6 Art and audio (Holdout) | |
| M7 Halcyon and Choir | |
| M8 Multiplayer | |
| M9 Polish and release | |

## Layout

| Path | What |
|---|---|
| `packages/data` | Game data as JSON (units, structures, upgrades, damage matrix, keymap) with zod schemas, cross-reference validation and compilation to integer sim rules |
| `packages/sim` | Deterministic headless simulation. Integer/fixed-point only; see the determinism rules below |
| `apps/headless` | CLI: run matches headless, print state hashes |
| `tools/codegen` | Generators for checked-in tables (trig lookup tables) |

## Development

Requires Node 22 (`.nvmrc`) and pnpm via corepack.

```sh
corepack enable
pnpm install
pnpm check                 # typecheck + lint + tests
pnpm headless run --seed 1 --ticks 10000
```

## Determinism rules

The sim, map generator and AI must produce bit-identical results in every JS engine. ESLint enforces it for `packages/sim`, `packages/mapgen` and `packages/ai`:

- No `Math.random`, clocks, or float math functions (`Math.sin`, `sqrt`, `floor`, …). Allowed: `imul`, `abs`, `min`, `max`, `sign`, `clz32`.
- No float literals, no `/` or `**`. Positions are Q10 fixed point (1024 = one tile); use `idiv`, `fmul`, `isqrt`, `isin`, `iatan2` from `packages/sim/src/fx.ts`.
- No `for…in` or `Object.keys/values/entries`. Use arrays and `Map` (insertion ordered).
- The only input is commands, applied at a scheduled tick. State is hashed with xxHash32.

Game data may use decimals in JSON (tiles, seconds); `packages/data` compiles them once to integer ticks and Q10 values.

## License

Code: MIT. Assets keep their own licenses, tracked in `assets/LICENSES.json`.
