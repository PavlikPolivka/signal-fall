// Battle lab: equal-cost armies of two factions fight on open ground, using
// their AI army mix and AI ability use. Isolates unit balance from macro.
//   tsx src/lab.ts [budget] [tier] [seeds]
import { defaultRules, aiProfiles, FACTIONS } from '@signal-fall/data';
import { abilityOrders } from '@signal-fall/ai';
import { FX_HALF, FX_SHIFT, KIND, Sim, spawnUnit, type World } from '@signal-fall/sim';

const budget = Number(process.argv[2] ?? 6000);
const maxTier = Number(process.argv[3] ?? 2);
const seeds = Number(process.argv[4] ?? 6);
const rules = defaultRules();
const profiles = aiProfiles();

/** Army by the AI's weights, only units up to maxTier, spending the budget greedily by weight deficit. */
/** LAB_A / LAB_B = "grunt:15,tankbuster:7" override the composition per side. */
function explicit(spec: string | undefined): number[] | null {
  if (!spec) return null;
  return spec.split(',').flatMap((t) => {
    const [id, n] = t.split(':');
    return Array.from({ length: Number(n) }, () => rules.unitIndex.get(id!)!);
  });
}

function army(faction: number): number[] {
  const prof = profiles.get(FACTIONS[faction]!)!;
  const pool = prof.army
    .map(([id, w]) => ({ rule: rules.units[rules.unitIndex.get(id)!]!, w }))
    .filter((p) => p.rule.tier <= maxTier && (process.env.LAB_AIR !== undefined || p.rule.tab !== 'air'));
  const counts = pool.map(() => 0);
  let left = budget;
  for (;;) {
    let best = -1;
    let bestScore = Infinity;
    pool.forEach((p, i) => {
      if (p.rule.cost > left) return;
      const score = (counts[i]! + 1) / p.w;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    counts[best]!++;
    left -= pool[best]!.rule.cost;
  }
  const out: number[] = [];
  pool.forEach((p, i) => {
    for (let k = 0; k < counts[i]!; k++) out.push(p.rule.index);
  });
  return out;
}

function value(world: World, owner: number): number {
  const e = world.entities;
  let v = 0;
  for (let s = 0; s < e.high; s++)
    if (e.alive[s] === 1 && e.kind[s] === KIND.unit && e.owner[s] === owner) v += rules.units[e.type[s]!]!.cost;
  return v;
}

function fight(fa: number, fb: number, seed: number): { winner: number; left: [number, number] } {
  const size = 56;
  const sim = new Sim({ rules, seed, width: size, height: size, players: [{ faction: fa, team: 0 }, { faction: fb, team: 1 }], victoryRules: false });
  const mid = size >> 1;
  const sides = [explicit(fa === labA ? process.env.LAB_A : process.env.LAB_B) ?? army(fa), explicit(fb === labA ? process.env.LAB_A : process.env.LAB_B) ?? army(fb)];
  const handles: number[][] = [[], []];
  sides.forEach((units, side) => {
    const dir = side === 0 ? 1 : -1;
    const col0 = mid - dir * 8;
    units.forEach((u, i) => {
      const x = ((col0 - dir * Math.floor(i / 8)) << FX_SHIFT) + FX_HALF;
      const y = ((mid + (i % 8) - 4) << FX_SHIFT) + FX_HALF;
      handles[side]!.push(spawnUnit(sim.world, u, side, x, y));
    });
  });
  const homes = [{ x: 2, y: mid }, { x: size - 3, y: mid }];
  for (const side of [0, 1])
    sim.addBrain({
      player: side,
      think: (w) => {
        const e = w.entities;
        const mine: number[] = [];
        for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.kind[s] === KIND.unit && e.owner[s] === side) mine.push(s);
        return process.env.LAB_NOABILITY ? [] : abilityOrders(w, side, homes[side]!, mine);
      },
    });
  for (const side of [0, 1])
    sim.schedule({ tick: 0, player: side, cmd: { type: 'attackMove', units: handles[side]!, x: (homes[1 - side]!.x << FX_SHIFT) + FX_HALF, y: (mid << FX_SHIFT) + FX_HALF } });
  while (sim.tick < 20 * 150) {
    sim.run(20);
    if (value(sim.world, 0) === 0 || value(sim.world, 1) === 0) break;
  }
  const left: [number, number] = [value(sim.world, 0), value(sim.world, 1)];
  return { winner: left[0] > left[1] ? 0 : left[1] > left[0] ? 1 : -1, left };
}

const names = FACTIONS;
const only = process.env.LAB_PAIR?.split(',').map(Number) as [number, number] | undefined;
const labA = only ? only[0] : -1;
for (const [a, b] of only ? [only] : ([[0, 1], [0, 2], [1, 2]] as const)) {
  let wa = 0;
  let la = 0;
  let lb = 0;
  for (let k = 0; k < seeds; k++) {
    // Alternate sides to cancel positional bias.
    const swap = k % 2 === 1;
    const r = swap ? fight(b, a, k + 1) : fight(a, b, k + 1);
    const winA = swap ? r.winner === 1 : r.winner === 0;
    if (winA) wa++;
    la += swap ? r.left[1] : r.left[0];
    lb += swap ? r.left[0] : r.left[1];
  }
  console.log(`${names[a]} vs ${names[b]} (T${maxTier}, $${budget}): ${names[a]} wins ${wa}/${seeds}, value left ${Math.round(la / seeds)} vs ${Math.round(lb / seeds)}`);
}
