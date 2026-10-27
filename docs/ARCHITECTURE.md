# Signal Fall: architecture

How the code is put together. For setup and commands see the [README](../README.md); for playing with an LLM agent,
[AGENTS.md](AGENTS.md); for browser keyboard capture, [KEYBOARD.md](KEYBOARD.md). Game design, plans and progress are
tracked outside the repo.

## Technical architecture

A TypeScript monorepo built around one deterministic, headless simulation package. The client, AI, network layer, replays and test tools all drive the same sim through commands.

### Stack

TypeScript (strict), pnpm workspaces, Vite, PixiJS v8 for the game world, Preact for UI panels, Vitest for unit tests, Playwright for browser smoke tests, zod for data schemas. Pin exact versions in the lockfile. Repository: git@github.com:PavlikPolivka/signal-fall.git, public from day one, code under the MIT license (assets keep their own licenses, tracked in LICENSES.json). No secrets in the repo: the Supabase anon key is public by design and protected by RLS, the TURN shared secret lives in Edge Function secrets, and deploy tokens live in GitHub Actions secrets.

### Packages

| Package | Responsibility |
|---|---|
| packages/sim | Deterministic game state and systems: movement, pathfinding, combat, economy, production, fog. No DOM, no I/O. |
| packages/data | JSON definitions: units, structures, upgrades, damage matrix, keymap, AI build orders. zod schemas, validated in CI. |
| packages/mapgen | Seeded procedural map generator and validator. |
| packages/ai | AI player that reads sim state and emits commands. |
| packages/net | Transport interface, lockstep scheduler, WebRTC transport, Supabase signaling and lobby. |
| apps/client | Renderer, input, camera, UI, audio. Runs the sim in a Web Worker. |
| apps/headless | CLI: run matches, replay files, AI-vs-AI balance batches, desync bisection. |
| packages/scenario | Match setup from a scenario spec, campaigns and missions, replays, match statistics. |
| apps/agent | MCP server for LLM agents ([AGENTS.md](AGENTS.md)). |
| tools/assets | Blender render scripts, sprite atlas packer, SFX generator, license manifest. |
| supabase/ | Database migrations, row-level security policies, edge functions. |

### Determinism rules (enforced, not advisory)

- Fixed tick: 20 ticks/s; the renderer interpolates between ticks for 60+ FPS.
- No floats in the sim: positions and velocities are int32 fixed-point (1/1024 tile). Trig uses lookup tables; sqrt is integer.
- One seeded PRNG in sim state (e.g. xoshiro128\*\*), with derived streams per subsystem (combat, AI, mapgen).
- Stable iteration: entities processed in ascending id order; systems run in a fixed order.
- Banned in packages/sim: Math.random, Date, performance.now, floating-point math functions, unordered object-key iteration. An ESLint rule enforces this.
- Commands are the only input, applied at a scheduled tick.
- State hash (xxhash32 of the serialized state) every 20 ticks; tests run the same seed and commands twice and compare hashes.
- Replays are seed + map params + command log.

### Rendering

- 2:1 isometric tiles (64×32 px), depth-sorted by isometric y with layers for ground, shadows, units, air, effects, UI.
- Sprite atlases per faction. Infantry: 8 directions. Vehicles: 16 directions, turret as a separate sprite. Buildings: 1 direction plus construction and damaged states.
- Team color via a separate mask layer per sprite. At match start the colors are baked into the sprite pages for every
  player, so a 400-unit battle is a handful of draw calls.
- Hills: the ground mesh rises with a height field; units, buildings, effects and fog follow it, and clicks account
  for height. The sim itself stays flat (Graphics → Terrain → Flat turns the hills off).
- Fog of war as a low-resolution texture over the world; minimap drawn to its own small canvas.
- The sim worker posts a compact typed-array snapshot each tick; the main thread renders and sends commands back.

### Pathfinding and movement

- Tile nav grid, updated incrementally when structures are built or destroyed.
- Group moves: flow field to the target, cached per target for a few seconds. Single units: A\*. Move to hierarchical pathfinding only if profiling demands it.
- Separation steering for local avoidance; groups keep relative offsets as a loose formation.
- Harvesters queue at refineries; air units ignore the nav grid.

### Performance targets

- 400 units total at 60 FPS on a mid-range laptop (integrated GPU).
- Sim tick at most 4 ms with 400 units.
- Initial load under 15 MB, with atlases loaded per faction in use.

## Multiplayer and backend

Multiplayer uses deterministic lockstep over a peer-to-peer WebRTC data channel. Supabase handles rooms and signaling, and a coturn server on the homelab relays only when a direct connection fails. Running cost: zero.

### Lockstep

- Turn = 2 sim ticks (100 ms). Each peer sends its commands for turn N + delay; an empty turn is a tiny heartbeat.
- Input delay adapts to round-trip time: 2–6 turns (200–600 ms worst case; typical European 1v1 at the low end).
- The sim advances a turn only when it has every peer's input for it. After 3 s of stalling, show "Waiting for player".
- State hashes are exchanged every 20 ticks. On mismatch in v1 the match ends as a desync and both clients upload a desync report (seed, params, command log, last snapshots) for debugging with apps/headless.

### Transport interface

One interface, three implementations: WebRTC data channel (reliable, ordered), Supabase Realtime broadcast (fallback relay), and local loopback (vs AI and tests). Lockstep code never knows which one it is using.

### Connection flow

1. Player opens the site; the client signs in anonymously with Supabase Auth.
2. Host creates a room; Supabase stores it and returns a 6-character room code.
3. Guest enters the code and joins the room's Realtime channel (presence shows both players).
4. Peers exchange WebRTC offers and ICE candidates over that channel. ICE servers: a public STUN server plus the homelab TURN, with short-lived credentials minted by a Supabase Edge Function (TURN REST API shared secret).
5. Data channel opens; lobby state (faction, color, map params, ready) syncs over it.
6. Host sends the start message (seed, params, start turn); both run the match P2P.
7. At the end, both clients post the result; the match record is stored in Supabase.

### Rules and limits

- **Disconnects:** a player who drops can reconnect after a refresh; in 2v2 a dropped player can be replaced by the AI.
- **Cheating:** each client holds full state, so map hacks are possible. A rated match counts only when both players'
  reports agree (room, final state hash, opposite results).
- **Supabase free tier:** inactive free projects can be paused, and Realtime has message quotas. Lobby and signaling
  traffic is small; game traffic doesn't go through Supabase except in fallback mode.
- **Hosting:** the client is a static build on Vercel (Hobby plan), served over HTTPS since WebRTC requires a secure
  context. Content-hashed asset filenames with long cache headers keep repeat visits cheap.
- **Data:** the schema is in `supabase/migrations` (accounts, matches and ratings, rooms, ranked queue, daily challenge,
  client errors); the README's Deploy section describes accounts and stats.

## Asset pipeline

Generated assets are committed; CI has no Blender. The README lists the commands to regenerate them.

| Asset | Where | How |
|---|---|---|
| Units, buildings | `tools/assets/meshy` (generated models, prompts and task ids), `tools/assets/blender` | Meshy models (`meshy.ts`, rigged with `meshy-rig.ts`), compacted, then rendered headless in Blender to sprite sheets and packed into atlases (`pack.ts`), 1× and 2× |
| Icons, portraits, key art | `tools/assets/blender/render_icons.py`, `render_keyart.py` | Close-up renders of the same models |
| Props | `tools/assets/blender/render_props.py`, `tools/assets/props` | Rendered and packed like units |
| Terrain | `tools/assets/terrain.ts`, `terrain-photo.ts`, `polyhaven.ts` | Procedural and CC0 photo textures |
| Mission art | `tools/assets/missions.ts`, prompts in `tools/assets/missions/images.json` | Gemini image generation |
| Voices | `tools/assets/voices` (`gemini.py`, cast in `gemini.json`; `build.py` for faction treatments) | Gemini text-to-speech, then a radio / synthetic / chord treatment per faction |
| Sound effects, music | `apps/client/src/audio` | Synthesized in code; no audio files |
| UI | `apps/client/src/ui` | SVG plus CSS, faction-themed color tokens |

API keys (Gemini, Meshy) come from the system keychain (`tools/assets/keychain.ts`: the macOS keychain, or the Secret
Service keyring on Linux; service `gemini-api` / `meshy-api`, account `signal-fall`) or the `GEMINI_API_KEY` /
`MESHY_API_KEY` environment variables. Rules for keeping generated models are in `CLAUDE.md`.

### Blender sprite pipeline (tools/assets)

1. Each unit or building is a Python script that builds the model from primitives and modifiers in the faction's shape language (Holdout: boxy plates; Halcyon: hexes and thin struts; Choir: floating crystal shards).
2. Flat-shaded materials from a fixed faction palette, plus one material marked as team color.
3. Orthographic camera at 30° elevation and 45° azimuth (gives true 2:1 isometric), with a fixed sun so all sprites share lighting.
4. Render each direction (8 or 16) and animation frame: a color pass, a team-color mask pass and a shadow pass. Render at 2×, then downsample.
5. Pack into atlases with JSON frame data; a Vitest check verifies every unit in packages/data has a complete set of frames.

Animation budget: infantry walk 6 frames, fire 3, death 4. Vehicles use a static hull and turret with tread or hover effects in code. Buildings have built, damaged and construction (or growth, for Choir) states.

Prerequisite: Blender 4.x or 5.x installed on the dev machine so Claude Code can run it headless (`blender -b -P script.py`).

### Licensing

Only CC0, OFL, or CC-BY assets with attribution. Every imported file is recorded in assets/LICENSES.json (file, source URL, license, author); CI fails if an asset lacks an entry, and the credits screen is generated from it.

### Videos

Drop finished files into `apps/client/public/assets/video/` with these names; the game picks them up and falls back
to the rendered key art when they are missing.

| File | Use | Length | Notes |
|---|---|---|---|
| `menu-loop.mp4` (or `.webm`) | Muted loop behind the setup and lobby screens | 8–15 s, seamless loop | 1920×1080, H.264, ≤ 6 MB. Calm motion; the left 40% sits behind the menu panel, keep the action right of center. |
| `intro.mp4` (or `.webm`) | Cutscene before the first match (skippable) | 30–60 s | 1920×1080, H.264 with AAC audio, ≤ 25 MB. |

## Campaigns

Missions are scenarios (`ScenarioSpec`) with a fixed seed or hand-placed map, preset structures and units, AI per
seat and teams, plus a small deterministic, data-driven trigger system (objectives, timers, areas, scripted waves,
dialogue lines), so campaign replays reproduce exactly. A per-mission allow-list limits units and buildings, and
`packages/scenario/test/campaign.test.ts` fails if anything allowed can't be built. Campaign difficulty (Story,
Normal, Hard) is part of the replay spec.

### Adding a campaign

Campaigns are data: `CAMPAIGNS` in `packages/scenario/src/missions.ts`. Add an entry with an `id`, a `title`, a one-line `blurb`,
its `acts` (names; a mission's `act` is 1-based into this list) and its `missions`. Mission ids must be unique across all
campaigns (a test checks this, and that every act exists). With more than one campaign the campaign screen shows a picker;
progress, "Next mission" and the act tabs work per campaign. Voice lines come from `tools/assets/voices/export-campaign.ts`
(all campaigns), mission art from `tools/assets/missions/images.json` (one prompt per mission id).

An optional `epilogue` (title, speaker, paragraphs) is shown when the campaign's last mission is won, and from the
campaign screen once every mission is won. Its art is `epilogue-<campaign id>` in `images.json`, and its voice lines are
exported as the pseudo-mission `epilogue-<campaign id>`.

Mission data options used by *The Long Way Back* (`packages/scenario/src/long-way-back.ts`): named speakers (cast in
`tools/assets/voices/gemini.json`), `along` positions (a share of the way from the player's start to seat 1's, so a
route holds on any generated map), and the `crates`, `unitCap`, `squad` (out only when every unit is gone) and
`map.points` options.

To see how much pressure each mission puts on a base:
`CAMPAIGN_RUN=1 pnpm --filter @signal-fall/scenario exec vitest run test/campaign-run.test.ts --silent=false` plays
every mission with the built-in AI as the player. That AI ignores objectives, so read it as pressure, not as a pass mark.

## Performance

The game has to hold 60 fps on an ordinary laptop in Chrome, Safari and Firefox-based browsers. Kept by
`e2e/perf.spec.ts`, which runs with the rest of the suite; the sim benchmark (`pnpm headless bench`) fails above
4 ms a tick.

### What the guard checks

| Check | Where it runs | Why |
|---|---|---|
| A 400-unit battle draws in under 40 draw calls a frame (it takes 4) | everywhere, CI included | A draw call per unit sank Firefox (its WebGL calls cross into a GPU process) |
| No `mix-blend-mode` or `backdrop-filter` on anything visible in a match | everywhere | A CSS blend over the game canvas made Firefox recomposite the build list every frame |
| The game's own work per frame under 6 ms | everywhere | Room for the browser inside a 16.7 ms frame |
| The battle holds ≥ 58 fps with a 95th-percentile frame under 20 ms | with a real GPU (Metal on macOS) | The goal itself; skipped on software rendering (CI) |
| 400 units at ≥ 58 fps (older test) | with a real GPU | |

The perf tests run one at a time: frame rates need the GPU to themselves.

Two rules that came out of it: keep a battle to a handful of draw calls (Firefox's WebGL calls cross into a GPU
process), and never put `mix-blend-mode` or `backdrop-filter` over the game canvas.

### Measuring Firefox

Playwright's Firefox doesn't start on macOS 27; the measurements drove a separate headless Zen over Marionette
(`layout.css.devPixelsPerPx = 2` for Retina) with its own throwaway profile. A Firefox window that isn't in
front is throttled to a few frames a second, so headed runs in the background measure nothing.
