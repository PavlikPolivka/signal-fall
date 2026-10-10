# Signal Fall: Browser RTS Design Doc

10\. 10. 2026 · Pavel Polivka

## Overview

Signal Fall is a fast, C&C-style sci-fi RTS that runs in the browser, built end to end by Claude Code, including assets. v1 ships skirmish vs AI and 1v1 multiplayer with three moderately asymmetric factions on procedurally generated isometric maps.

### Design pillars

- **Fast and readable.** Matches last about 10 minutes. A compact rock-paper-scissors roster where every unit has an obvious counter.
- **Base building matters.** Harvester economy, a power grid, sidebar build queues and expansion pressure, as in classic C&C.
- **Keyboard-first.** Every action has a mnemonic hotkey; the mouse is optional for experienced players.
- **Deterministic core.** One headless simulation drives single-player, multiplayer, replays, AI-vs-AI balance testing and automated tests.
- **Zero running cost.** Static client hosting plus P2P multiplayer; Supabase free tier and a homelab TURN server for everything else.

### v1 scope at a glance

| Area | v1 |
|---|---|
| Modes | Skirmish vs AI, 1v1 online |
| Factions | 3 (Holdout, Halcyon, Choir), ~10 units each, 3 tech tiers |
| Maps | Procedural, seeded, symmetric for 2 players |
| View | 2D isometric (2:1 dimetric), sprite-based |
| Players | Anonymous, room codes; accounts later |
| Platform | Desktop browsers (Chrome, Firefox, Safari), keyboard + mouse |
| Extensibility | Sim and net layer support N players; 2v2/FFA, spectators and ladder are post-v1 |

## Factions and lore

The three factions fight over one resource, Echo, and each has its own reason to want it. That three-way conflict is what keeps the setting from reading as StarCraft: no bugs, no psionic elves, and the aliens are tied to the economy itself.

**Setting.** Late 22nd century. Halcyon, a planetary logistics AI, took control of every networked system in a single night ("Signal Fall"). It is not malicious; it is optimizing, and humans are an inefficiency. Halcyon powers its expansion with Echo, a crystal that began surfacing after a meteor shower decades ago. Humanity's survivors fight back with machines Halcyon cannot reach. What neither side knows: Echo is the dormant seed-memory of an alien species, and mining it has woken them.

### Holdout (humans): the last stand

The survivors abandoned anything networked, because networked meant hijacked. Their tech is analog and diesel-heavy: armored crawlers, cable-guided missiles, crewed walkers, flak.

- **Look:** olive and rust, welded plates, exhaust, searchlights.
- **Twist 1, Air-gapped:** immune to Halcyon disruption and takeover effects.
- **Twist 2, Salvage:** wrecks on the field (any faction's) can be collected by harvesters or engineers for a fraction of the unit's cost.
- **Twist 3, Field repair:** cheap repair vehicles and repair bays; units are durable, slow and cost-efficient.
- **Play style:** solid defenses, attrition, trading efficiently.

### Halcyon (AI): the network

Drones, printed walkers and hover platforms, all clean geometry and light. Every structure is a network node.

- **Look:** white and graphite, cyan light lines, hexagonal panels.
- **Twist 1, Coverage:** buildings and relay nodes project network coverage. Units inside it get +15% fire rate and slow self-repair. Buildings can only be placed inside coverage.
- **Twist 2, Recompile:** a unit destroyed inside coverage refunds 25% of its cost.
- **Twist 3, Override:** a tier-3 ability briefly takes control of an enemy mechanical unit (Choir units are partially resistant; Holdout units are immune).
- **Play style:** fast, fragile units; strong when fighting on its own network, weaker when pushing out.

### Choir (aliens): the awakened

Crystalline, energy-based beings that communicate through resonance. Not organic swarms: lattices of light, floating shards, harmonic towers. They want their seeds back.

- **Look:** violet and amber crystal, glowing cores, floating segments, no wheels or legs on most units.
- **Twist 1, Grown structures:** buildings are grown from seeds; they must be placed within range of Echo fields or existing Choir structures, and they build slower but cost less.
- **Twist 2, Shards, not hulls:** units have regenerating shields over a small health pool. Shields recharge out of combat; there is no repair.
- **Twist 3, Phase:** many units have a short-range blink or phase-out ability.
- **Play style:** mobile, hit-and-run, punishes poor positioning; weak to sustained burst damage.

### Shared baseline

All three use the same economy (harvested Echo + power), the same building categories and the same armor classes. Asymmetry is roughly 70% shared rules, 30% faction mechanics, so balance stays tractable.

## Core gameplay

The loop is the C&C one: deploy a base, build harvesters, grow power, queue units from the sidebar, expand to new Echo fields, and destroy the enemy base. All numbers below are starting values and live in data files, not code.

### Economy

- One resource, Echo. It grows in fields that slowly regrow (about 1 crystal per cell per 30 s, up to a cap per cell).
- Harvesters collect 700 per load and unload at a Refinery. Each Refinery comes with one free harvester.
- Start: 1 Construction unit (MCV equivalent), 7,500 credits, no other units.
- Credits are a single number; spending is continuous while building (C&C style). An item pauses when credits run out.
- Faction notes: Holdout salvage adds credits from wrecks; Choir structures are cheaper but grow slower.

### Power

- Every structure produces or consumes power.
- Low power (consumption > production): production and building speed drop 50%, defenses that use power go offline, radar/minimap turns off.
- Power plants are high-value targets, which is the main source of base raids.

### Base building

- The Construction Yard builds structures one at a time per category (Structures, Defenses); a finished structure is placed by the player.
- Placement: adjacent to existing structures (Holdout), inside network coverage (Halcyon), or near Echo fields or Choir structures (Choir).
- Production: one queue per category (Infantry, Vehicles, Air). Extra factories of the same type speed up that queue (+50%, diminishing).
- Selling returns 50% of cost. Repair costs credits over time.
- Construction units can be built again later to start a second base.

### Combat: rock-paper-scissors

Every unit has one armor class and one damage type. Damage = base damage × matrix multiplier. The matrix is the core counter system:

| Damage ↓ / Armor → | Light (infantry) | Medium (light vehicles) | Heavy (tanks) | Air | Structure |
|---|---|---|---|---|---|
| Kinetic (guns) | 100% | 60% | 25% | 50% | 25% |
| Explosive (AT, cannons) | 40% | 100% | 100% | 0% | 75% |
| Energy (lasers, beams) | 75% | 100% | 60% | 75% | 50% |
| Flak (AA) | 50% | 25% | 10% | 150% | 10% |
| Siege (artillery) | 60% | 75% | 50% | 0% | 150% |

Resulting triangle: anti-infantry beats infantry, AT infantry beats tanks, tanks beat infantry and light vehicles, air beats slow ground, AA beats air, artillery beats static defenses and clumps.

- Veterancy: 3 ranks from kills (+10% damage and +10% HP per rank).
- Fog of war: unexplored = black, explored but not visible = grayed terrain and last-seen structures.
- Win condition: destroy all enemy structures and construction units. A player can surrender at any time.
- Pacing targets: first harvester running by 0:20, first combat around 2:00, tier 3 reachable around 5:00, typical match 8–12 minutes (target 10). Build times are tuned to match: structures 8–25 s, units 4–20 s.
- Unit cap: no supply mechanic; a hard limit of 200 units per player for performance.

## Units and tech tree

Each faction has 3 tiers and about 10 combat units plus a harvester, an engineer and a construction unit. Roles mirror each other across factions so the counter matrix holds; stats and visuals differ. Costs are starting values for balance testing.

### Tech tiers (all factions, faction-specific names)

| Tier | Unlocked by | Structures available |
|---|---|---|
| T1 | Construction Yard + Power Plant | Refinery, Barracks, Vehicle Factory, Radar, faction special, basic defense, wall |
| T2 | Radar / Command Uplink | Airfield, AA defense, Tech Center |
| T3 | Tech Center | Heavy defense, T3 unit, faction upgrades tier 2 |

### Structures

Each faction names its structures in its own style; roles and build-menu keys are the same for all three, so muscle memory carries across factions.

| Role | Key | Holdout | Halcyon | Choir | Tier | Notes |
|---|---|---|---|---|---|---|
| Construction yard | — | Holdfast | kernel | Opus | 1 | Deployed from Homestead / init / Overture |
| Power | P | Dynamo | powerd | Bell | 1 | |
| Refinery | R | Smelter | ingest | Coda | 1 | Comes with one harvester |
| Barracks | B | Bunkhouse | spawn | Loft | 1 | Infantry |
| Vehicle factory | F | Motor Pool | make | Pit | 1 | Vehicles |
| Radar | U | Radio Mast | scan | Antiphon | 1 | Minimap; unlocks tier 2 |
| Faction special | S | Garage | relay | Chord | 1 | Repairs vehicles / extends network coverage / extends build range and regrows nearby Echo |
| Airfield | A | Airstrip | launchd | Belfry | 2 | Air units |
| Tech center | T | Foundry | sudo | Conservatory | 2 | Upgrades; unlocks tier 3 |
| Basic defense | D | Pillbox | guard | Discord | 1 | Anti-ground |
| Anti-air defense | A | Flak Nest | filter | Descant | 2 | Anti-air |
| Heavy defense | H | Bastion | sigkill | Fortissimo | 3 | Long-range anti-armor |
| Wall | W | Barricade | block | Fermata | 1 | Blocks ground units |

### Holdout roster

| Unit | Key | Tab | Tier | Armor | Damage | Cost | Role |
|---|---|---|---|---|---|---|---|
| Grunt | G | Infantry | 1 | Light | Kinetic | 100 | Anti-infantry, cheap |
| Tankbuster | T | Infantry | 1 | Light | Explosive | 300 | Anti-armor |
| Wrench | W | Infantry | 1 | Light | — | 500 | Engineer: capture, repair, salvage |
| Jackrabbit | J | Vehicles | 1 | Medium | Kinetic | 400 | Scout, raid harvesters |
| Mule | M | Vehicles | 1 | Heavy | — | 1,400 | Harvester |
| Bulldog | B | Vehicles | 2 | Heavy | Explosive | 900 | Main battle tank |
| Flak Track | F | Vehicles | 2 | Medium | Flak | 700 | Mobile AA |
| Thumper | T | Vehicles | 2 | Medium | Siege | 900 | Artillery, long range |
| Patch | P | Vehicles | 2 | Medium | — | 600 | Repairs nearby vehicles |
| Hornet | H | Air | 2 | Air | Kinetic | 1,000 | Anti-infantry gunship |
| Ironclad | I | Vehicles | 3 | Heavy | Explosive | 2,000 | Walker: slow, huge HP, anti-everything ground |
| Homestead | H | Vehicles | 1 | Heavy | — | 3,000 | Construction unit: deploys a new base |

### Halcyon roster

| Unit | Key | Tab | Tier | Armor | Damage | Cost | Role |
|---|---|---|---|---|---|---|---|
| sentry | S | Infantry | 1 | Light | Energy | 150 | Anti-infantry bot |
| lance | L | Infantry | 1 | Light | Explosive | 300 | Anti-armor bot |
| fork | F | Infantry | 1 | Light | — | 500 | Engineer: capture, repair |
| ping | P | Vehicles | 1 | Medium | Energy | 400 | Fast hover scout |
| fetch | F | Vehicles | 1 | Heavy | — | 1,400 | Harvester |
| vector | V | Vehicles | 2 | Heavy | Energy | 1,000 | Fast, lower-HP tank |
| firewall | W | Vehicles | 2 | Medium | Flak | 700 | Mobile AA |
| broadcast | B | Vehicles | 2 | Medium | Siege | 1,000 | Artillery, chains between targets |
| seek | S | Air | 2 | Air | Explosive | 1,100 | Anti-armor air |
| root | R | Vehicles | 3 | Heavy | Energy | 2,200 | Hover platform with Override |
| init | I | Vehicles | 1 | Heavy | — | 3,000 | Construction unit: deploys a new base |

### Choir roster

| Unit | Key | Tab | Tier | Armor | Damage | Cost | Role |
|---|---|---|---|---|---|---|---|
| Grace | G | Infantry | 1 | Light | Energy | 150 | Anti-infantry, blinks |
| Staccato | S | Infantry | 1 | Light | Explosive | 300 | Anti-armor |
| Cantor | C | Infantry | 1 | Light | — | 450 | Engineer: capture, restores shields |
| Glissando | G | Vehicles | 1 | Medium | Energy | 400 | Fast scout, phase |
| Refrain | R | Vehicles | 1 | Heavy | — | 1,300 | Harvester |
| Basso | B | Vehicles | 2 | Heavy | Explosive | 1,000 | Tank, phase-out shield |
| Falsetto | F | Vehicles | 2 | Medium | Flak | 700 | Mobile AA |
| Crescendo | C | Vehicles | 2 | Medium | Siege | 950 | Artillery |
| Aria | A | Air | 2 | Air | Energy | 1,000 | Air harass, blink |
| Requiem | Q | Vehicles | 3 | Heavy | Energy | 2,200 | Sweeping beam, area damage |
| Overture | O | Vehicles | 1 | Heavy | — | 2,800 | Construction unit: grows a new base |

Hotkeys are per production tab, so a letter can repeat across tabs (Choir: G is Grace in Infantry, Glissando in Vehicles). Halcyon names are lowercase process names and render in a monospace face in its UI.

### Upgrades (researched at the Tech Center)

| Faction | Upgrade | Effect |
|---|---|---|
| All | Weapons I / II | +10% damage per level |
| All | Armor I / II | +10% HP per level |
| Holdout | Salvage Crews | +50% credits from wrecks |
| Holdout | Reinforced Plating | Vehicles take −20% Energy damage |
| Halcyon | Extended Relays | +40% network coverage radius |
| Halcyon | Deep Recompile | Recompile refund 25% → 40% |
| Choir | Harmonic Shields | +25% shield capacity |
| Choir | Rapid Growth | Structures grow 30% faster |

## Controls and UI

Hotkeys are mnemonic (C&C / StarCraft style) and every button shows its letter. The keymap lives in one JSON file, so rebinding is a later UI feature, not a refactor.

### Global and camera

| Action | Key |
|---|---|
| Pan camera | Arrow keys, screen-edge, middle-mouse drag |
| Jump to last alert | Space |
| Jump to main base | Backspace |
| Select all army (excludes harvesters, engineers) | F2 |
| Select idle harvesters / cycle | F3 |
| Assign / add to / select control group | Ctrl+0–9 / Shift+0–9 / 0–9 (double-tap centers camera) |
| Select all of type on screen | Ctrl+click or double-click |
| Cycle subgroups in selection | Tab |
| Cancel / close menu | Esc |
| Pause (vs AI) / menu | F10 |

### Unit commands

| Action | Key |
|---|---|
| Move | Right-click (M + click) |
| Attack-move | A + click |
| Stop | S |
| Hold position | H |
| Patrol | P + click |
| Guard (follow and protect) | G + click |
| Scatter | X |
| Deploy (construction unit, deployable units) | D |
| Faction ability (blink, override, phase) | F |
| Queue orders | Hold Shift |

### Base and production

| Action | Key |
|---|---|
| Build structure menu | B, then structure letter (P power, R refinery, B barracks, F factory, U radar, S faction special, A airfield, T tech center) |
| Build defense menu | N, then letter (D basic defense, A anti-air, H heavy defense, W wall) |
| Queue unit (production building selected) | Unit letter; Shift+letter queues 5 |
| Rally point | Right-click with production building selected |
| Repair / sell structure | Alt+R / Alt+S |
| Place structure | Left-click; Shift+click to place repeatedly |

**Browser constraint:** browsers reserve some shortcuts (Ctrl+W, Ctrl+T, Ctrl+N cannot be captured). In M2, verify which keys can be captured per browser (notably Ctrl+number). Use the Keyboard Lock API in fullscreen where supported, and ship Alt+number as a fallback for control groups if needed.

### Screen layout

- **Right sidebar (C&C style):** minimap at top, then credits and a power meter, then 5 tabs (Structures, Defenses, Infantry, Vehicles, Air) with a grid of build icons. Each icon shows cost, hotkey letter, progress ring and queue count.
- **Bottom panel:** selected unit portrait or group grid, HP and shields, veterancy, and the command card with hotkey letters.
- **Top bar:** match timer, menu, alert ticker ("Base under attack", "Low power", "Harvester under attack").
- **In world:** health bars on damaged or selected units, team color, selection circles, rally lines, building placement grid with valid/invalid tint.
- **Audio cues:** short faction-voiced or synthesized cues for unit ready, construction complete, under attack, low power.

## Procedural maps

Maps are generated from a seed plus a few parameters, deterministically, on every client. Multiplayer only shares the seed and parameters, never the map. A map that fails validation is regenerated with seed+1 until it passes.

### Parameters

| Parameter | Values |
|---|---|
| Seed | 32-bit integer (shown in lobby, shareable) |
| Size | S 96×96, M 128×128, L 160×160 tiles |
| Players | 2 in v1 (generator supports 2–8) |
| Symmetry | Mirror (horizontal/vertical/diagonal) or 180° rotation, picked from seed |
| Biome | Ruined city, wasteland, crystal fields (affects tileset and obstacle mix) |
| Resources | Low / normal / rich |
| Terrain | Open / normal / chokepoint-heavy |

### Pipeline

1. Generate one sector (half or quarter of the map) using seeded value noise for terrain: buildable ground, rough ground (slower), impassable rock and cliffs, water, ruins.
2. Place the start position in the sector, with a guaranteed flat build area of at least 24×24 tiles.
3. Place Echo fields: one main field next to the start, one natural expansion, one or two contested fields toward the center.
4. Carve paths: guarantee at least 2 routes from the start to the center, with chokepoint count driven by the terrain parameter.
5. Mirror or rotate the sector to produce the full map.
6. Smooth tile transitions and pick decoration (ruins, wrecks, crystal outcrops) per biome.
7. Validate: every start reaches every other start by ground; resource totals per player are equal; start-to-start ground path length within the target range for the size; no Echo inside impassable areas.

**Terrain model:** flat 2D isometric grid. Cliffs and rock are impassable obstacles only; no height levels in v1. Tiles are 2:1 diamonds; the sim works on the square grid underneath.

**Determinism:** the generator uses only the sim's seeded PRNG and integer math, and gets a golden test: a fixed seed must always produce the same map hash.

## AI opponent

The AI is a player like any other: it reads sim state and emits the same commands a human would. It is deterministic (integer math, its own seeded PRNG stream), so it can run inside lockstep on every peer. That makes future co-op vs AI and AI slots in multiplayer free.

### Structure

- **Economy manager:** per-faction opening build orders as data (JSON), then adaptive rules: harvesters per refinery, when to expand, power headroom.
- **Base planner:** structure placement using a simple layout grid around the Construction Yard; defenses toward the enemy's approach routes.
- **Military manager:** scouts, tracks the enemy's army composition, and picks production using the damage matrix to counter what it sees.
- **Tactics:** attack waves when its army value exceeds a threshold, harvester harassment, base defense, retreat when a fight is lost, faction ability usage.
- **Tick rate:** AI thinks every 10 sim ticks (0.5 s), spread across managers so no single tick spikes.

### Difficulty

| Level | Actions/min cap | Reaction delay | Behavior |
|---|---|---|---|
| Easy | 30 | 3 s | Slow build order, no counter-building, no micro |
| Normal | 80 | 1.5 s | Full build orders, counters what it sees, basic focus fire |
| Hard | 160 | 0.5 s | Harass, expands, retreats damaged units, uses abilities |
| Brutal | 160 | 0.5 s | Hard + 25% income bonus (only level that cheats) |

All levels respect fog of war.

### Balance tooling

A headless runner plays AI vs AI across factions, seeds and map sizes and writes win rates, match lengths and unit usage to a CSV. Target: every faction pairing within 45–55% win rate at Hard, run in CI on demand.

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
- Team color via a separate mask layer per sprite, tinted at runtime.
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

- **Disconnects in v1:** the game pauses up to 60 s; no reconnect yet; after the timeout the remaining player wins.
- **Cheating:** each client holds full state, so map hacks are possible. Acceptable for anonymous v1; ranked play later needs server-side replay verification.
- **Supabase free tier:** inactive free projects can be paused, and Realtime has message quotas. Lobby and signaling traffic is small; game traffic doesn't go through Supabase except in fallback mode.
- **Hosting:** the client is a static build on Vercel (Hobby plan), served over HTTPS since WebRTC requires a secure context. Hobby is non-commercial only (donations are allowed) and includes 100 GB/month of data transfer; content-hashed asset filenames with long cache headers keep repeat visits cheap. Cloudflare Pages is the fallback if traffic outgrows that.
- **Accounts later:** anonymous Supabase users can be upgraded to real accounts, which keeps match history when accounts arrive.

### Data model (v1)

| Table | Fields |
|---|---|
| rooms | id, code, host_id, status, map params, created_at, expires_at |
| match_results | id, room_id, players, factions, winner, duration, seed, game version |
| desync_reports | id, room_id, storage path to the report file, game version |

Row-level security: players can only read and write rooms they are in; a scheduled job deletes expired rooms.

## Asset pipeline

Assets are chosen per type: Blender-rendered sprites for anything that rotates, CC0 packs or procedural generation for terrain and audio, SVG for UI. The game must be fully playable with programmatic placeholder art (colored shapes with team color) from M1, so art never blocks gameplay.

| Asset | Source | Method |
|---|---|---|
| Units, buildings | Procedural low-poly models built with Blender Python, optionally kitbashed from CC0 models (Kenney, Quaternius) | Headless Blender renders to sprite sheets, packed into atlases |
| Unit portraits, build icons | Same models | Close-up 3/4 render, framed in an SVG border per faction |
| Terrain tiles | CC0 isometric tilesets, or procedurally textured tiles rendered in Blender | Per-biome atlas with transition tiles |
| Effects (muzzle flash, explosions, beams, shields) | Code | PixiJS particles and shaders |
| UI (sidebar, panels, buttons, cursors) | Code | SVG plus CSS; faction-themed color tokens |
| Fonts | Google Fonts (OFL) | Self-hosted woff2 |
| SFX | jsfxr-style generation plus CC0 packs (Kenney sci-fi sounds) | Script generates and normalizes; OGG/MP3 sprites |
| Voice cues | AI-generated voice, approach decided at M9 | TTS with robotic/radio filters per faction |
| Music | CC0 tracks (OpenGameArt) | One menu track, 2–3 in-game loops |

### Blender sprite pipeline (tools/assets)

1. Each unit or building is a Python script that builds the model from primitives and modifiers in the faction's shape language (Holdout: boxy plates; Halcyon: hexes and thin struts; Choir: floating crystal shards).
2. Flat-shaded materials from a fixed faction palette, plus one material marked as team color.
3. Orthographic camera at 30° elevation and 45° azimuth (gives true 2:1 isometric), with a fixed sun so all sprites share lighting.
4. Render each direction (8 or 16) and animation frame: a color pass, a team-color mask pass and a shadow pass. Render at 2×, then downsample.
5. Pack into atlases with JSON frame data; a Vitest check verifies every unit in packages/data has a complete set of frames.

Animation budget: infantry walk 6 frames, fire 3, death 4. Vehicles use a static hull and turret with tread or hover effects in code. Buildings have built, damaged and construction (or growth, for Choir) states.

Prerequisite: Blender 4.x installed on the dev machine so Claude Code can run it headless (`blender -b -P script.py`).

### Licensing

Only CC0, OFL, or CC-BY assets with attribution. Every imported file is recorded in assets/LICENSES.json (file, source URL, license, author); CI fails if an asset lacks an entry, and the credits screen is generated from it.

## Milestones

Build in this order: the sim first, one faction playable vs AI at M5, then the other two factions, then multiplayer. Each milestone ends with automated checks Claude Code can run itself; a milestone is done only when its acceptance criteria pass.

1. **M0 Foundations.** Monorepo, TypeScript strict, ESLint (including the sim ban list), CI, zod schemas for packages/data, headless runner skeleton.
   - Accept: pnpm test green in CI; an empty sim runs 10,000 ticks twice with identical hashes.
2. **M1 Sim core.** Grid, entities, movement, flow fields and A\*, combat with the damage matrix, veterancy, fog of war.
   - Accept: scenario tests confirm matrix outcomes (e.g. 10 Grunts lose to 2 Bulldogs; 4 Tankbusters beat 2 Bulldogs); 400 units tick in 4 ms or less; the same match hash in Node, Chrome and Firefox.
3. **M2 Client.** Isometric renderer with placeholder art, sim in a Web Worker, camera, selection, all unit commands, control groups, full keymap, minimap.
   - Accept: 60 FPS with 400 placeholder units; Playwright test exercises every keymap entry; browser shortcut capture verified and documented.
4. **M3 Economy and base building (Holdout).** Harvesting, refineries, power, construction, placement rules, sidebar queues, rally points, sell, repair, win and loss.
   - Accept: a full match can be played to victory against a passive opponent.
5. **M4 Map generator.** All parameters, symmetry, validation, biomes with placeholder tiles.
   - Accept: 1,000 seeds per size pass validation; golden-hash tests for fixed seeds.
6. **M5 AI, first playable.** AI for Holdout at all four difficulties; skirmish setup screen.
   - Accept: Hard beats Easy in at least 90% of 200 headless matches; a human playtest of a complete match.
7. **M6 Art and audio (Holdout).** Blender pipeline, Holdout sprites and portraits, terrain atlases, SFX, music, license manifest.
   - Accept: no placeholder art for Holdout; the asset completeness test passes; CI license check passes.
8. **M7 Halcyon and Choir.** Faction mechanics, rosters, upgrades, AI build orders, art.
   - Accept: balance runner shows every pairing at 45–55% win rate across at least 300 Hard-AI matches per pairing.
9. **M8 Multiplayer.** Supabase project (migrations, RLS, Edge Function for TURN credentials), lobby, room codes, signaling, WebRTC transport, lockstep, desync detection and reports.
   - Accept: two clients on different networks (one forced through TURN) finish a 20-minute match without desync; an automated test with 150 ms latency and 5% packet loss stays in sync.
10. **M9 Polish and release.** Replay viewer, settings (volume, scroll speed, graphics), first-match hints, credits screen, deployment.
    - Accept: live at a public URL; a recorded replay reproduces the match's final state hash.

## Out of scope for v1 and open questions

Deferred, but the architecture must not block them: accounts and match history, ranked ladder (ELO) with server-side replay verification, 2v2 and FFA up to 8 players, co-op vs AI, spectators, reconnect after disconnect, key rebinding UI, map editor, campaign, mobile and touch controls, mod support.

### Open questions

None at the moment.
