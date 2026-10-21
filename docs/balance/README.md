# Balance

The current numbers are published by CI: the `balance` job runs `pnpm -s headless balance-report` (300 Hard
matches per pairing, plus Hard vs Easy). It fails outside 45–55% or under 90%, and on `main` it pushes
`balance.json` to the `balance-data` branch, which the game's Codex reads live (Balance tab). The CSVs are in the
job's artifacts.

## Tuning log (M7)

Starting point with all faction mechanics in: Halcyon beat Holdout 66–71%, Choir beat Holdout 74% and Halcyon 90%.
Tools: `apps/headless/src/trace.ts` (per-minute economy/army trace), `trace2.ts` (army position every 15 s),
`lab.ts` (equal-cost field battles with AI ability use, explicit compositions via `LAB_A` / `LAB_B`).

- The AI built anti-air before ever seeing an aircraft; it now waits for enemy air (all factions).
- Holdout's Mule was much slower than the other harvesters (1.4 vs 1.6–1.8): 1.6.
- Choir structures cost ~15% less than the others; with money (not build time) the AI's bottleneck that was a pure
  advantage. Now ~10% less, still growing slower; the Coda (refinery) grows in 17 s instead of 20.
- Choir shields regenerate 8/s after 7 s out of combat (was 15/s after 5 s).
- Halcyon `vector` 50 damage / 720 HP (was 40 / 640), `lance` 110 HP, `sentry` 15 damage; Holdout Pillbox 19 damage.
- New rule `shieldDamagePct`: energy hits shields at 180%, kinetic at 70%. Halcyon's energy weapons disrupt Choir
  resonance and bullets glance off it; this tunes Halcyon–Choir and Holdout–Choir without touching Holdout–Halcyon.
- Reinforcements now fan out to free spots around the rally point; that favored Halcyon's network (Holdout
  fell to 42%), so network self-repair is 2 HP/s (was 3) and the in-network fire-rate bonus 12% (was 15%).

## Economy rework (2026-10-16)

Richer Echo fields, refineries priced above harvesters, AI strategies and expansions. All of these are the same rules for every side.

- The Mule carries 900 a trip (was 700). Holdout went from 22–40% to 47–61% against Halcyon.
- AI fixes that apply to every faction. The losing AI was found sitting on $9,000–24,000 of unspent credits:
  - It now builds extra barracks and factories when credits pile up.
  - Rush keeps its second refinery and builds its radar last, instead of never (Holdout won 0 of 22 games on rush).
  - It keeps at most two of each support unit. Holdout used to build about 14 Patches a match.
  - Counter-picks account for shields.
- Choir far seeds replace the 16-tile reach limit on Echo growth.
- Measured, not the cause: Choir harvests the same as Holdout through minute 9; its larger totals come from longer games it wins. Kinetic damage against shields at 85% and a Chord nerf made no difference, so both were reverted.
- Tools for finding the cause: a kill ledger (value destroyed by each unit type against each victim type, over
  full matches), per-strategy win counts (now in the CSV and on the balance page), and the lab with `LAB_AIR=1`.
- The lab didn't help here: Holdout wins equal-cost fights against both other factions, yet lost 70% of matches
  to Choir. The ledger showed Graces destroying Holdout Hornets (energy did 75% to aircraft, kinetic 50%), and
  Graces and Arias as the top killers overall.
- The fix, all measured at 300 matches per pairing:
  - Choir combat units cost 10% more and Graces deal 12 damage (was 14).
  - Energy does 50% to aircraft (was 75).
  - Kinetic does 85% to shields (was 70); only Holdout fires kinetic at Choir.
  - Lances deal 75 damage (was 65), which fixed Holdout vs Halcyon at 58%.
  - Energy does 140% to shields (was 180); only Halcyon fires energy at Choir.
  - The Mule carries 800.
- Tried and reverted:
  - Requiem nerf.
  - Slower shield recharge.
  - Halcyon fire-rate bonus 15%.
  - fetch 750: Halcyon's income barely changed.
  - Graces ground-only: Choir fell to about 40%.
- Result: Holdout vs Halcyon 51.7%, Holdout vs Choir 50.7%, Halcyon vs Choir 51%.

## Holdout abilities (2026-10-16)

- Dig In (Grunts and Tankbusters: 30% less damage, +1 range, cannot move) made no measurable difference to Hard
  AI win rates, because the AI only digs in while holding a position with enemies closing in.
- Automatic salvage is new income for Holdout, since the AI never sent Wrenches to wrecks before. At 40% Holdout won
  70%, and at 25% about 61%. Salvage is now 15% and the Mule is back to 700. Results at 300 matches: Holdout vs Halcyon
  51.3%, Holdout vs Choir 52.3%.
- Normal reverted to 2 harvesters per refinery, and extra production buildings are Hard-only: a player was losing to
  Normal. Hard beats Normal 80–86%. Normal vs Normal is lopsided for Choir (24% vs Holdout) because Normal uses no
  abilities. That is now on the balance page; the planned fix is to autocast Choir's escape abilities for everyone.

## Halcyon and Choir abilities (2026-10-16)

Each change was measured by running with one feature removed (150 matches per pairing).

- **Halcyon coverage bonus** at 20% fire rate and 4 HP/s, with Uplink on vectors: Halcyon won 73–85%. Back to 12% and 2 HP/s.
- **Uplink** alone was worth about 13 points against Holdout and 20 against Choir, because uplinked units also get
  Recompile. It is now on the fork only, so the AI (which builds no forks) doesn't use it. It stays a deliberate
  player tool.
- **Jam** settled at 20% slower fire for 5 s, radius 3, 90 s cooldown. Its effect sits inside the noise (Halcyon vs
  Choir 54–56%).
- **Choir autocast escapes** (phase or blink when below 35% life under fire) were neutral for the Hard AI, which
  already escaped. The point is fairness: players get the same escapes without micro.
- **Awaken** at 3 shards for 30 s, castable anywhere, was worth about 15 points because the AI used it on enemy
  harvesters. It is now 2 weaker shards for 20 s, a 150 s cooldown, and only on fields within 14 tiles of the caster's
  structures.
- **Chorus** at 5% per ally up to +20% was worth about 8–10 points, and even 3% up to +9% was too much. It is now 2% up
  to +6%.
- **Energy vs shields** went back up to 160%, which only affects Halcyon vs Choir.

### 2026-10-18: city streets

City maps now cut one-tile streets through big ruins clusters (mapgen, a lane every 5 tiles). Checked
Halcyon vs Choir at 300 Hard matches with and without streets: 52.7% vs 53.0%, no measurable effect. Holdout
vs Choir and Holdout vs Halcyon at 100 matches: 45% and 53%.

### 2026-10-18: capture points (optional map setting)

Derricks, watchtowers and repair depots ("Capture points" in the map options, off by default, so CI's default
runs are unchanged). Checked with `--points some`, Hard vs Hard:

- First version (derrick 10 credits/s, three AI units sent from minute 2 to the nearest untaken point, parked there):
  Holdout vs Choir 36–41% over 100–300 matches, Halcyon vs Choir 62%. Ownership was even (each side took the first
  point in 15 of 30 matches), and with the points on the map but the AI ignoring them the pairing was back to 46%:
  the cost was the AI marching squads into the middle, where Choir's self-escaping units trade better.
- Smaller effects (derrick 4/s, depots don't mend Choir crystal) did not change that on their own.
- Fix: the AI takes only points on its own half of the map, sends its three fastest spare units from minute 4 and
  releases them once the point is held. Now 44.5% / 55.5% / 49% (Holdout–Choir, Holdout–Halcyon, Halcyon–Choir,
  200 matches each), in line with the default maps.

### 2026-10-19: crates (optional setting)

Crates drop every 45 s (at most three on the map): 500 credits, a full repair around the finder, or a promotion.
The AI picks up crates it can see within 15 tiles of a spare unit. Hard vs Hard with `--crates`, 100 matches:
Holdout–Choir 47%, Holdout–Halcyon 50%, Halcyon–Choir 54%.

### 2026-10-19: king of the hill (optional victory)

A flag at the map center; holding it for 5 minutes in total wins (destroying everything still wins too). The AI
sends a squad to the hill from minute 4 and keeps it there, and its waves attack the hill whenever the enemy holds it.

- 3-minute hold, waves aimed at the enemy base: Halcyon won 60–66% (fast units take the hill first and keep it).
- 5-minute hold: Halcyon still 58–59%, Holdout 42%.
- Waves aimed at the hill while it isn't ours: Holdout–Choir 47%, Holdout–Halcyon 56% (100 matches),
  Halcyon–Choir 58% (300 matches). Halcyon keeps an edge of a few points over the standard maps in this mode;
  it is optional and not part of the CI gate.

### 2026-10-19: doctrines

Each faction's two tier-3 upgrades became an either/or choice (Salvage Crews or Reinforced Plating, Extended
Relays or Deep Recompile, Harmonic Shields or Rapid Growth). The AI takes the pricier one on tech and turtle plans
and the cheaper one otherwise. Hard vs Hard, 200 matches: Holdout–Choir 45.5%, Holdout–Halcyon 51.5%,
Halcyon–Choir 52%.

### 2026-10-19: brush and roads

Rough ground is now brush: units in it are seen only by enemies within a few tiles, unless they shoot. Roads speed
up ground units. Hard vs Hard (CI's baseline before: Holdout–Halcyon 54.7%, Holdout–Choir 45%, Halcyon–Choir 53.3%):

- Roads at +30% for vehicles only: Halcyon–Choir 59.5% (fast hover vehicles). Roads +20% for every ground unit: 51%.
- Brush within 3 tiles: Holdout–Halcyon 57.3% over 300 (dug-in, stationary Holdout infantry). Within 5: 56.7%.
- Shooting from the brush reveals the shooter, and brush within 6 tiles: Holdout–Halcyon 54% (300),
  Holdout–Choir 49.5%, Halcyon–Choir 50.5% (200 each).

### 2026-10-19: superweapons

A tier-3 superweapon per faction (Long Tom / Barrage, rm -rf / Purge, Cadenza / Shatter): 5-minute charge, public
timer, a warning before the strike. Hard vs Hard, 100 matches each:

- Hard AIs built it as soon as tier 3 allowed (minute 5–6, 2500 credits out of the army): Holdout–Choir 41%.
- The AI builds it only after 14 minutes, or with 5000 credits banked: Holdout–Choir 48%, Holdout–Halcyon 46%,
  Halcyon–Choir 51%. Easy and Normal never build it (they don't use powers either).

## Movement and spacing (2026-10-20)

Fixes for groups dancing and piling up (rally spots sized to the unit, a group's units leave the shared flow field for good
once at its bottom, displaced formation slots each get their own tile, a small dead zone in separation, parked vehicles keep
3/8 tile more room). 300 Hard-vs-Hard matches per pairing, against the code before the change:

| Pairing | Before | First try | Shipped |
|---|---|---|---|
| Holdout vs Halcyon | 54% (46% at 100) | 58% (100) | 55% |
| Halcyon vs Choir | 51% (100) | 56.7% | 53% |
| Holdout vs Choir | 48.7% | 42.3% | 47.3% |

The first try also gave vehicles hull-length formation slots and kept the vehicle gap while moving: Choir moved by about six
points both ways (vehicle-heavy armies fought more spread out). Dropping the wider slots (variant A) put every pairing back in
the gate (Holdout vs Halcyon sits at its edge, as it did before: 54% → 55%, within noise); dropping the rally spacing instead (variant B) left Holdout vs Choir at 45.3%. Hard beats Easy 50-0.

### Parked vehicles spaced by hull length (2026-10-20)

Vehicles still overlapped nose to tail in a parked group (drawn ~2.2 tiles long on a 1.2-tile body). Formation rows now sit a
hull length apart front to back (side by side stays a diameter), and two parked vehicles with nothing to shoot keep 7/8 tile
extra room. Hull-length spacing on both axes for plain moves (variant D) put Holdout vs Halcyon at 55.7%; front-to-back only
(shipped) at 300 Hard matches per pairing:

| Pairing | Before | Shipped |
|---|---|---|
| Holdout vs Halcyon | 54% | 54.3% |
| Halcyon vs Choir | 51% (100) | 52.3% |
| Holdout vs Choir | 48.7% | 46.7% |

Hard beats Easy 50-0.

### AI steps out of superweapon strikes (2026-10-20)

Hard and Brutal move units out of an announced strike circle (the warning is public). 300 Hard matches per pairing:
Holdout vs Halcyon 54.3%, Halcyon vs Choir 52.3%, Holdout vs Choir 46.7% (unchanged: strikes are rare in AI matches);
Hard beats Easy 50-0.

### Sell crews, brush ambush, harvester repairs, recompiled veterans (2026-10-21)

Four mechanics for everyone: selling a building leaves one of the faction's cheapest soldiers per ◆750 of its cost
(at most 4); the first shot from the brush after 5 s without firing does +50% damage; harvesters below 30% health
drive to a working repair bay (Holdout's Garage) until 90%; a Halcyon veteran lost to Recompile makes the next unit
of its type start a rank up. 300 Hard matches per pairing: Holdout vs Halcyon 53.7%, Halcyon vs Choir 52.7%,
Holdout vs Choir 47%; Hard beats Easy 50-0.

### AI: ruins garrisons and doctrines that fit the plan (2026-10-22)

Normal and up keep up to four infantry in the ruins in front of the base (city maps); doctrines now follow the plan
(fighting doctrines for rush, raider and balanced; economy and defense for tech and turtle), which flips Halcyon's and
Choir's picks for most plans. 300 Hard matches per pairing: Holdout vs Halcyon 53.7%, Halcyon vs Choir 54.3%,
Holdout vs Choir 46%; Hard beats Easy 50-0.
