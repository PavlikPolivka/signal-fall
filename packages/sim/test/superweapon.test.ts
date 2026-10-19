import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { FX_ONE, Sim, spawnStructure, spawnUnit, superweaponStatus } from '../src/index';

const rules = defaultRules();
const n = 40;

function world() {
  const s = new Sim({ rules, seed: 9, width: n, height: n, terrain: new Uint8Array(n * n), players: [{ faction: 0, team: 0 }, { faction: 1, team: 1 }], victoryRules: false });
  // Power for the gun so it charges.
  for (let k = 0; k < 2; k++) spawnStructure(s.world, rules.structureIndex.get('dynamo')!, 0, 2 + 3 * k, 2);
  return s;
}

describe('superweapons', () => {
  it('charges once built, strikes after the warning, and spares the caster', () => {
    const s = world();
    expect(superweaponStatus(s.world, 0)).toBe(-1);
    spawnStructure(s.world, rules.structureIndex.get('long_tom')!, 0, 2, 6);
    const sw = rules.structures[rules.structureIndex.get('long_tom')!]!.superweapon!;
    s.run(10);
    expect(superweaponStatus(s.world, 0)).toBeGreaterThan(0);
    // Engineers: unarmed, so only the strike hurts them.
    const enemy = spawnUnit(s.world, rules.factions[1]!.engineer, 1, 30 * FX_ONE, 30 * FX_ONE);
    const own = spawnUnit(s.world, rules.factions[0]!.engineer, 0, 30 * FX_ONE + 512, 30 * FX_ONE);
    // Too early: nothing happens.
    s.schedule({ tick: s.tick, player: 0, cmd: { type: 'superweapon', x: 30 * FX_ONE, y: 30 * FX_ONE } });
    s.run(sw.delay + 5);
    expect(s.world.players[0]!.strike.at).toBe(-1);
    s.run(sw.charge);
    expect(superweaponStatus(s.world, 0)).toBe(0);
    const hp = s.world.entities.hp[own & 0xffff]!;
    s.schedule({ tick: s.tick, player: 0, cmd: { type: 'superweapon', x: 30 * FX_ONE, y: 30 * FX_ONE } });
    s.run(2);
    expect(s.world.players[0]!.strike.at).toBeGreaterThan(s.tick);
    expect(superweaponStatus(s.world, 0)).toBeGreaterThan(sw.charge - 5);
    s.run(sw.delay);
    expect(s.world.entities.resolve(enemy)).toBe(-1);
    expect(s.world.entities.hp[own & 0xffff]).toBe(hp);
    expect(s.world.players[1]!.stats.unitsLost).toBe(1);
    expect(s.world.players[0]!.stats.unitsKilled).toBe(1);
  });

  it('one per player', () => {
    const s = world();
    s.world.players[0]!.credits = 100000;
    spawnStructure(s.world, rules.structureIndex.get('foundry')!, 0, 10, 2);
    spawnStructure(s.world, rules.structureIndex.get('radio_mast')!, 0, 14, 2);
    spawnStructure(s.world, rules.structureIndex.get('long_tom')!, 0, 2, 6);
    s.schedule({ tick: 0, player: 0, cmd: { type: 'build', category: 'structures', item: rules.structureIndex.get('long_tom')! } });
    s.run(2);
    expect(s.world.players[0]!.build[0]!.item).toBe(-1);
  });
});
