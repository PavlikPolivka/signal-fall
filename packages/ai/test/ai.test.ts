import { defaultRules } from '@signal-fall/data';
import { generateMap } from '@signal-fall/mapgen';
import { createMatch, KIND, type Command, type Sim, type World } from '@signal-fall/sim';
import { describe, expect, it } from 'vitest';
import { attachAi, PROFILES, type Difficulty } from '../src/index';

const rules = defaultRules();

function match(seed: number, a: Difficulty, b: Difficulty) {
  const map = generateMap({ seed, size: 'S', players: 2, biome: 'wasteland', resources: 'normal', terrain: 'normal' });
  const sim = createMatch({ rules, seed, map, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }] });
  const ais = [attachAi(sim, 0, a, map.starts), attachAi(sim, 1, b, map.starts)];
  return { sim, map, ais };
}

function count(sim: Sim, player: number, kind: number): number {
  const e = sim.world.entities;
  let n = 0;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === player && e.kind[s] === kind) n++;
  return n;
}

describe('AI', () => {
  it('builds a base, an economy and an army', () => {
    const { sim } = match(3, 'normal', 'normal');
    sim.run(20 * 60 * 4);
    for (const p of [0, 1]) {
      expect(count(sim, p, KIND.structure)).toBeGreaterThanOrEqual(6);
      expect(sim.world.players[p]!.harvested).toBeGreaterThan(3000);
      expect(count(sim, p, KIND.unit)).toBeGreaterThan(8);
    }
  });

  it('is deterministic: the same AI match produces the same hash', () => {
    const run = () => {
      const { sim } = match(11, 'hard', 'easy');
      sim.run(20 * 60 * 6);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it('finishes matches, and Hard beats Easy in most of them', () => {
    let hardWins = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { sim } = match(seed, 'hard', 'easy');
      while (!sim.world.ended && sim.tick < 20 * 60 * 30) sim.run(400);
      expect(sim.world.ended).toBe(true);
      if (sim.world.winnerTeam === 0) hardWins++;
    }
    // The full acceptance batch (200 matches) runs in CI via `pnpm headless balance`.
    expect(hardWins).toBeGreaterThanOrEqual(8);
  });

  it('respects its APM cap', () => {
    const map = generateMap({ seed: 2, size: 'S', players: 2, biome: 'city', resources: 'normal', terrain: 'normal' });
    const sim = createMatch({ rules, seed: 2, map, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }] });
    const ai = attachAi(sim, 0, 'easy', map.starts);
    let issued = 0;
    const think = ai.think.bind(ai);
    ai.think = (w: World): Command[] => {
      const cmds = think(w);
      issued += cmds.length;
      return cmds;
    };
    const minutes = 5;
    sim.run(20 * 60 * minutes);
    expect(issued).toBeLessThanOrEqual(PROFILES.easy.apm * minutes);
    expect(issued).toBeGreaterThan(10);
  });

  it('only Brutal gets an income bonus', () => {
    const { sim } = match(1, 'brutal', 'hard');
    expect(sim.world.players[0]!.incomeBonusPct).toBe(25);
    expect(sim.world.players[1]!.incomeBonusPct).toBe(0);
  });

  it('respects fog: never targets an enemy it has not seen', () => {
    const { sim, ais } = match(4, 'hard', 'hard');
    sim.run(20 * 30);
    // Early on, nobody has scouted: memory must hold nothing from the far base.
    const memory = (ais[0] as unknown as { memory: Map<number, unknown> }).memory;
    expect(memory.size).toBe(0);
  });
});
