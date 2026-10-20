# Making Signal Fall a better game: 120 improvements

Ranked by **impact** (how much better the game gets, 1–5) against **cost** (XS < 2 h, S < 1 day, M 1–3 days,
L ~a week, XL more). Within each tier, best value first. ✅ marks what is done.

Areas: **C** controls · **U** UX and quality of life · **E** economy and gameplay depth · **A** AI ·
**V** voice and audio · **G** graphics and feedback · **O** onboarding and menus · **M** multiplayer ·
**T** tech and performance · **K** content.

## Tier 1: high impact, cheap (do first)

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 1 ✅ | C | Sticky production tabs: press I once, then G G G queues three units (Esc or another tab leaves) | 5 | XS |
| 2 ✅ | C | Place-first building: pick a structure, click a spot; it builds there and places itself when done | 5 | S |
| 3 ✅ | V | Announcer voice for key events ("Construction complete", "Unit ready", "Base under attack", "Low power", "Insufficient funds") | 5 | S |
| 4 ✅ | V | A different announcer per faction: Holdout radio operator, Halcyon calm synthetic, Choir harmonic whisper | 4 | S |
| 5 ✅ | E | Bigger, regrowing Echo fields; more fields across the map, so matches have a mid-game | 5 | S |
| 6 ✅ | E | Expansion fields worth taking: richer fields away from the base, a second refinery near them pays off | 5 | S |
| 7 ✅ | U | Queue counts on build icons, and a progress clock on the icon itself (not only in the queue) | 4 | XS |
| 8 ✅ | C | Shift+click / Shift+key queues 5, Ctrl queues until cancelled ("infinite" repeat production) | 4 | S |
| 9 ✅ | C | Right-click a production icon to remove one; Shift+right-click clears that unit's queue | 4 | XS |
| 10 ✅ | U | "Unit ready" / "Construction complete" are spoken, not just text; text notices stack and fade | 4 | XS |
| 11 ✅ | C | Rally points per factory by right-clicking the ground with the factory selected (also on units/Echo: harvesters go harvest) | 4 | XS |
| 12 ✅ | U | Idle harvester and idle army counters in the top bar, click to jump | 4 | XS |
| 13 ✅ | E | Harvesters auto-return to work and auto-pick the next field when one runs dry (with a notice) | 4 | S |
| 14 ✅ | U | Clear low-power state: buildings dim, a power bar that turns red, the announcer says it | 4 | XS |
| 15 ✅ | C | Double-click a building to select all of that type on screen (factories, for shared rally) | 3 | XS |
| 16 ✅ | U | Hover a unit or building: health, owner, veterancy, what it is good against (already partly) | 3 | XS |
| 17 ✅ | C | Space jumps to the last alert; repeated Space cycles older alerts | 3 | XS |
| 18 ✅ | C | Ctrl+click a unit adds/removes it from selection; Shift+drag adds to selection | 3 | XS |
| 19 ✅ | U | Selection panel: portraits grouped by type with counts; click a group to narrow the selection | 4 | S |
| 20 ✅ | G | Health bars only when hurt or selected (cleaner screen), toggle to always show (Alt) | 3 | XS |
| 21 ✅ | U | Under-attack pings on the minimap (red pulse) | 4 | XS |
| 22 ✅ | V | Unit acknowledgements ("Moving out", "On it") per faction, short and rate-limited | 4 | S |
| 23 ✅ | C | Attack-move as the default right-click option when holding A is clumsy: A then left-click, plus Ctrl+right-click = attack-move | 3 | XS |
| 24 ✅ | U | Credits counter ticks smoothly; income per minute shown on hover | 3 | XS |
| 25 ✅ | O | First-match hints rewritten around the new flow (place-first, sticky tabs) | 3 | XS |

## Tier 2: high impact, moderate cost

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 26 ✅ | A | AI defends early pushes (pulls the army home, builds a defense when scouted aggression) | 5 | M |
| 27 ✅ | A | AI expands to new Echo fields, rebuilds lost harvesters and refineries promptly | 5 | M |
| 28 ✅ | A | AI varies its strategy per match: rush, tech, turtle, harass, air (seeded, so replays reproduce) | 5 | M |
| 29 ✅ | A | AI timing attacks with reinforcement streams instead of one all-in wave; retreats and regroups | 4 | M |
| 30 ✅ | A | AI counters what it scouts (it already weights by armor; make it react within a minute) | 4 | S |
| 31 ✅ | E | Tech choices that matter: each faction gets 2 mutually exclusive tier-2 upgrades (a real decision) | 4 | M |
| 32 ✅ | E | Map control: capturable Echo relays / derricks that give income or vision | 4 | M |
| 33 ✅ | E | Unit roles sharpened: every unit has one clear job and one clear counter, shown in the Codex and on hover | 4 | M |
| 34 ✅ | E | Faster mid-game: unit caps, build times and costs tuned so the first real fight is around minute 5–7 (measured: the first real fight is at minute 3.5–5 in Hard matches already) | 4 | S |
| 35 ✅ | G | Better terrain: blended texture transitions, cliffs with edges, decals (craters, tracks) that persist | 5 | M |
| 36 ✅ | G | Lighting pass: soft shadows, glow on Echo and energy weapons, night-time maps with light radius | 4 | M |
| 37 ✅ | G | Combat effects: muzzle flashes, tracers, impact sparks, smoke trails, screen shake on big explosions (Reduced setting honored) | 4 | M |
| 38 ✅ | G | Building construction animation (scaffold rising / crystal growing) and destruction collapse | 4 | M |
| 39 ✅ | G | Unit death: wrecks that stay a while (Holdout salvage), dissolve for Halcyon, shatter for Choir | 3 | S |
| 40 ✅ | V | Music that follows the battle (already layered) with a faction theme per side | 3 | M |
| 41 ✅ | V | Positional sound for combat and a mix that ducks music under announcer lines | 3 | S |
| 42 ✅ | U | Tooltips with full stats for every button, delay 400 ms, Shift shows numbers | 3 | S |
| 43 ✅ | U | Production tab badges: how many items queued per tab, flashing when a factory sits idle | 4 | S |
| 44 ✅ | C | Control-group bar: shows each group's main unit and count; double-tap centers | 3 | S |
| 45 ✅ | C | Camera bookmarks (F1–F4 save with Ctrl, jump with F-key) | 3 | XS |
| 46 ✅ | C | Formation move with right-drag (draw a line, units spread along it) | 3 | M |
| 47 ✅ | U | Minimap: unit dots by size, structures as squares, click-drag to move the camera, right-click to order | 4 | S |
| 48 ✅ | U | Fog-of-war shows last-seen buildings as ghosts | 4 | S |
| 49 ✅ | U | Pause menu shows objectives, faction tips and the keymap at a glance | 3 | XS |
| 50 ✅ | O | Interactive tutorial (5 short steps) for players new to RTS | 4 | M |
| 51 ✅ | O | Skirmish presets ("Quick match", "Long game", "Rush") and a "same as last time" button | 3 | XS |
| 52 ✅ | M | Rematch button for multiplayer; post-game lobby keeps the room | 4 | S |
| 53 ✅ | M | In-game chat and pings (Alt+click to ping a spot for teammates in 2v2) | 4 | M |
| 54 ✅ | M | Replace a disconnected player with the AI (2v2) | 4 | M |
| 55 ✅ | U | Score screen MVP stats per player (units killed, Echo harvested, APM) | 3 | XS |

## Tier 3: solid improvements

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 56 ✅ | C | Customizable keymap in settings (rebind; a grid preset for production letters is not done: those letters come from each unit's data) | 3 | M |
| 57 ✅ | C | Edge-scroll speed and camera zoom limits in settings; zoom to cursor | 3 | XS |
| 58 ✅ | C | Select all of a type across the screen with Ctrl+double-click | 2 | XS |
| 59 ✅ | C | Waypoint queue shown as lines when Shift is held | 3 | S |
| 60 ✅ | C | Stop / hold / scatter on the command card with hover hints | 2 | XS |
| 61 ✅ | C | Smart cast: abilities on a group cast with the nearest available unit | 3 | S |
| 62 ✅ | U | Build grid overlay while placing (green / red tiles, power coverage, growth range) | 4 | S |
| 63 ✅ | U | Show attack range circles while hovering a defense button or selected unit (Alt) | 3 | S |
| 64 ✅ | U | Notification log (last 20 events, click to jump) | 3 | S |
| 65 ✅ | U | Game speed for skirmish (0.5×–2×) | 3 | XS |
| 66 ✅ | U | Unit veterancy chevrons more visible; veteran units named in the selection panel | 2 | XS |
| 67 ✅ | U | Upgrade research shown on unit cards (what it improves) | 2 | XS |
| 68 ✅ | U | Sell and repair with clear cursors and refund amounts on hover | 3 | XS |
| 69 ✅ | U | Warnings when a factory is blocked (rally point unreachable, exit blocked) | 3 | S |
| 70 ✅ | E | Superweapon-lite per faction at tier 3 (long cooldown, visible charge timer for all) | 4 | L |
| 71 ✅ | E | Neutral buildings on maps: garrisonable ruins, repair depots, watchtowers (depots and watchtowers as capture points; infantry garrison city ruins) | 3 | M |
| 72 ✅ | E | Terrain effects: high ground range bonus, forests block vision, roads speed vehicles (brush hides units, roads speed ground units; the sim has no elevation, so no high ground) | 4 | L |
| 73 ✅ | E | Harvester economy depth: refinery queue logic, harvester escorts matter, raids are punishing but recoverable (harvesters queue to unload, flee raids and return, comeback from a refinery) | 3 | S |
| 74 ✅ | E | Crates (rare pickups) on skirmish maps, optional | 2 | S |
| 75 ✅ | A | AI difficulty describes itself in the menu (what it does, how fast) | 2 | XS |
| 76 ✅ | A | AI personalities with names in skirmish (Aggressive Ada, Turtle Tomas) | 3 | S |
| 77 ✅ | A | AI uses abilities well (blink in, override, phase) at Hard+ | 3 | M |
| 78 ✅ | A | AI scouts and harasses harvesters on Normal+ | 3 | S |
| 79 ✅ | G | Unit idle animations and turret tracking even when not firing | 3 | M |
| 80 ✅ | G | Selected-unit circles colored by health; hover outline on enemies | 2 | XS |
| 81 ✅ | G | Water and shoreline animation; crystal shimmer on Echo | 3 | M |
| 82 ✅ | G | Weather per biome (dust, rain, crystal motes), Reduced setting off | 2 | S |
| 83 ✅ | G | Faction-specific UI frames polished (icons, fonts, sounds per faction) | 3 | M |
| 84 ✅ | G | Higher-resolution sprites (2× atlases for retina screens) | 3 | L |
| 85 ✅ | G | Smoother zoom levels with sprite mip-mapping, no shimmering | 3 | S |
| 86 ✅ | G | Damaged-building fire and smoke effects scaling with damage | 3 | S |
| 87 ✅ | V | Weapon sounds per unit type, distinct enough to hear what is fighting | 3 | M |
| 88 ✅ | V | Building ambient loops (power hum, factory clanks) quietly near the camera | 2 | S |
| 89 ✅ | V | Victory/defeat stingers and a short voice line | 2 | XS |
| 90 ✅ | O | Main menu: continue last skirmish setup, recent replays list | 2 | S |
| 91 ✅ | O | Loading screen tips and faction art while the map generates | 2 | XS |
| 92 ✅ | O | Accessibility: colorblind team palettes, UI scale, subtitles for announcer | 3 | S |
| 93 ✅ | O | Codex search and "how to beat X" pages | 2 | S |
| 94 ✅ | M | Spectator mode for multiplayer rooms (watch friends' matches) | 3 | M |
| 95 ✅ | M | Ranked queue (matchmaking by rating) | 3 | L |
| 96 ✅ | M | Room browser for public games | 3 | M |
| 97 ✅ | T | Performance: render culling, batch effects; 60 fps with 400 units on mid laptops | 4 | M |
| 98 ✅ | T | Save and load skirmish (from the command log, like replays) | 4 | S |
| 99 ✅ | T | Reconnect to a multiplayer match after a refresh | 3 | M |
| 100 ✅ | T | Error reporting (anonymous) so crashes reach us | 3 | S |

## Tier 4: big bets

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 101 ✅ | K | Campaign: 15 missions with briefings and videos ([CAMPAIGN.md](CAMPAIGN.md)) (spoken briefings, no videos) | 5 | XL |
| 102 ✅ | K | Map editor in the browser, share maps by code | 4 | L |
| 103 ✅ | K | Hand-made competitive maps alongside generated ones | 4 | M |
| 104 ✅ | K | Survival / co-op mode: hold out against waves with a friend | 4 | L |
| 106 ✅ | K | Daily challenge: same seed and setup for everyone, leaderboard by time | 3 | M |
| 107 ✅ | K | Free-for-all 3–4 players | 3 | M |
| 108 ✅ | K | King-of-the-hill and capture modes | 3 | M |
| 110 ✅ | K | Mobile/tablet controls (touch UI) | 3 | L |

## Also worth doing (small)

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 111 ✅ | U | Remember camera position per match in replays | 1 | XS |
| 112 ✅ | U | Confirm before surrender; "rematch" after skirmish | 2 | XS |
| 113 ✅ | C | Mouse wheel zoom invert option | 1 | XS |
| 114 ✅ | U | Clock shows game time and real time | 1 | XS |
| 115 ✅ | G | Cursor set per faction | 2 | S |
| 116 ✅ | V | Mute announcer separately from sound effects and music | 2 | XS |
| 117 ✅ | U | Unit counts per type in the top bar (army composition at a glance) | 2 | XS |
| 118 ✅ | C | Tab cycles subgroups in a mixed selection (already) with a visible highlight | 2 | XS |
| 119 ✅ | U | Visible cooldowns on ability buttons | 2 | XS |
| 120 ✅ | O | Credits screen with the team and the tools used (already) linked from the landing page | 1 | XS |

## Order of work

1. **Controls first:** 1, 2, 8, 9, 11, 15, 17, 18, 23. They change how every match feels and are cheap.
2. **Voice:** 3, 4, 10, 22, 89, 116. The announcer turns reading into listening.
3. **Economy:** 5, 6, 13, 34, 73, then AI 26–30, so matches stop being "fixed build, all in".
4. **Clarity:** 7, 12, 14, 19, 20, 21, 43, 47, 48, 62.
5. **Graphics:** 35–39, 80, 86, then the rest.

## Next 100 (small)

Proposed 2026-10-19 after the first 120 shipped: small and medium steps on gameplay, controls, interface and feel. Same columns as above.

### Gameplay

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 121 | E | Power down a building by hand (click toggle) to free power for what matters, like classic C&C | 4 | S |
| 122 | E | Primary factory: pick which barracks or factory new units come out of | 3 | S |
| 123 | E | Selling a building leaves a few infantry, so a dying base can still fight | 3 | S |
| 124 ✅ | E | Cancelling a building in its first 5 seconds refunds everything (misclick forgiveness; cancelling already refunds everything spent, at any time) | 3 | XS |
| 125 | E | Gates in wall lines: your units pass, enemies don't | 3 | S |
| 126 | E | Ambush bonus: the first shot from a unit hidden in brush hits harder | 3 | S |
| 127 | E | Holdout harvesters below 30% health drive to a Garage on their own | 3 | S |
| 128 | E | Recompiled Halcyon units keep one veterancy rank | 2 | S |
| 129 | E | More crate types: a short map reveal, a speed boost, a free harvester | 2 | XS |
| 130 | E | Attack-ground order for artillery: shell a spot, not a unit | 4 | S |
| 131 | E | Allied credit transfer in team games | 3 | S |

### Match options

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 132 ✅ | E | Starting credits option (5k / 10k / 20k) | 4 | XS |
| 133 ✅ | E | Superweapons on or off in the map options | 4 | XS |
| 134 ✅ | E | Tech limit option (no tier 3) for quick, unit-only matches | 3 | XS |
| 135 ✅ | E | Unit cap option (low / normal / high) | 3 | XS |
| 136 ✅ | E | Start with a small army instead of only the construction vehicle | 3 | XS |
| 137 | E | Revealed map (no fog) option for practice and casting | 2 | XS |
| 138 | E | Handicap per seat (100 / 75 / 50%) so mixed-skill friends can play | 3 | S |

### AI

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 139 | A | AI steps out of a superweapon's warning circle (the warning is public, so this stays fair) | 4 | S |
| 140 | A | AI garrisons city ruins at chokes | 3 | S |
| 141 | A | AI contests capture points and the King-of-the-hill flag | 4 | S |
| 142 | A | AI picks up crates near its units | 2 | XS |
| 143 | A | AI chooses its doctrine to fit its strategy (rush, turtle, tech) | 3 | S |
| 144 | A | AI ally answers pings: it attacks or defends where you pinged | 4 | S |
| 145 | A | Optional AI chat lines in skirmish (taunts, "gg"), off by default | 2 | XS |

### Controls

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 146 ✅ | C | Hotkey cycles your production buildings (selects and centers each) | 3 | XS |
| 147 ✅ | C | Hotkey cycles idle army units one at a time | 3 | XS |
| 148 ✅ | C | Hotkey selects all damaged units, ready to send to repair | 3 | XS |
| 149 | C | Hotkey jumps between your construction yards | 2 | XS |
| 150 | C | Remove the selection from a control group (Ctrl+Shift+number) | 2 | XS |
| 151 ✅ | C | Right-click a portrait removes it from the selection; Shift+right-click removes that type | 3 | XS |
| 152 ✅ | C | Shift-place: keep placing the same structure (turrets, walls) without picking it again | 4 | XS |
| 153 | C | Drag to lay a whole wall line in one go | 4 | S |
| 154 | C | Follow camera: lock onto the selected unit | 2 | XS |
| 155 | C | Quick-cast setting: abilities fire at the cursor on key press, no click | 3 | S |
| 156 ✅ | C | Superweapon hotkey (fire at the cursor) | 3 | XS |
| 157 | C | Garrison hotkey: send selected infantry into the nearest ruin | 2 | XS |

### UI

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 158 | U | Power bar tooltip lists the biggest users and what goes offline at low power | 3 | XS |
| 159 ✅ | U | Every disabled build button says why in one line (needs radar, one per player) | 4 | XS |
| 160 ✅ | U | A finished structure waiting to be placed pulses its tab after 10 seconds | 3 | XS |
| 161 ✅ | U | Research progress shows in the top bar when the tech center isn't selected | 3 | XS |
| 162 ✅ | U | Enemy superweapon timer flashes and the announcer warns at 30 seconds left | 4 | XS |
| 163 ✅ | U | Army size against the unit cap in the top bar | 3 | XS |
| 164 ✅ | U | Harvester load bar (how full it is) under the health bar (already drawn with the health bar) | 3 | XS |
| 165 | U | Echo left in a field on hover; the minimap shades fields as they run dry | 4 | S |
| 166 ✅ | U | Minimap marks capture points, crates and the hill flag with clear icons | 3 | XS |
| 167 | U | Minimap filters: hide terrain, show only units, show Echo | 2 | S |
| 168 ✅ | U | Cost turns red on a build button when you can't afford it now | 3 | XS |
| 169 | U | Exact seconds left on hover over a queued item | 2 | XS |
| 170 ✅ | U | Rally point line shown while a factory is selected (already drawn) | 3 | XS |
| 171 | U | Hover a selected unit to see a line to what it is shooting | 2 | XS |
| 172 | U | Ability cooldowns on portraits in the selection panel | 2 | XS |
| 173 | U | One strip of every active queue across all factories at the bottom | 3 | S |
| 174 | U | Small kill feed for big losses (structures, tier-3 units) | 3 | S |
| 175 | U | Optional floating damage numbers, off by default | 2 | S |
| 176 | U | Notice when a unit is stuck, with a jump-to button | 2 | S |
| 177 | U | Show the enemy's doctrine once you have seen their tech center | 2 | XS |

### UX and onboarding

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 178 ✅ | O | Hint when credits sit above 3000 for a minute ("spend it: build another factory") | 4 | XS |
| 179 ✅ | O | Hint when a refinery has fewer than two harvesters | 3 | XS |
| 180 | O | Match report adds idle factory time and floated credits | 4 | S |
| 181 | O | Post-match tips: three things to do better, based on the report | 4 | S |
| 182 | O | "More in the Codex" link on hover cards opens the right entry | 3 | S |
| 183 ✅ | O | Short tooltips on every map option in setup (Resources, Terrain, Victory) | 3 | XS |
| 184 | O | Skirmish setup remembers settings per mode (1v1, FFA, Survival) | 2 | XS |
| 185 | O | Sandbox from the main menu: free credits, no enemy army, test any unit | 3 | S |
| 186 ✅ | O | Campaign difficulty choice (Story, Normal, Hard) | 4 | S |
| 187 | O | Restart a campaign mission from a mid-mission save | 3 | S |
| 188 | O | Replay timeline marks big fights and lost buildings; click to jump | 4 | S |
| 189 | O | "Play this map" from a replay (same seed and factions) | 2 | XS |
| 190 | O | Full keyboard navigation of every menu | 2 | S |
| 191 | O | Confirm before the host leaves a multiplayer lobby | 2 | XS |
| 192 ✅ | O | Faction picker shows a three-line play style and how hard it is to learn | 3 | XS |

### Graphics

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 193 | G | Superweapon building glows more as it charges | 3 | XS |
| 194 | G | Faction-specific strike visuals: shell rain, a burning purge, a crystal shatter | 4 | S |
| 195 | G | Garrisoned ruins show muzzle flashes in the windows | 3 | S |
| 196 ✅ | G | Capture point ring fills in the capturing team's color  (already drawn) | 3 | XS |
| 197 | G | "+700" credit pop when a harvester unloads | 2 | XS |
| 198 | G | Minimap flash at a superweapon target the moment the warning starts | 3 | XS |
| 199 | G | Coverage and growth range shown around a selected Halcyon or Choir building | 3 | XS |

### Sound

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 200 | V | Better voices: replace the Piper announcer and campaign briefings with a more natural, acted TTS model (emotion, pacing, per-faction character), keep the radio / synthetic / chord treatments, and re-record every line | 5 | M |
| 201 ✅ | V | Siren for "superweapon launch detected", distinct from every other alert | 4 | XS |
| 202 ✅ | V | Announcer: "enemy superweapon ready" | 3 | XS |
| 203 | V | Announcer for capture points taken and lost | 3 | XS |
| 204 | V | Acknowledgements for entering and leaving a garrison | 2 | XS |
| 205 | V | Crate pickup sound and voice line | 2 | XS |
| 206 | V | Separate volume for interface clicks | 2 | XS |
| 207 | V | A cue when one of your units in brush is spotted | 2 | XS |

### Multiplayer

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 208 | M | Ready check in the lobby before the host can start | 3 | XS |
| 209 | M | Connection quality (ping) next to each name in the lobby and in game | 3 | XS |
| 210 | M | Pause request in multiplayer (three per player, everyone sees who paused) | 3 | S |
| 211 | M | Surrender vote in team games | 3 | S |
| 212 | M | Chat stays open on the end screen ("gg") | 2 | S |
| 213 | M | Rematch with factions or start positions swapped | 2 | XS |
| 214 | M | Spectator delay option so watchers can't scout for a player | 2 | S |
| 215 | M | Rank badges by rating next to names | 2 | S |

### Tech and accessibility

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 216 | T | Skirmish autosave every 5 minutes | 3 | XS |
| 217 | T | Install as an app (PWA), with atlases cached for fast starts | 3 | S |
| 218 | T | Battery saver: cap at 30 fps on laptops | 2 | XS |
| 219 | O | Reduce flashing option (strikes, explosions, low-power blinks) | 3 | XS |
| 220 | O | Larger cursor option | 2 | XS |
| 221 | O | High-contrast interface text option | 2 | S |

## Wish list

Not planned. Ideas to pick up some day, each bigger than one feature.

| # | Area | Improvement | Impact | Cost |
|---|---|---|---|---|
| 105 | K | Fourth faction: needs a design (identity, building rule, mechanics), about 25 new Meshy models, and balance across six pairings | 4 | XL |
| 109 | G | 3D renderer (WebGPU) keeping the sim: a new renderer and art pipeline | 4 | XL |
