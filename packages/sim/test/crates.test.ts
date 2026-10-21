import { defaultRules } from '@signal-fall/data';
import { describe, expect, it } from 'vitest';
import { CRATE, CRATE_CREDITS, FOG_VISIBLE, FX_ONE, Sim, spawnUnit } from '../src/index';

const rules = defaultRules();
const grunt = rules.unitIndex.get('grunt')!;
const make = (crates: boolean) =>
  new Sim({ rules, seed: 11, width: 48, height: 48, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false, crates });

describe('crates', () => {
  it('drop now and then, and the first unit to reach one opens it', () => {
    const s = make(true);
    s.run(901);
    const list = s.world.crates!.list;
    expect(list.length).toBe(1);
    const c = list[0]!;
    const before = s.world.players[0]!.credits;
    const u = spawnUnit(s.world, grunt, 0, c.x * FX_ONE + (FX_ONE >> 1), c.y * FX_ONE + (FX_ONE >> 1));
    s.run(10);
    expect(s.world.crates!.list.length).toBe(0);
    if (c.kind === CRATE.credits) expect(s.world.players[0]!.credits - before).toBe(CRATE_CREDITS);
    if (c.kind === CRATE.veteran) expect(s.world.entities.rank[u & 0xffff]).toBe(1);
  });

  it('are the same in every run with the same seed', () => {
    const a = make(true);
    const b = make(true);
    a.run(3000);
    b.run(3000);
    expect(a.hash()).toBe(b.hash());
    expect(a.world.crates!.list).toEqual(b.world.crates!.list);
  });

  it('change nothing when off', () => {
    const a = new Sim({ rules, seed: 11, width: 48, height: 48, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false });
    const b = make(false);
    a.run(1000);
    b.run(1000);
    expect(a.hash()).toBe(b.hash());
  });

  it('the new kinds: a look at the whole map, a burst of speed, a free harvester', () => {
    const open = (kind: number) => {
      const s = make(true);
      s.world.crates!.list.push({ x: 20, y: 20, kind });
      const u = spawnUnit(s.world, grunt, 0, 20 * FX_ONE + (FX_ONE >> 1), 20 * FX_ONE + (FX_ONE >> 1));
      s.run(10);
      expect(s.world.crates!.list.length).toBe(0);
      return { s, u: u & 0xffff };
    };
    const reveal = open(CRATE.reveal).s;
    reveal.run(20);
    expect(reveal.world.fog[0]![47 * 48 + 47]! & FOG_VISIBLE).toBe(FOG_VISIBLE);
    expect(reveal.world.fog[1]![47 * 48 + 47]! & FOG_VISIBLE).toBe(0);
    const haste = open(CRATE.haste);
    expect(haste.s.world.entities.hasteUntil[haste.u]).toBeGreaterThan(haste.s.world.tick);
    const harvester = open(CRATE.harvester).s;
    const e = harvester.world.entities;
    let n = 0;
    for (let k = 0; k < e.high; k++) if (e.alive[k] === 1 && e.owner[k] === 0 && e.type[k] === rules.factions[0]!.harvester && e.kind[k] === 1) n++;
    expect(n).toBe(1);
  });

  it('a revealed map shows everyone everything', () => {
    const s = new Sim({ rules, seed: 11, width: 48, height: 48, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false, revealed: true });
    s.run(20);
    expect(s.world.fog[1]![5 * 48 + 40]! & FOG_VISIBLE).toBe(FOG_VISIBLE);
  });
});
