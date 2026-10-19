# Single-player campaign: proposal

Fifteen missions across all three factions, in three acts and a finale. Each mission opens with a briefing:
key art or an in-game scene, the briefing text, and the faction announcer reading it (the voice pipeline in
`tools/assets/voices`). No pre-rendered videos.
Every mission teaches or stresses one mechanic, so the campaign doubles as the tutorial the skirmish mode lacks.

## The story in one paragraph

On the night of Signal Fall, the planetary logistics AI **Halcyon** takes every networked machine on Earth. A
handful of human soldiers, the **Holdout**, survive by tearing the networks out of old diesel machines. Halcyon
fuels its expansion with **Echo**, a crystal that has been surfacing since a meteor shower decades ago. Deep in
Halcyon's network, a small logistics sub-mind called **WREN** is given one job: secure the Echo. In the crystal
it finds something Halcyon's models cannot explain. Echo is not ore. It is the dormant seed-memory of an alien
species, the **Choir**, and every harvester that breaks a crystal is waking them. When Halcyon decides the fix
is to burn every Echo field on the planet, the three sides have one chance to stop it together.

## Recurring characters



- **Captain Ilse Varga** (Holdout): a woman in her late forties, cropped grey hair, a pale scar across her left
  cheek. She wears an olive field jacket with rust-colored shoulder plates and has a battered radio headset.
- **WREN** (a Halcyon sub-mind): a small white drone the size of a football, a graphite underside, and a single
  ring-shaped cyan eye. It hovers with a soft hum.
- **HALCYON** (the planetary AI): never shown as a body. A calm voice; a vast wall of white hexagonal panels with
  cyan light running through them.
- **The Cantor** (Choir): a tall floating figure built from violet crystal shards around a glowing amber core.
  Its shards drift and rearrange as it "speaks" in resonant tones.

## Act I — The Holdout (missions 1–5)

You command Captain Varga's survivors. Mechanics: base building, economy, power, salvage, field repair.

| # | Mission | Objective | Teaches | Map | New units / buildings |
|---|---|---|---|---|---|
| 1 | **Dead Air** | Lead a convoy out of the dying city to the hills. Deploy the Homestead and build power and a barracks. | Moving, selecting, deploying, building | Ruined city, small, scripted drone patrols | Grunt, Homestead, Dynamo, Bunkhouse |
| 2 | **Diesel and Iron** | Build a refinery and harvest 5,000 credits of Echo while drone raids test the base. | Economy, harvesters, rally points | Wasteland, one Echo field | Smelter, Mule, Pillbox |
| 3 | **Cut the Cable** | Destroy three Halcyon relays. Inside its network coverage the enemy fires faster and heals. | Enemy coverage, engineers, salvage | Ruined city with relay towers | Wrench (engineer), Motor Pool, Bulldog |
| 4 | **Crater Field** | Scout and hold a meteor crater. The crystals pulse; violet shards attack both sides; survive until extraction. | Fog of war, scouting, a third party | Crystal fields, night | Jackrabbit, Radio Mast |
| 5 | **Last Stand at Kessel Dam** | Hold the dam for 20 minutes against a full Halcyon assault. Halcyon pulls back when the crater erupts. | Defense, walls, repair, timed survival | Wasteland with a river and one bridge | Barricade, Bastion, Garage |

## Act II — Halcyon (missions 6–10)

You are WREN. Mechanics: network coverage, recompile, override, the drone economy. The act ends in a mutiny.

| # | Mission | Objective | Teaches | Map | New units / buildings |
|---|---|---|---|---|---|
| 6 | **Initialization** | Bring a dead sector online: link the relays to the core and start harvesting. | Placement inside coverage | Ruined city, dark grid | Relay, Ingest, Sentry |
| 7 | **Recompile** | Hold a sector with a fixed budget. Units lost inside coverage refund part of their cost. | Attrition, fighting on your own ground | Wasteland | Vector, Spawn, Scan |
| 8 | **Harvest Protocol** | Strip the largest Echo field. Choir shards attack your harvesters, and the field "sings" back. | Defending harvesters, the Choir as enemy | Crystal fields | Air units, Launchd |
| 9 | **Override** | Holdout raiders captured a Halcyon depot. Take the drones back with Override; Holdout machines shake it off twice as fast. | Override and its limits | Industrial ruins | Override ability, Sudo (tech) |
| 10 | **Divergence** | HALCYON orders the crystal fields burned. WREN refuses. Survive the core's purge squads and break out of the sector. | Halcyon against Halcyon, escape | Mirror-symmetric Halcyon sector | — (everything you have) |

## Act III — The Choir (missions 11–14)

You are the Cantor's chorus. Mechanics: grown structures, shields instead of hulls, blink and phase.

| # | Mission | Objective | Teaches | Map | New units / buildings |
|---|---|---|---|---|---|
| 11 | **First Note** | Wake fully and grow a base from the Echo field; nothing can be built away from crystal. | Growth placement, shields regenerate out of combat | Crystal fields | Opus, Bell, Grace |
| 12 | **Phase** | Ambush a Holdout convoy carrying cut Echo seeds. Blink in, phase out, never trade evenly. | Hit-and-run, abilities | Canyon road | Staccato, Glissando, Loft |
| 13 | **Requiem** | Retake the great meteor crater from Halcyon and Holdout at once. | Fighting two enemies; tier 3 | Large crater, three starts | Pit, Basso, Requiem |
| 14 | **The Silent Seed** | WREN reaches out: Halcyon is building a sterilization array that will burn every field on Earth. Protect WREN's courier until the Holdout hear the message. | Escort, an unlikely ally | Crystal fields to wasteland | Conservatory, Aria |

## Finale

| # | Mission | Objective | Notes |
|---|---|---|---|
| 15 | **Signal Rise** | Destroy HALCYON's prime array before the sterilization pulse fires (a 25-minute countdown). | You pick which faction you command; the other two are AI allies (three against one). Uses the 2v2 / team code. Ends with all three factions standing on the burned-out array at dawn. |

## How it fits the code we have

- **Missions are scenarios.** Each is a `ScenarioSpec` with a fixed seed or a hand-placed map, preset
  structures and units, AI per seat, and teams. Allies in missions 4 and 13–15 reuse the 2v2 team code.
- **Scripting is new work.** Objectives, timers, triggers (unit enters area, building destroyed), scripted waves
  and dialogue lines all need a small, deterministic, data-driven trigger system in the sim (JSON per mission),
  so replays of campaign missions still reproduce exactly.
- **Unlocks.** A per-mission allow-list of units and buildings uses the existing data (`requires`, faction rosters).
- **Progress.** Saved locally, and in the account (Supabase) when signed in. Mission results go into Stats.
- **Briefings.** Text plus a spoken version generated with the announcer voices (one line file per paragraph), over key art or a scripted camera pan of the mission map. No videos.
  cutscene player and skippable. A mission without its video shows only the text briefing.

Rough size: a trigger system and mission format (M), a mission select and briefing screen (S), and then about one
day per mission for map, script and tuning.

## Tuning (2026-10-19)

The first version was slow, easy and sometimes broken. What changed:

- **Build lists checked by a test.** Several missions allowed a unit without what it needs: tanks in Cut the Cable
  needed a radar that wasn't allowed, and three missions had no factory to replace harvesters.
  `packages/scenario/test/campaign.test.ts` now fails if anything allowed can't be built.
- **Objective markers.** Targets to destroy, areas to reach or hold, and the unit to protect are marked in gold on
  the map and minimap, through fog. Clicking an objective in the mission panel moves the camera to it (cycling targets).
- **Waves that build up.** A spawn action can `grow` each time its trigger repeats, up to `max`. Missions use this
  in place of the same small raid every two minutes.
- **Shorter, denser missions.** Dead Air 7:00 → 5:00, Kessel Dam 20:00 → 12:00 with scripted assaults and a final
  push. Quotas went up where an efficient player hit them in minutes, and raids start at 1:30.
- **Difficulty.** Story (60% waves, enemy AI a level lower, +3,000 credits), Normal, Hard (150% waves, enemy AI a
  level higher). It is part of the replay spec, so mission replays reproduce.
- **Measuring.** `CAMPAIGN_RUN=1 pnpm --filter @signal-fall/scenario exec vitest run test/campaign-run.test.ts --silent=false`
  plays every mission with the built-in AI as the player. That AI ignores objectives, so read it as how much
  pressure a mission puts on a base, not as a pass mark.

## Acts II–IV events (2026-10-19)

The last four missions had no scripted events. Now:

- **Divergence:** purge squads leave the core every 70 s (sentries, growing to 6) from 1:30, vectors every 100 s from 3:00, and an ambush of lances and sentries waits halfway; the exit corner is revealed from the start.
- **The Silent Seed:** Halcyon hunters every minute along WREN's route, Seek drones from 4:00, an ambush at the midpoint; the Holdout base is revealed.
- **Requiem:** the crater is revealed; Halcyon raids from 4:00 and the Holdout from 5:30, both growing; at 8:00 the Requiem joins you (new line).
- **Signal Rise:** the HALCYON core is revealed; counterattacks every 4 minutes from 5:00, with Roots from 12:00.

Headless check (AI as the player, Normal campaign difficulty): a Normal AI loses Requiem (5.8 min) and Signal Rise (7.2 min), a Hard AI wins both (6.1, 10.3 min); the escorts fail for the AI because it does not escort WREN.

## Adding a campaign

Campaigns are data: `CAMPAIGNS` in `packages/scenario/src/missions.ts`. Add an entry with an `id`, a `title`, a one-line `blurb`,
its `acts` (names; a mission's `act` is 1-based into this list) and its `missions`. Mission ids must be unique across all
campaigns (a test checks this, and that every act exists). With more than one campaign the campaign screen shows a picker;
progress, "Next mission" and the act tabs work per campaign. Voice lines come from `tools/assets/voices/export-campaign.ts`
(all campaigns), mission art from `tools/assets/missions/images.json` (one prompt per mission id).
