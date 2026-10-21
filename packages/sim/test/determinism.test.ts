import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim';

const setup = (seed: number) => ({
  rules: defaultRules(),
  seed,
  width: 96,
  height: 96,
  players: [
    { faction: 0, team: 0 },
    { faction: 1, team: 1 },
  ],
});

describe('determinism', () => {
  it('an empty sim runs 10,000 ticks twice with identical hashes', () => {
    const run = () => {
      const sim = new Sim(setup(42));
      const hashes: number[] = [];
      for (let t = 0; t < 10_000; t++) {
        sim.step();
        if (sim.tick % 20 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    const a = run();
    const b = run();
    expect(a).toHaveLength(500);
    expect(a).toEqual(b);
  });

  it('different seeds give different hashes', () => {
    expect(new Sim(setup(1)).hash()).not.toBe(new Sim(setup(2)).hash());
  });

  it('commands change state and are applied at their tick', () => {
    const sim = new Sim(setup(7));
    sim.schedule({ tick: 5, player: 1, cmd: { type: 'surrender' } });
    sim.run(5);
    expect(sim.world.players[1]!.surrendered).toBe(false);
    sim.step();
    expect(sim.world.players[1]!.surrendered).toBe(true);
    expect(() => sim.schedule({ tick: 2, player: 0, cmd: { type: 'noop' } })).toThrow();
  });
});

describe('big battle determinism', () => {
  it('two runs of a 240-unit battle with commands produce identical hash streams', async () => {
    const { bigBattle } = await import('../src/scenarios');
    const run = () => {
      const { sim } = bigBattle(defaultRules(), { unitsPerSide: 120 });
      const hashes: number[] = [];
      for (let t = 0; t < 1000; t++) {
        sim.step();
        if (sim.tick % 20 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });

  it('golden hash is stable (update deliberately when sim rules change)', async () => {
    const { goldenHash } = await import('../src/scenarios');
    expect(goldenHash(defaultRules()).toString(16)).toMatchInlineSnapshot(`"33c5d4c0"`);
  });
});
