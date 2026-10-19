import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { FX_ONE, Sim, spawnUnit, TERRAIN } from '../src/index';

const rules = defaultRules();
const n = 32;

function world() {
  const terrain = new Uint8Array(n * n);
  // A 3x3 block of ruins in the middle.
  for (let y = 14; y <= 16; y++) for (let x = 14; x <= 16; x++) terrain[y * n + x] = TERRAIN.ruins;
  return new Sim({ rules, seed: 4, width: n, height: n, terrain, players: [{ faction: 0, team: 0 }, { faction: 1, team: 1 }], victoryRules: false });
}

describe('garrisons', () => {
  it('infantry walk into the ruins, sit tight, and step out on the next order', () => {
    const s = world();
    const g = spawnUnit(s.world, rules.unitIndex.get('grunt')!, 0, 10 * FX_ONE, 10 * FX_ONE);
    const slot = g & 0xffff;
    s.schedule({ tick: 0, player: 0, cmd: { type: 'garrison', units: [g], tx: 15, ty: 15 } });
    s.run(400);
    expect(s.world.entities.garrison[slot]).toBeGreaterThan(0);
    const t = s.world.entities.garrison[slot]! - 1;
    expect(s.world.map.terrain[t]).toBe(TERRAIN.ruins);
    s.schedule({ tick: s.tick, player: 0, cmd: { type: 'move', units: [g], x: 5 * FX_ONE, y: 5 * FX_ONE } });
    s.run(2);
    expect(s.world.entities.garrison[slot]).toBe(0);
    expect(s.world.map.terrain[(s.world.entities.y[slot]! >> 10) * n + (s.world.entities.x[slot]! >> 10)]).not.toBe(TERRAIN.ruins);
  });

  it('vehicles cannot garrison', () => {
    const s = world();
    const v = spawnUnit(s.world, rules.unitIndex.get('jackrabbit')!, 0, 10 * FX_ONE, 10 * FX_ONE);
    s.schedule({ tick: 0, player: 0, cmd: { type: 'garrison', units: [v], tx: 15, ty: 15 } });
    s.run(400);
    expect(s.world.entities.garrison[v & 0xffff]).toBe(0);
  });
});
