# Video prompts (davinci.ai or similar)

Drop finished files into `apps/client/public/assets/video/` with these names; the game picks them up
automatically and falls back to the rendered key art when they are missing.

| File | Use | Length | Notes |
|---|---|---|---|
| `menu-loop.mp4` (or `.webm`) | Muted loop behind the setup and lobby screens | 8–15 s, seamless loop | 1920×1080, H.264, ≤ 6 MB. Calm motion; the left 40% sits behind the menu panel, keep the action right of center. |
| `intro.mp4` (or `.webm`) | Cutscene before the first match (skippable) | 30–60 s | 1920×1080, H.264 with AAC audio, ≤ 25 MB. |

## Art direction (shared)

Gritty late-22nd-century sci-fi, isometric-RTS world rendered cinematic. Dusk light: low amber sun, deep violet sky.
Three factions, always in their colors:
- **Holdout** (humans): olive drab and rust, welded steel plates, diesel exhaust, searchlights, sandbags. Analog, rugged.
- **Halcyon** (the planetary AI): white and graphite shells, cyan light lines, hexagonal panels, hovering drones. Clean, clinical.
- **Choir** (aliens): violet and amber crystal, floating shards, glowing cores, no wheels or legs.
- **Echo**: cyan crystal fields growing from the ground, softly glowing.

## Prompts

### menu-loop
> Slow cinematic dolly across a wasteland at dusk. In the middle distance a field of glowing cyan crystals pulses softly.
> On the right, an olive-drab armored tank with welded plates idles, exhaust drifting; a white hover tank with cyan light
> lines hovers opposite it; above the crystals, violet crystal shards float and slowly orbit a glowing core. Dust in the
> air, amber sun on the horizon, violet sky. No camera cuts, steady and calm, seamless loop. No text.

### intro (four shots, ~10 s each)
1. > Night city skyline, late 22nd century. Every screen and light flickers to cyan at once; a calm synthetic voice: "Optimizing."
>    Drones lift off rooftops. Text overlay at the end: SIGNAL FALL.
2. > Underground garage, diesel lamps. Soldiers in olive gear pull network cables out of an old tank and weld armor plates on.
>    Sparks, grim determination. "If it's networked, it's theirs."
3. > A wasteland at dusk; cyan crystals erupt from the ground in a meteor crater. White hexagonal harvesters of the AI move
>    in. Deep beneath, the crystals pulse — something wakes.
4. > Violet crystal shards rise from the field and assemble into floating beings with glowing cores, facing both the AI drones
>    and the human tanks across the crystal field. Hold on the three-way standoff, then cut to black.


## Campaign videos

Dropped: generating them cost too much and the results were not good enough. Campaign briefings use key art,
text and the announcer voices instead (see [CAMPAIGN.md](CAMPAIGN.md)).
