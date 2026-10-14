# Single-player campaign: proposal

Fifteen missions across all three factions, in three acts and a finale. Each mission opens with a 15-second
video (prompts in [VIDEO_PROMPTS.md](VIDEO_PROMPTS.md#campaign-videos)), then a short text briefing over the map.
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

Each video prompt repeats these descriptions word for word, so they look the same across clips.

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
| 9 | **Override** | Holdout raiders captured a Halcyon depot. Take the drones back with Override; Holdout machines are immune. | Override and its limits | Industrial ruins | Override ability, Sudo (tech) |
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
- **Videos.** `apps/client/public/assets/video/campaign-01.mp4` … `campaign-15.mp4`, played with the existing
  cutscene player and skippable. A mission without its video shows only the text briefing.

Rough size: a trigger system and mission format (M), a mission select and briefing screen (S), and then about one
day per mission for map, script and tuning.
