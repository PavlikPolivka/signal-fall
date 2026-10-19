import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { FX_ONE, Sim, spawnUnit } from '../src/index';

const rules = defaultRules();
const make = () =>
  new Sim({
    rules,
    seed: 2,
    width: 48,
    height: 48,
    players: [
      { faction: 0, team: 0 },
      { faction: 1, team: 1 },
    ],
    // No base needed for this test.
    victoryRules: false,
    mission: {
      objectives: [
        { kind: 'reach', area: { x: 40, y: 40, r: 3 } },
        { kind: 'survive', ticks: 200 },
      ],
      triggers: [{ at: 100, every: 100, actions: [{ kind: 'spawn', player: 1, unit: 'sentry', count: 2, x: 5, y: 40, attack: { x: 10, y: 10 } }] }],
    },
  });

describe('missions', () => {
  it('objectives tick off, triggers fire on time, and the mission is won when all are done', () => {
    const s = make();
    const u = spawnUnit(s.world, rules.unitIndex.get('jackrabbit')!, 0, 10 * FX_ONE, 10 * FX_ONE);
    s.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [u], x: 40 * FX_ONE, y: 40 * FX_ONE } });
    s.run(150);
    let enemy = 0;
    for (let k = 0; k < s.world.entities.high; k++) if (s.world.entities.alive[k] === 1 && s.world.entities.owner[k] === 1) enemy++;
    expect(enemy).toBe(2);
    s.run(600);
    expect(s.world.mission!.status).toEqual([1, 1]);
    expect(s.world.ended).toBe(true);
    expect(s.world.winnerTeam).toBe(0);
  });

  it('plays out the same every time', () => {
    const a = make();
    const b = make();
    a.run(500);
    b.run(500);
    expect(a.hash()).toBe(b.hash());
  });
});
