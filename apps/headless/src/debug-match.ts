// Debug: dump AI state of one balance match. tsx src/debug-match.ts <seed> <biomeIdx> <swap>
import { defaultRules, FACTIONS } from '@signal-fall/data';
import { attachAi } from '@signal-fall/ai';
import { generateMap, type Biome } from '@signal-fall/mapgen';
import { createMatch, KIND } from '@signal-fall/sim';

const [seed, bi, swap] = process.argv.slice(2).map(Number) as [number, number, number];
const biome = (['wasteland', 'city', 'crystal'] as Biome[])[bi]!;
const rules = defaultRules();
const map = generateMap({ seed, size: 'M', players: 2, biome, resources: 'normal', terrain: 'normal' });
console.log('map', biome, map.symmetry, 'starts', JSON.stringify(map.starts), 'seedUsed', map.seedUsed);
const diffs = swap ? ['easy', 'hard'] : ['hard', 'easy'];
const sim = createMatch({ rules, seed, map, players: [0, 1].map((team) => ({ faction: FACTIONS.indexOf('holdout'), team })) });
diffs.forEach((d, slot) => attachAi(sim, slot, d as 'hard', map.starts));
const w = sim.world;
for (const minute of [1, 2, 3, 4, 6]) {
  while (sim.tick < minute * 1200) sim.run(20);
  console.log(`--- minute ${minute}`);
  for (let p = 0; p < 2; p++) {
    const e = w.entities;
    const items: string[] = [];
    for (let s = 0; s < e.high; s++) {
      if (!e.alive[s] || e.owner[s] !== p) continue;
      const tx = e.x[s]! >> 10;
      const ty = e.y[s]! >> 10;
      if (e.kind[s] === KIND.structure) items.push(`${rules.structures[e.type[s]!]!.id}@${tx},${ty}`);
      else if (e.kind[s] === KIND.unit && rules.units[e.type[s]!]!.id === 'mule')
        items.push(`mule@${tx},${ty} h${e.hstate[s]} c${e.cargo[s]} st${e.stuck[s]}`);
    }
    console.log(diffs[p], 'credits', w.players[p]!.credits, 'harv', w.players[p]!.harvested, items.join(' | '));
  }
}
const m = w.map;
const [cx, cy] = (process.argv[5] ?? '35,60').split(',').map(Number) as [number, number];
for (let y = cy - 7; y <= cy + 7; y++) {
  let row = '';
  for (let x = cx - 10; x <= cx + 10; x++) {
    const i = y * m.width + x;
    const mule = [...Array(w.entities.high).keys()].some((s) => w.entities.alive[s] && w.entities.kind[s] === KIND.unit && w.entities.x[s]! >> 10 === x && w.entities.y[s]! >> 10 === y);
    row += mule ? 'M' : m.echo[i] ? String.fromCharCode(96 + Math.min(26, m.echo[i]!)) : m.occupant[i]! >= 0 ? '#' : ['.', ',', 'R', '~', 'C', 'X'][m.terrain[i]!]!;
    row += map.surface[i] === 1 ? '=' : map.surface[i] === 2 ? '_' : ' ';
  }
  console.log(String(y).padStart(3), row);
}
const e = w.entities;
for (let s = 0; s < e.high; s++)
  if (e.alive[s] && e.kind[s] === KIND.unit && rules.units[e.type[s]!]!.id === 'mule')
    console.log('mule', s, 'owner', e.owner[s], 'htile', e.htile[s]! % m.width, Math.floor(e.htile[s]! / m.width), 'pathGoal', e.pathGoal[s], 'goal', e.goalX[s]! >> 10, e.goalY[s]! >> 10, e.hasGoal[s]);
for (let s = 0; s < e.high; s++) {
  if (!e.alive[s] || e.kind[s] !== KIND.unit) continue;
  const x = e.x[s]! / 1024;
  const y = e.y[s]! / 1024;
  if (Math.abs(x - cx) > 5 || Math.abs(y - cy) > 5) continue;
  console.log('unit', s, rules.units[e.type[s]!]!.id, 'own', e.owner[s], x.toFixed(2), y.toFixed(2), 'goal', e.hasGoal[s], (e.goalX[s]! / 1024).toFixed(1), (e.goalY[s]! / 1024).toFixed(1), 'stuck', e.stuck[s], 'orders', JSON.stringify(e.orders[s]).slice(0, 80), 'path', e.paths[s]?.length, e.pathIdx[s]);
}
