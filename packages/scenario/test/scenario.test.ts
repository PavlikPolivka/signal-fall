import { describe, expect, it } from 'vitest';
import { createSim, type ScenarioSpec } from '../src/index';

const map = { size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'normal' } as const;

describe('scenarios', () => {
  it('the same spec gives the same match', () => {
    const spec: ScenarioSpec = { kind: 'skirmish', seed: 5, factions: [0, 1], ai: ['easy', 'easy'], map };
    const a = createSim(spec).sim;
    const b = createSim(spec).sim;
    a.run(400);
    b.run(400);
    expect(a.hash()).toBe(b.hash());
  });

  it('2v2: teams from the spec; agent seats get no free base', () => {
    const { sim } = createSim({
      kind: 'skirmish',
      seed: 3,
      factions: [0, 2, 1, 0],
      ai: [null, 'easy', 'easy', null],
      teams: [0, 0, 1, 1],
      agents: [null, null, null, { name: 'Test agent' }],
      map: { ...map, size: 'M' },
    });
    expect(sim.world.players.map((p) => p.team)).toEqual([0, 0, 1, 1]);
    // Slot 3 starts like a player (an MCV), not with a ready-made base.
    const structures = (p: number) => {
      let n = 0;
      for (let s = 0; s < sim.world.entities.high; s++) if (sim.world.entities.alive[s] === 1 && sim.world.entities.owner[s] === p && sim.world.entities.kind[s] === 2) n++;
      return n;
    };
    expect(structures(3)).toBe(0);
  });
});
