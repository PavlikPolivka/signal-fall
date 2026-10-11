// Fine trace: army value and centroid every 15 s in a window. tsx src/trace2.ts <seed> <fA> <fB> <fromMin> <toMin>
import { defaultRules, FACTIONS, type FactionId } from '@signal-fall/data';
import { attachAi } from '@signal-fall/ai';
import { generateMap } from '@signal-fall/mapgen';
import { createMatch, KIND } from '@signal-fall/sim';

const [seedS, fa, fb, from, to] = process.argv.slice(2);
const seed = Number(seedS);
const rules = defaultRules();
const map = generateMap({ seed, size: 'M', players: 2, biome: 'wasteland', resources: 'normal', terrain: 'normal' });
const sim = createMatch({ rules, seed, map, players: [fa, fb].map((f, team) => ({ faction: FACTIONS.indexOf(f as FactionId), team })) });
[0, 1].forEach((p) => attachAi(sim, p, 'hard', map.starts));
const w = sim.world;
console.log('starts', JSON.stringify(map.starts));
sim.run(Number(from) * 1200);
while (sim.tick < Number(to) * 1200 && !w.ended) {
  sim.run(300);
  const parts = [0, 1].map((p) => {
    const e = w.entities;
    let v = 0, x = 0, y = 0, n = 0;
    const comp: Record<string, number> = {};
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.owner[s] !== p || e.kind[s] !== KIND.unit) continue;
      const r = rules.units[e.type[s]!]!;
      if (!r.weapon) continue;
      v += r.cost; x += e.x[s]! >> 10; y += e.y[s]! >> 10; n++;
      comp[r.id] = (comp[r.id] ?? 0) + 1;
    }
    return `${v} @(${n ? Math.round(x / n) : '-'},${n ? Math.round(y / n) : '-'}) ${JSON.stringify(comp)}`;
  });
  console.log((sim.tick / 1200).toFixed(2), parts.join('  |  '));
}
