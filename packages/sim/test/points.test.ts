import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { CAPTURE_TICKS, DERRICK_CREDITS, FOG_VISIBLE, FX_ONE, POINT, Sim, spawnUnit } from '../src/index';

const rules = defaultRules();
const grunt = rules.unitIndex.get('grunt')!;

function sim(kind: number) {
  return new Sim({
    rules,
    seed: 3,
    width: 48,
    height: 48,
    players: [
      { faction: 0, team: 0 },
      { faction: 0, team: 1 },
    ],
    victoryRules: false,
    points: [{ x: 24, y: 24, kind }],
  });
}
const at = (t: number) => t * FX_ONE + (FX_ONE >> 1);

describe('capture points', () => {
  it('a unit standing next to a point takes it, and a derrick then pays its owner', () => {
    const s = sim(POINT.derrick);
    spawnUnit(s.world, grunt, 0, at(25), at(24));
    s.run(CAPTURE_TICKS + 10);
    expect(s.world.points[0]!.owner).toBe(0);
    const before = s.world.players[0]!.credits;
    s.run(40);
    expect(s.world.players[0]!.credits - before).toBe(2 * DERRICK_CREDITS);
  });

  it('a contested point is not taken', () => {
    const s = sim(POINT.derrick);
    spawnUnit(s.world, grunt, 0, at(25), at(24));
    spawnUnit(s.world, grunt, 1, at(23), at(24));
    // Hold fire on both, so they stand there together.
    s.schedule({ tick: 0, player: 0, cmd: { type: 'stance', units: [1], stance: 3 } });
    s.run(CAPTURE_TICKS + 10);
    expect(s.world.points[0]!.owner).toBe(-1);
  });

  it('a watchtower shows its owner the land around it', () => {
    const s = sim(POINT.watchtower);
    spawnUnit(s.world, grunt, 0, at(25), at(24));
    s.run(CAPTURE_TICKS + 10);
    // Far from the unit but within the tower's sight.
    expect(s.world.fog[0]![24 * 48 + 34]! & FOG_VISIBLE).toBe(FOG_VISIBLE);
  });

  it('maps without points hash as before (no extra state)', () => {
    const a = new Sim({ rules, seed: 3, width: 48, height: 48, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false });
    const b = new Sim({ rules, seed: 3, width: 48, height: 48, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false, points: [] });
    a.run(50);
    b.run(50);
    expect(a.hash()).toBe(b.hash());
  });
});
