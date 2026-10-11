# Balance

Hard AI vs Hard AI, 300 matches per pairing on medium maps (sides alternate start positions, biomes rotate).
CI re-runs this and fails outside 45–55%.

| Pairing | Result | A wins |
|---|---|---|
| Holdout vs Halcyon | 148–147, 5 draws | 49.3% |
| Holdout vs Choir | 149–151 | 49.7% |
| Halcyon vs Choir | 158–140, 2 draws | 52.7% |

Hard beats Easy 98.5% (Holdout), 99.5% (Halcyon), 97% (Choir) over 200 matches each.

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
