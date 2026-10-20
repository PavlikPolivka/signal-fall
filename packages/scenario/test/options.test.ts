import { describe, expect, it } from 'vitest';
import { spawnStructure } from '@signal-fall/sim';
import { createSim, type ScenarioSpec } from '../src';

const spec = (map: object): ScenarioSpec => ({ kind: 'skirmish', seed: 5, factions: [0, 1], ai: [null, null], map: { size: 'S', biome: 'wasteland', resources: 'normal', terrain: 'open', ...map } });

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

  it('the tech limit blocks tier 3 units, and a unit cap and a starting army apply', () => {
    // Player 1 an AI: a seat with neither AI nor person is the passive test base (no units).
    const { sim } = createSim({ ...spec({ techLimit: true, unitCap: 100, startArmy: true }), ai: [null, 'easy'] } as ScenarioSpec);
    const w = sim.world;
    expect(w.techLimit).toBe(true);
    expect(w.unitCap).toBe(100);
    // The construction unit and six more each.
    const owned = [0, 1].map((p) => {
      let n = 0;
      for (let s = 0; s < w.entities.high; s++) if (w.entities.alive[s] === 1 && w.entities.owner[s] === p) n++;
      return n;
    });
    expect(owned).toEqual([7, 7]);
  });
});
