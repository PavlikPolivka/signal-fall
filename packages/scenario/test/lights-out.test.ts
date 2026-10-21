import { expect, it } from 'vitest';
import { createSim } from '../src';

// Lights Out is a squad with no base: plain attack-moves down the road, with Thule a stage behind, must get
// across the bridge (a player using the ruins and the brush does better).
it.each(['normal', 'hard'] as const)('Lights Out can be won by marching the squad down the road (%s)', (difficulty) => {
  const { sim, extras } = createSim({ kind: 'mission', id: 'lights-out', seed: 0, difficulty });
  const w = sim.world;
  const e = w.entities;
  const [a, b] = [extras.starts[0]!, extras.starts[1]!];
  const at = (t: number) => ({ x: ((a.x + Math.trunc(((b.x - a.x) * t) / 100) - (t === 100 ? 1 : 0)) << 10) + 512, y: ((a.y + Math.trunc(((b.y - a.y) * t) / 100) - (t === 100 ? 1 : 0)) << 10) + 512 });
  const mine = () => {
    const out: number[] = [];
    for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === 0 && e.kind[s] === 1) out.push(e.handle(s));
    return out;
  };
  const stages = [25, 45, 65, 80, 92, 100];
  let k = 0;
  while (!w.ended && sim.tick < 10 * 1200) {
    if (sim.tick % 500 === 0 && k < stages.length) {
      const thule = w.mission!.tags.get('thule');
      sim.schedule({ tick: sim.tick + 1, player: 0, cmd: { type: 'attackMove', units: mine().filter((h) => h !== thule), ...at(stages[k]!) } });
      if (thule !== undefined && k > 1) sim.schedule({ tick: sim.tick + 1, player: 0, cmd: { type: 'move', units: [thule], ...at(stages[k - 2]!) } });
      k++;
    }
    sim.step();
  }
  expect(w.ended && w.winnerTeam === w.players[0]!.team).toBe(true);
}, 120_000);
