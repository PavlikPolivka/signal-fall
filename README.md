# Signal Fall

A fast, C&C-style sci-fi RTS for the browser: three asymmetric factions (Holdout, Halcyon, Choir), procedural isometric maps, skirmish vs AI and 1v1 peer-to-peer multiplayer. Built end to end by Claude Code, assets included.

**https://signal-fall.app** (landing page) · **play: https://signal-fall.app/play/**

See [docs/DESIGN.md](docs/DESIGN.md) for the full design.

## Status

| Milestone | State |
|---|---|
| M0 Foundations | ✅ |
| M1 Sim core | ✅ |
| M2 Client | ✅ |
| M3 Economy and base building | ✅ |
| M4 Map generator | ✅ |
| M5 AI, first playable | ✅ (human playtest pending) |
| M6 Art and audio (Holdout) | ✅ |
| M7 Halcyon and Choir | ✅ |
| M8 Multiplayer | ✅ (live cross-network 20-minute match pending) |
| M9 Polish and release | ✅ |

## Layout

| Path | What |
|---|---|
| `packages/data` | Game data as JSON (units, structures, upgrades, damage matrix, keymap) with zod schemas, cross-reference validation and compilation to integer sim rules |
| `packages/sim` | Deterministic headless simulation: map grid, SoA entity store, A* and flow fields, steering, combat with the damage matrix, veterancy, shields, fog of war, victory. Integer/fixed-point only; see the determinism rules below |
| `packages/mapgen` | Seeded, symmetric procedural maps (2–8 players, 3 sizes, 3 biomes, resource and terrain styles) with validation and seed+1 retry |
| `packages/ai` | Deterministic AI player (economy, base planning, counter-production, waves, harassment, defense) at Easy/Normal/Hard/Brutal; profiles in `packages/data/json/ai` |
| `packages/net` | Lockstep scheduler, reliable delivery over lossy datagrams, transports (loopback; WebRTC and Supabase signaling live in the client) |
| `apps/client` | Browser client: Vite + PixiJS + Preact, sim in a Web Worker. URL params: `seed`, `size` (S/M/L), `biome` (city/wasteland/crystal), `resources`, `terrain`, `speed`, `scenario` (skirmish/sandbox/stress) |
| `apps/headless` | CLI: `run` matches headless and print state hashes, `bench` the 400-unit battle |
| `apps/agent` | MCP server: AI agents (LLMs) play matches, marked as AI agents; replays watchable in the game. See [docs/AGENTS.md](docs/AGENTS.md) (`pnpm -s agent`) |
| `packages/scenario` | Match setup from a scenario spec, replays, match statistics (shared by the client and the agent server) |
| `e2e` | Playwright tests, including the cross-browser golden hash |
| `tools/codegen` | Generators for checked-in tables (trig lookup tables) |
| `tools/assets` | Art pipeline: Blender models and renders (`blender/`), atlas and icon packer (`pack.ts`), procedural terrain textures (`terrain.ts`), map debug renders (`mapshot.ts`) |
| `tools/size` | Initial-load size budget (15 MB per match) |
| `tools/video` | Playwright recordings for marketing clips and map screenshots |
| `apps/client/src/audio` | Synthesized sound effects and the generative score (no audio files) |

## Development

Requires Node 22 (`.nvmrc`) and pnpm via corepack.

```sh
corepack enable
pnpm install
pnpm check                 # typecheck + lint + tests
pnpm headless run --seed 1 --ticks 10000
pnpm headless bench        # 400-unit battle, fails above 4 ms/tick
pnpm headless balance --a holdout:hard --b holdout:easy --matches 200 --out out.csv   # AI vs AI
pnpm e2e                   # Playwright (golden hash in every browser)
pnpm build && pnpm size    # client build and the initial-load budget
```

### Deploy

Static site on Vercel (`vercel.json`: client build, long cache for hashed files, a day for art and video).
Multiplayer backend: Supabase project in Frankfurt (`supabase/`: migrations, the TURN-credentials function;
Cloudflare TURN key in the function secrets).

Domain: `signal-fall.app` (DNS on Cloudflare, records "DNS only": `A @ 76.76.21.21`, `CNAME www
cname.vercel-dns.com`, plus Resend's mail records). `www` and `signal-fall.vercel.app` redirect to it.

Accounts: everyone starts as an anonymous guest with a `profiles` row (display name). Confirming an
email (Account → Send link) turns the guest into a permanent account with the same user id, so the
name and history stay; other devices sign in with an emailed link. Auth URLs: site `https://signal-fall.app`, redirects allowed for it, the old
`signal-fall.vercel.app` and localhost. Email goes through Resend (SMTP `smtp.resend.com`, sender
`Signal Fall <noreply@signal-fall.app>`, 30 emails an hour; the API key lives only in the Supabase
dashboard settings).

Multiplayer is 1v1 or 2v2: the lobby has a seat per player (open, a person, or an AI the host
adds); every pair of people opens its own WebRTC data channel (full mesh, the lower signaling id
offers), and lockstep runs over all of them. AI seats run identically inside every client.

Stats: each player records their own row in `matches` when a match ends (skirmish: personal
history and records). A multiplayer match is rated when both players' rows agree (room, final
state hash, opposite results); a trigger then updates both Elo ratings (`ratings`, K = 32). The
`leaderboard` view lists saved accounts; `my_records` aggregates the caller's results.

Pushes to `main` deploy automatically (the GitHub repo is connected to the Vercel project). Manual deploy:

```sh
vercel deploy --prod --archive=tgz      # one archive upload; the free plan limits file counts
supabase db push && supabase functions deploy turn-credentials --no-verify-jwt
```

### Art

Generated assets are committed; CI has no Blender. To regenerate (Blender 4.x/5.x on PATH):

```sh
blender -b --factory-startup -P tools/assets/blender/render.py -- holdout tools/assets/build/raw/holdout
blender -b --factory-startup -P tools/assets/blender/render_icons.py -- holdout tools/assets/build/raw/holdout/icons
blender -b --factory-startup -P tools/assets/blender/render_props.py -- tools/assets/build/raw/props
pnpm --filter @signal-fall/assets atlas holdout      # and: atlas props
pnpm --filter @signal-fall/assets atlas holdout 2x   # 2x WebP atlases for Ultra graphics (each faction and props)
pnpm --filter @signal-fall/assets terrain            # procedural terrain textures
```

Firefox e2e runs on Linux only (locally there too): Playwright's Firefox build does not launch on macOS 27. CI covers it.

## Determinism rules

The sim, map generator and AI must produce bit-identical results in every JS engine. ESLint enforces it for `packages/sim`, `packages/mapgen` and `packages/ai`:

- No `Math.random`, clocks, or float math functions (`Math.sin`, `sqrt`, `floor`, …). Allowed: `imul`, `abs`, `min`, `max`, `sign`, `clz32`.
- No float literals, no `/` or `**`. Positions are Q10 fixed point (1024 = one tile); use `idiv`, `fmul`, `isqrt`, `isin`, `iatan2` from `packages/sim/src/fx.ts`.
- No `for…in` or `Object.keys/values/entries`. Use arrays and `Map` (insertion ordered).
- The only input is commands, applied at a scheduled tick. State is hashed with xxHash32.

Game data may use decimals in JSON (tiles, seconds); `packages/data` compiles them once to integer ticks and Q10 values.

## License

Code: MIT. Assets keep their own licenses, tracked in `assets/LICENSES.json`.
