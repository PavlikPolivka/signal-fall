# Performance: the 60 fps goal

The game has to hold 60 fps on an ordinary laptop (an M1 MacBook here), in Chrome, Safari and Firefox-based
browsers (Zen), with other work on the machine. Kept by `e2e/perf.spec.ts`, which runs with the rest of the suite.

## What the guard checks

| Check | Where it runs | Why |
|---|---|---|
| A 400-unit battle draws in under 40 draw calls a frame (it takes 4) | everywhere, CI included | A draw call per unit sank Firefox (its WebGL calls cross into a GPU process) |
| No `mix-blend-mode` or `backdrop-filter` on anything visible in a match | everywhere | A CSS blend over the game canvas made Firefox recomposite the build list every frame |
| The game's own work per frame under 6 ms | everywhere | Room for the browser inside a 16.7 ms frame |
| The battle holds ≥ 58 fps with a 95th-percentile frame under 20 ms | with a real GPU (Metal on macOS) | The goal itself; skipped on software rendering (CI) |
| 400 units at ≥ 58 fps (older test) | with a real GPU | |

The perf tests run one at a time: frame rates need the GPU to themselves.

## Findings (2026-10-25)

Zen 1.23 (Firefox), M1, Retina, 400-unit battle:

| Change | fps |
|---|---|
| Before | 13–15 |
| Team colors baked into the sprites (406 → 4 draw calls a frame) | 13 (draw calls weren't the limit on their own) |
| Build-list icons tinted once in a canvas instead of a live CSS multiply blend | **60** |

With six of eight cores kept busy the opening and zoomed-out views stay at 57–59 fps; big battles keep a
17 ms median frame with occasional slow frames (95th percentile 44–53 ms) while the machine is that loaded.

Chrome (Metal) runs 150–290 fps in the same scenes; it never showed these problems.

## Measuring Firefox

Playwright's Firefox doesn't start here; the measurements drove a separate headless Zen over Marionette
(`layout.css.devPixelsPerPx = 2` for Retina) with its own throwaway profile. A Firefox window that isn't in
front is throttled to a few frames a second, so headed runs in the background measure nothing.
