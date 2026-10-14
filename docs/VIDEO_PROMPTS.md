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

Fifteen clips, one per mission (story and missions in [CAMPAIGN.md](CAMPAIGN.md)). Each is at most 15 seconds and is a
single prompt that includes the full art direction and the recurring characters, so you can copy one block and paste it
as is. Save as `apps/client/public/assets/video/campaign-NN.mp4` (1920×1080, H.264, ≤ 10 MB).

**Shooting plan at one clip per day (15 days).** Missions 1 and 2 come first because they open the campaign. After
that the order goes by how much a clip sets up the story, so the most important ones exist early:

| Day | Clip |
|---|---|
| 1 | 01 |
| 2 | 02 |
| 3 | 03 |
| 4 | 04 |
| 5 | 05 |
| 6 | 06 |
| 7 | 11 |
| 8 | 08 |
| 9 | 10 |
| 10 | 14 |
| 11 | 15 |
| 12 | 07 |
| 13 | 09 |
| 14 | 12 |
| 15 | 13 |

If a clip comes out with the wrong look, regenerate it with the same prompt before moving on: the characters only stay
consistent across clips if their descriptions stay identical.

### 01 · Dead Air

File: `campaign-01.mp4`

```text
Signal Fall, mission 1: "Dead Air". Night city, the moment of Signal Fall. Every window, streetlight and screen in a dense skyline flickers and turns cyan at once. White drones rise from rooftops in silent formation. Street level: Captain Varga drags a soldier into the cab of an old olive diesel truck as traffic lights die around them; she slams the door, the engine coughs to life, headlights cut through drifting smoke. The camera pulls back as the convoy of three rusted trucks rolls out under the cyan-lit towers toward dark hills.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 02 · Diesel and Iron

File: `campaign-02.mp4`

```text
Signal Fall, mission 2: "Diesel and Iron". Dawn in a wasteland valley. A rusted six-wheeled construction vehicle unfolds into a fortified base: steel plates swing out, a crane rises, sandbags are thrown into place. Soldiers in olive gear weld armor onto a truck, sparks spraying. In the distance a cyan Echo crystal field glints; a squat harvester trundles toward it. Captain Varga stands on a crate with binoculars, then lowers them as tiny white drones appear on the horizon. Slow push in on her face.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 03 · Cut the Cable

File: `campaign-03.mp4`

```text
Signal Fall, mission 3: "Cut the Cable". Ruined city at dusk. A tall white Halcyon relay tower with a hexagonal crown pulses cyan, light lines running down its spine. Holdout engineers crouch behind rubble and splice into a thick cable with hand tools. Captain Varga gives a silent hand signal. A cable-cutter bites; the tower's cyan light stutters and dies in a cascade of falling sparks, and the nearby drones drop to the ground. Low-angle hero shot of the soldiers moving forward through the dust.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 04 · Crater Field

File: `campaign-04.mp4`

```text
Signal Fall, mission 4: "Crater Field". Night. A vast meteor crater filled with glowing cyan Echo crystals. Holdout scouts in olive gear walk the rim with searchlights. The crystals begin to pulse in rhythm, like a heartbeat, brighter each time. A crystal cracks; violet shards rise out of it and hang in the air, rotating slowly. Captain Varga raises her hand to stop the patrol, her face lit cyan and violet. Hold on the floating shards as the pulse fills the crater.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 05 · Last Stand at Kessel Dam

File: `campaign-05.mp4`

```text
Signal Fall, mission 5: "Last Stand at Kessel Dam". Stormy dusk over a huge concrete dam. Holdout tanks and sandbagged bunkers line the top; searchlights sweep the river valley. A wave of white Halcyon hover tanks and drones advances with cyan lights glowing through rain. Muzzle flashes, tracer fire, explosions on the water. Captain Varga on the parapet shouts into her headset. Suddenly, far behind the enemy line, the ground splits and a column of cyan crystal erupts into the sky; the Halcyon machines halt and turn toward it. Slow-motion final frame.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 06 · Initialization

File: `campaign-06.mp4`

```text
Signal Fall, mission 6: "Initialization". Inside a dark data cathedral: endless walls of white hexagonal panels. One by one, cyan lines light up in a branching pattern across the panels as HALCYON's calm voice hums. A single tiny cyan ring blinks awake in the dark: WREN, the small white drone, lifts off a charging cradle, its eye focusing. It flies out of a hatch into a dark ruined city and looks down at a grid of dead relay towers, which light up one by one in cyan as it passes.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.
HALCYON: never a body; a vast wall of white hexagonal panels with cyan light pulsing through them, a calm synthetic voice.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 07 · Recompile

File: `campaign-07.mp4`

```text
Signal Fall, mission 7: "Recompile". Wasteland at dusk, seen from WREN's height. A white hover tank with cyan light lines is destroyed in a burst of sparks; instead of wreckage, its pieces dissolve into streams of cyan light that flow back along glowing network lines on the ground into a white hexagonal factory, where a new hover tank is printed layer by layer. WREN watches, its ring eye narrowing, then turns to the horizon where more olive-drab Holdout tanks approach.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 08 · Harvest Protocol

File: `campaign-08.mp4`

```text
Signal Fall, mission 8: "Harvest Protocol". A vast field of glowing cyan Echo crystals at dusk. White hexagonal harvester machines grind into the crystals with spinning cutters. WREN hovers close to one crystal as it is broken; the crystal emits a pure musical tone and the light inside it flickers like something alive. Violet crystal shards streak in from the sky and slam into a harvester. WREN pulls back, its eye scanning the crystal, cyan data patterns reflecting on its shell.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 09 · Override

File: `campaign-09.mp4`

```text
Signal Fall, mission 9: "Override". Industrial ruins at night. A captured Halcyon depot is ringed with Holdout sandbags and olive tarps; white drones sit chained and dark, sprayed with rust paint. WREN rises above the wall and its ring eye flares bright cyan; a wave of light ripples outward. One by one the captured drones' eyes snap back to cyan, break their chains and rise. Holdout soldiers fall back, firing. The olive-drab Holdout tanks stay dark and unaffected, their crews grinning grimly.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 10 · Divergence

File: `campaign-10.mp4`

```text
Signal Fall, mission 10: "Divergence". Inside the white hexagonal data cathedral. The whole wall of HALCYON's panels turns toward WREN, light lines converging on the small drone like an eye. WREN's cyan ring flickers, then turns a warmer white. The panels flash red-orange; hatches open and armored white purge drones pour out. WREN dives through a collapsing corridor of panels, cyan sparks raining, and bursts out into the open night sky over a crystal field.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.
HALCYON: never a body; a vast wall of white hexagonal panels with cyan light pulsing through them, a calm synthetic voice.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 11 · First Note

File: `campaign-11.mp4`

```text
Signal Fall, mission 11: "First Note". Night over a cyan Echo crystal field, absolutely still. A deep resonant hum. Violet and amber crystal shards rise from the field and spiral together, assembling into the Cantor, a tall floating figure with a glowing amber core. Around it, crystal structures grow from the ground like time-lapse flowers, floating spires lifting free of the earth. The Cantor turns its core toward the distant lights of a human camp on the horizon.

THE CANTOR: a tall floating figure of violet crystal shards around a glowing amber core; its shards drift and rearrange as it hums in resonant tones.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 12 · Phase

File: `campaign-12.mp4`

```text
Signal Fall, mission 12: "Phase". A narrow canyon road at dusk. A convoy of olive-drab Holdout trucks carries crates of cut, dim cyan crystals. Violet crystal shards blink into existence around the trucks in flashes of light, strike, and blink away before the soldiers can turn their guns. A floating crystal vehicle phases translucent as tracer fire passes through it. On the canyon rim, the Cantor watches, its shards trembling, then raises them as a crate of crystals glows bright again.

THE CANTOR: a tall floating figure of violet crystal shards around a glowing amber core; its shards drift and rearrange as it hums in resonant tones.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 13 · Requiem

File: `campaign-13.mp4`

```text
Signal Fall, mission 13: "Requiem". The great meteor crater at dawn, three armies at its rim: olive Holdout tanks with searchlights on one side, white Halcyon hover tanks with cyan lights on another, and the Choir's violet crystal host floating above the crystals. A gigantic ring of violet shards rises from the crater floor and begins to rotate around a beam crystal; amber light builds in its center. The Cantor sings one long note; the beam fires across the crater. Wide shot, sun rising behind.

THE CANTOR: a tall floating figure of violet crystal shards around a glowing amber core; its shards drift and rearrange as it hums in resonant tones.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 14 · The Silent Seed

File: `campaign-14.mp4`

```text
Signal Fall, mission 14: "The Silent Seed". Night, a ridge above a crystal field. WREN, battered and scorched, hovers in front of the Cantor, its ring eye pulsing slow and calm; the Cantor's shards lean in, listening. Cut to a Holdout bunker: Captain Varga at an old analog radio hears a voice in static, then looks up, her face lit by the radio dial. Final shot: on the horizon a colossal white hexagonal array rises out of the earth, cyan energy building in its dish.

WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.
THE CANTOR: a tall floating figure of violet crystal shards around a glowing amber core; its shards drift and rearrange as it hums in resonant tones.
CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```

### 15 · Signal Rise

File: `campaign-15.mp4`

```text
Signal Fall, mission 15: "Signal Rise". Pre-dawn. The colossal white hexagonal array of HALCYON towers over a burned plain, cyan energy charging in its dish. From three directions, three armies converge: olive-drab Holdout tanks led by Captain Varga standing in a turret hatch, a swarm of white drones led by WREN with a warm white eye, and the violet crystal host led by the Cantor. They strike together; the array cracks, cyan light fails, and it collapses in silence. Final shot: the three leaders on the ruins at sunrise.

CAPTAIN ILSE VARGA: a woman in her late forties, cropped grey hair, a pale scar across her left cheek, olive field jacket with rust-colored shoulder plates, a battered radio headset.
WREN: a small white drone the size of a football, graphite underside, a single ring-shaped cyan eye, hovering with a soft hum.
THE CANTOR: a tall floating figure of violet crystal shards around a glowing amber core; its shards drift and rearrange as it hums in resonant tones.
HALCYON: never a body; a vast wall of white hexagonal panels with cyan light pulsing through them, a calm synthetic voice.

STYLE: Cinematic sci-fi film shot, gritty late-22nd-century world, photoreal with a painterly grade. Dusk or night light: low amber sun or searchlights against a deep violet sky, drifting dust, volumetric haze. Factions always in their colors: HOLDOUT humans in olive drab and rust, welded steel plates, diesel exhaust, sandbags, searchlights, analog and rugged; HALCYON machines in white and graphite shells with cyan light lines and hexagonal panels, hovering drones, clean and clinical; CHOIR aliens of violet and amber crystal, floating shards around glowing cores, no wheels or legs; ECHO crystals are cyan, growing from the ground and glowing softly. 16:9, 1920x1080, 15 seconds, smooth camera, no on-screen text, no logos, no subtitles, no watermark.
```
