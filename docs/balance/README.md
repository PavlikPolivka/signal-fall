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
