import { describe, expect, it } from 'vitest';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { FOG_EXPLORED, FOG_VISIBLE } from '../src/world';
import { at, makeSim, structure, unit } from './helpers';

describe('fog of war', () => {
  it('marks visible and explored tiles, and keeps explored after leaving', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const h = spawnUnit(w, unit('jackrabbit'), 0, at(5), at(5));
    sim.run(4);
    const fog = w.fog[0]!;
    expect(fog[5 * 40 + 5]! & FOG_VISIBLE).toBeTruthy();
    expect(fog[5 * 40 + 35]).toBe(0);
    expect(w.fog[1]![5 * 40 + 5]).toBe(0);
    sim.schedule({ tick: sim.tick, player: 0, cmd: { type: 'move', units: [h], x: at(35), y: at(35) } });
    sim.run(20 * 20);
    expect(fog[5 * 40 + 5]).toBe(FOG_EXPLORED);
    expect(fog[35 * 40 + 35]! & FOG_VISIBLE).toBeTruthy();
  });
});

describe('victory', () => {
  it('a player with no structures or construction units is defeated', () => {
    const sim = makeSim({ victoryRules: true });
    const w = sim.world;
    spawnStructure(w, structure('dynamo'), 0, 2, 2);
    const overture = spawnUnit(w, unit('overture'), 1, at(20), at(20));
    sim.step();
    expect(w.ended).toBe(false);
    w.entities.hp[overture & 0xffff] = 0;
    sim.step();
    expect(w.players[1]!.defeated).toBe(true);
    expect(w.ended).toBe(true);
    expect(w.winnerTeam).toBe(0);
  });

  it('surrender ends the match', () => {
    const sim = makeSim({ victoryRules: false });
    sim.schedule({ tick: 3, player: 0, cmd: { type: 'surrender' } });
    sim.run(5);
    expect(sim.world.ended).toBe(true);
    expect(sim.world.winnerTeam).toBe(1);
  });
});
