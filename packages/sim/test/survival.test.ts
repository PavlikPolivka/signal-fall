import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { FIRST_WAVE_TICK, KIND, Sim, spawnUnit, FX_ONE } from '../src/index';

const rules = defaultRules();

describe('survival', () => {
  it('the horde sends its first wave on time, and is not defeated for having no base', () => {
    const s = new Sim({ rules, seed: 5, width: 64, height: 64, players: [{ faction: 0, team: 0 }, { faction: 2, team: 1 }], survivalHorde: 1 });
    // The defender has a unit so they are not defeated either.
    spawnUnit(s.world, rules.factions[0]!.constructionUnit, 0, 32 * FX_ONE, 32 * FX_ONE);
    s.run(FIRST_WAVE_TICK + 5);
    const e = s.world.entities;
    let horde = 0;
    for (let k = 0; k < e.high; k++) if (e.alive[k] === 1 && e.owner[k] === 1 && e.kind[k] === KIND.unit) horde++;
    expect(s.world.survival!.wave).toBe(1);
    expect(horde).toBeGreaterThan(0);
    expect(s.world.players[1]!.defeated).toBe(false);
    expect(s.world.ended).toBe(false);
  });

  it('plays out the same every time', () => {
    const run = () => {
      const s = new Sim({ rules, seed: 5, width: 64, height: 64, players: [{ faction: 0, team: 0 }, { faction: 2, team: 1 }], survivalHorde: 1 });
      spawnUnit(s.world, rules.factions[0]!.constructionUnit, 0, 32 * FX_ONE, 32 * FX_ONE);
      s.run(FIRST_WAVE_TICK + 200);
      return s.hash();
    };
    expect(run()).toBe(run());
  });
});
