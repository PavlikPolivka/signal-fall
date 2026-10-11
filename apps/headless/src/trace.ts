// Trace one AI vs AI match per minute: tsx src/trace.ts <seed> <factionA> <factionB> [biome] [diffA] [diffB]
import { defaultRules, FACTIONS, type FactionId } from '@signal-fall/data';
import { attachAi, type Difficulty } from '@signal-fall/ai';
import { generateMap, type Biome } from '@signal-fall/mapgen';
import { createMatch, KIND } from '@signal-fall/sim';

const [seedS, fa, fb, biome = 'wasteland', da = 'hard', db = 'hard'] = process.argv.slice(2);
const seed = Number(seedS);
const rules = defaultRules();
const map = generateMap({ seed, size: 'M', players: 2, biome: biome as Biome, resources: 'normal', terrain: 'normal' });
const factions = [fa, fb].map((f) => FACTIONS.indexOf(f as FactionId));
const sim = createMatch({ rules, seed, map, players: factions.map((faction, team) => ({ faction, team })) });
[da, db].forEach((d, p) => attachAi(sim, p, d as Difficulty, map.starts));
const w = sim.world;
for (let min = 1; min <= 30 && !w.ended; min++) {
  sim.run(1200);
  const row = [0, 1].map((p) => {
    const e = w.entities;
    let army = 0;
    let harv = 0;
    let structs = 0;
    let defense = 0;
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.owner[s] !== p) continue;
      if (e.kind[s] === KIND.unit) {
        const r = rules.units[e.type[s]!]!;
        if (r.abilities.some((a) => a.kind === 'harvest')) harv++;
        else if (r.weapon) army += r.cost;
      } else if (e.kind[s] === KIND.structure) {
        structs++;
        if (rules.structures[e.type[s]!]!.weapon) defense++;
      }
    }
    const pl = w.players[p]!;
    return `${FACTIONS[pl.faction]!.padEnd(7)} $${String(pl.credits).padStart(5)} mined ${String(pl.harvested).padStart(6)} army ${String(army).padStart(6)} harv ${harv} bld ${structs} def ${defense}`;
  });
  console.log(`${String(min).padStart(2)}m  ${row.join('  |  ')}`);
}
console.log('winner team', w.winnerTeam, 'at', (sim.tick / 1200).toFixed(1), 'min');
