import { describe, expect, it } from 'vitest';
import { spawnStructure } from '@signal-fall/sim';
import { createSim } from '../src';

const spec = (map: object) =>
  ({ kind: 'skirmish', seed: 5, factions: [0, 1], ai: [null, null], map: { size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'open', ...map } }) as const;

describe('match options', () => {
  it('starting credits apply to every player', () => {
    const { sim } = createSim(spec({ credits: 20000 }));
    expect(sim.world.players.map((p) => p.credits)).toEqual([20000, 20000]);
  });

  it('with superweapons off nobody can build one', () => {
    const queued = (superweapons: boolean) => {
      const { sim } = createSim(spec({ superweapons, credits: 50000 }));
      const w = sim.world;
      const f = w.rules.factions[0]!;
      const item = f.structures.find((i) => w.rules.structures[i]!.role === 'superweapon')!;
      const sw = w.rules.structures[item]!;
      // Every building the superweapon needs, in a row.
      sw.requires.forEach((role, k) => spawnStructure(w, f.structures.find((i) => w.rules.structures[i]!.role === role)!, 0, 4 + k * 4, 30));
      sim.schedule({ tick: 0, player: 0, cmd: { type: 'build', category: sw.category, item } as never });
      sim.run(3);
      return w.players[0]!.build.some((q) => q.item === item);
    };
    expect(queued(true)).toBe(true);
    expect(queued(false)).toBe(false);
  });
});
