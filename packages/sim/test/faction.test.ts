import { describe, expect, it } from 'vitest';
import { FX_ONE } from '../src/fx';
import { KIND } from '../src/entities';
import { Sim } from '../src/sim';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { cooldownFor, inCoverage } from '../src/systems/faction';
import { damage } from '../src/systems/combat';
import { inWeaponRange, isDugIn } from '../src/query';
import { CREDIT_REASON, FX_EVENT, FX_STRIDE } from '../src/world';
import { at, rules, structure, unit } from './helpers';

const HOLDOUT = 0;
const HALCYON = 1;
const CHOIR = 2;
const upgrade = (id: string) => rules.upgradeIndex.get(id)!;

function sim(a: number, b: number, size = 40): Sim {
  return new Sim({
    rules,
    seed: 3,
    width: size,
    height: size,
    players: [
      { faction: a, team: 0 },
      { faction: b, team: 1 },
    ],
    victoryRules: false,
  });
}

const cmd = (s: Sim, player: number, c: Parameters<Sim['schedule']>[0]['cmd']) => s.schedule({ tick: s.tick, player, cmd: c });
const slot = (h: number) => h & 0xffff;

describe('Halcyon network coverage', () => {
  it('covers tiles around its structures and only those', () => {
    const s = sim(HALCYON, HOLDOUT);
    spawnStructure(s.world, structure('relay'), 0, 10, 10);
    const near = slot(spawnUnit(s.world, unit('sentry'), 0, at(12), at(10)));
    const far = slot(spawnUnit(s.world, unit('sentry'), 0, at(30), at(30)));
    s.run(1);
    expect(inCoverage(s.world, near)).toBe(true);
    expect(inCoverage(s.world, far)).toBe(false);
  });

  it('units inside coverage fire faster and slowly self-repair', () => {
    const fireTimes = (covered: boolean) => {
      const s = sim(HALCYON, HOLDOUT);
      if (covered) spawnStructure(s.world, structure('relay'), 0, 10, 12);
      const shooter = slot(spawnUnit(s.world, unit('vector'), 0, at(10), at(10)));
      const target = slot(spawnUnit(s.world, unit('ironclad'), 1, at(13), at(10)));
      s.world.entities.stance[target] = 3; // hold fire
      s.world.entities.hp[shooter] = 300;
      const hp0 = s.world.entities.hp[target]!;
      s.run(400);
      return { dealt: hp0 - s.world.entities.hp[target]!, healed: s.world.entities.hp[shooter]! > 300 };
    };
    const inside = fireTimes(true);
    const outside = fireTimes(false);
    expect(inside.dealt).toBeGreaterThan(outside.dealt * 1.06);
    expect(inside.healed).toBe(true);
    expect(outside.healed).toBe(false);
  });

  it('Recompile refunds 25% of a unit lost inside coverage', () => {
    const s = sim(HALCYON, HOLDOUT);
    spawnStructure(s.world, structure('relay'), 0, 10, 10);
    const u = slot(spawnUnit(s.world, unit('vector'), 0, at(11), at(11)));
    s.run(1);
    const before = s.world.players[0]!.credits;
    s.world.entities.hp[u] = 0;
    s.run(1);
    expect(s.world.players[0]!.credits - before).toBe((rules.units[unit('vector')]!.cost * 25) / 100);
    // ...and tells the client, so it can show "+$250" where the unit fell.
    const fx = s.world.fx;
    let shown = -1;
    for (let i = 0; i < fx.length; i += FX_STRIDE) if (fx[i] === FX_EVENT.credits && fx[i + 2] === CREDIT_REASON.recompile) shown = fx[i + 1]!;
    expect(shown).toBe((rules.units[unit('vector')]!.cost * 25) / 100);
  });
});

describe('support powers', () => {
  it('Jam needs the scan building, slows enemy fire in the area, skips air-gapped Holdout, and has a cooldown', () => {
    const s = sim(HALCYON, CHOIR);
    const w = s.world;
    const e = w.entities;
    const grace = slot(spawnUnit(w, unit('grace'), 1, at(20), at(20)));
    cmd(s, 0, { type: 'power', x: at(20), y: at(20) });
    s.run(1);
    expect(e.jammedUntil[grace]).toBe(0); // no scan yet
    spawnStructure(w, structure('kernel'), 0, 2, 2);
    spawnStructure(w, structure('powerd'), 0, 6, 2);
    spawnStructure(w, structure('scan'), 0, 2, 6);
    s.run(1);
    cmd(s, 0, { type: 'power', x: at(20), y: at(20) });
    s.run(1);
    expect(e.jammedUntil[grace]).toBeGreaterThan(w.tick);
    expect(cooldownFor(w, grace, 80)).toBe(100); // 20% slower
    const ready = w.players[0]!.powerReady;
    expect(ready).toBeGreaterThan(w.tick);
    // Air-gapped: Holdout units are not jammed.
    const s2 = sim(HALCYON, HOLDOUT);
    spawnStructure(s2.world, structure('kernel'), 0, 2, 2);
    spawnStructure(s2.world, structure('powerd'), 0, 6, 2);
    spawnStructure(s2.world, structure('scan'), 0, 2, 6);
    const grunt = slot(spawnUnit(s2.world, unit('grunt'), 1, at(20), at(20)));
    s2.run(1);
    cmd(s2, 0, { type: 'power', x: at(20), y: at(20) });
    s2.run(1);
    expect(s2.world.entities.jammedUntil[grunt]).toBe(0);
  });

  it('Uplink: a fork projects coverage around itself for a while', () => {
    const s = sim(HALCYON, HOLDOUT);
    const h = spawnUnit(s.world, unit('fork'), 0, at(25), at(25));
    const v = slot(h);
    s.run(10);
    expect(inCoverage(s.world, v)).toBe(false);
    cmd(s, 0, { type: 'ability', units: [h] });
    s.run(10);
    expect(inCoverage(s.world, v)).toBe(true);
    s.run(20 * 16);
    expect(inCoverage(s.world, v)).toBe(false);
  });
});

describe('active abilities', () => {
  it('Dig In: sets up, then takes 30% less damage and shoots 1 tile farther; any order packs up', () => {
    const s = sim(HOLDOUT, HALCYON);
    const h = spawnUnit(s.world, unit('grunt'), 0, at(5), at(5));
    const g = slot(h);
    const e = s.world.entities;
    const grunt = rules.units[unit('grunt')]!;
    cmd(s, 0, { type: 'ability', units: [h] });
    s.run(1);
    expect(e.dugInAt[g]).toBeGreaterThan(0);
    // Setting up: no bonus yet.
    const target = slot(spawnUnit(s.world, unit('sentry'), 1, at(5) + grunt.weapon!.range + FX_ONE - 100, at(5)));
    expect(inWeaponRange(s.world, g, grunt.weapon!, target)).toBe(false);
    s.run(40);
    expect(isDugIn(s.world, g)).toBe(true);
    expect(inWeaponRange(s.world, g, grunt.weapon!, target)).toBe(true);
    const hp = e.hp[g]!;
    damage(s.world, g, 100, 0, -1);
    expect(hp - e.hp[g]!).toBe(70);
    cmd(s, 0, { type: 'move', units: [h], x: at(10), y: at(5) });
    s.run(1);
    expect(e.dugInAt[g]).toBe(0);
  });


  it('Grace blinks up to its range toward a point, then waits for the cooldown', () => {
    const s = sim(CHOIR, HOLDOUT);
    const h = spawnUnit(s.world, unit('grace'), 0, at(5), at(5));
    const g = slot(h);
    cmd(s, 0, { type: 'ability', units: [h], x: at(30), y: at(5) });
    s.run(1);
    expect(s.world.entities.x[g]! - at(5)).toBeGreaterThanOrEqual(3 * FX_ONE);
    expect(s.world.entities.x[g]! - at(5)).toBeLessThanOrEqual(5 * FX_ONE);
    const x1 = s.world.entities.x[g]!;
    cmd(s, 0, { type: 'ability', units: [h], x: at(30), y: at(5) });
    s.run(1);
    expect(s.world.entities.x[g]).toBe(x1);
  });

  it('a phased Basso cannot be hurt and cannot shoot', () => {
    const s = sim(CHOIR, HOLDOUT);
    const h = spawnUnit(s.world, unit('basso'), 0, at(10), at(10));
    const b = slot(h);
    spawnUnit(s.world, unit('bulldog'), 1, at(13), at(10));
    cmd(s, 0, { type: 'ability', units: [h] });
    s.run(1);
    const e = s.world.entities;
    const hp = e.hp[b]! + e.shields[b]!;
    s.run(40); // phase lasts 3 s = 60 ticks
    expect(e.hp[b]! + e.shields[b]!).toBe(hp);
    s.run(200);
    expect(e.hp[b]! + e.shields[b]!).toBeLessThan(hp);
  });

  it('root overrides an enemy vehicle for a while; Choir resists and air-gapped Holdout holds it half as long', () => {
    const tryOverride = (victimFaction: number, victimUnit: string) => {
      const s = sim(HALCYON, victimFaction);
      const r = spawnUnit(s.world, unit('root'), 0, at(10), at(10));
      const v = spawnUnit(s.world, unit(victimUnit), 1, at(14), at(10));
      s.world.entities.stance[slot(v)] = 3; // hold fire, keep the test about ownership
      s.world.entities.stance[slot(r)] = 3;
      cmd(s, 0, { type: 'ability', units: [r], target: v });
      s.run(1);
      const owned = s.world.entities.owner[slot(v)];
      let ticks = 0;
      while (s.world.entities.owner[slot(v)] === 0 && ticks < 2000) {
        s.run(1);
        ticks++;
      }
      return { owned, ticks };
    };
    const halcyon = tryOverride(HALCYON, 'vector');
    expect(halcyon.owned).toBe(0);
    expect(halcyon.ticks).toBeGreaterThan(200);
    const choir = tryOverride(CHOIR, 'basso');
    expect(choir.owned).toBe(0);
    expect(choir.ticks).toBeLessThan(halcyon.ticks * 0.6);
    const holdout = tryOverride(HOLDOUT, 'bulldog');
    expect(holdout.owned).toBe(0);
    expect(holdout.ticks).toBeLessThan(halcyon.ticks * 0.6);
  });
});

describe('weapon specials', () => {
  it('broadcast shots chain to nearby enemies', () => {
    const s = sim(HALCYON, HOLDOUT);
    spawnUnit(s.world, unit('broadcast'), 0, at(5), at(10));
    const first = slot(spawnUnit(s.world, unit('grunt'), 1, at(10), at(10)));
    const second = slot(spawnUnit(s.world, unit('grunt'), 1, at(11), at(11)));
    for (const g of [first, second]) s.world.entities.stance[g] = 3;
    const hp = s.world.entities.hp[second]!;
    s.run(200);
    expect(s.world.entities.alive[second] === 0 || s.world.entities.hp[second]! < hp).toBe(true);
  });

  it('the Requiem beam hurts enemies along its line', () => {
    const s = sim(CHOIR, HOLDOUT);
    spawnUnit(s.world, unit('requiem'), 0, at(5), at(10));
    const target = slot(spawnUnit(s.world, unit('bulldog'), 1, at(10), at(10)));
    const inLine = slot(spawnUnit(s.world, unit('bulldog'), 1, at(8), at(10)));
    s.world.entities.stance[target] = 3;
    s.world.entities.stance[inLine] = 3;
    const hp = s.world.entities.hp[inLine]!;
    s.run(100);
    expect(s.world.entities.hp[inLine]!).toBeLessThan(hp);
  });
});

describe('Choir sustain', () => {
  it('Cantors restore shields of nearby units even under fire', () => {
    const s = sim(CHOIR, HOLDOUT);
    const b = slot(spawnUnit(s.world, unit('basso'), 0, at(10), at(10)));
    spawnUnit(s.world, unit('cantor'), 0, at(11), at(10));
    const e = s.world.entities;
    e.shields[b] = 0;
    e.lastHitTick[b] = 0;
    s.run(41);
    expect(e.shields[b]).toBeGreaterThan(0);
  });
});

describe('research', () => {
  function withTech(faction: number): Sim {
    const s = sim(faction, HOLDOUT);
    const yard = rules.factions[faction]!.structures.map((i) => rules.structures[i]!);
    const pick = (role: string) => yard.find((r) => r.role === role)!.index;
    spawnStructure(s.world, pick('conyard'), 0, 2, 2);
    spawnStructure(s.world, pick('power'), 0, 6, 2);
    spawnStructure(s.world, pick('power'), 0, 9, 2);
    spawnStructure(s.world, pick('tech'), 0, 2, 7);
    s.world.players[0]!.credits = 20000;
    return s;
  }

  it('researching Armor I raises HP of existing and new units, and costs money over time', () => {
    const s = withTech(HOLDOUT);
    const g = slot(spawnUnit(s.world, unit('grunt'), 0, at(20), at(20)));
    const base = rules.units[unit('grunt')]!.hp;
    cmd(s, 0, { type: 'research', upgrade: upgrade('armor_1') });
    s.run(10);
    expect(s.world.players[0]!.research.item).toBe(upgrade('armor_1'));
    expect(s.world.players[0]!.credits).toBeLessThan(20000);
    s.run(rules.upgrades[upgrade('armor_1')]!.researchTicks + 5);
    expect(s.world.players[0]!.upgrades[upgrade('armor_1')]).toBe(1);
    expect(s.world.entities.maxHp[g]).toBe(base + base / 10);
    const n = slot(spawnUnit(s.world, unit('grunt'), 0, at(21), at(20)));
    expect(s.world.entities.maxHp[n]).toBe(base + base / 10);
  });

  it('Weapons II needs Weapons I, and faction upgrades need the right faction', () => {
    const s = withTech(HOLDOUT);
    cmd(s, 0, { type: 'research', upgrade: upgrade('weapons_2') });
    s.run(1);
    expect(s.world.players[0]!.research.item).toBe(-1);
    cmd(s, 0, { type: 'research', upgrade: upgrade('extended_relays') });
    s.run(1);
    expect(s.world.players[0]!.research.item).toBe(-1);
    cmd(s, 0, { type: 'research', upgrade: upgrade('salvage_crews') });
    s.run(1);
    expect(s.world.players[0]!.research.item).toBe(upgrade('salvage_crews'));
  });

  it('cancelling research refunds what was spent', () => {
    const s = withTech(HOLDOUT);
    cmd(s, 0, { type: 'research', upgrade: upgrade('weapons_1') });
    s.run(100);
    cmd(s, 0, { type: 'cancelResearch' });
    s.run(1);
    expect(s.world.players[0]!.credits).toBe(20000);
    expect(s.world.players[0]!.research.item).toBe(-1);
  });

  it('structures stay structures (sanity)', () => {
    const s = withTech(CHOIR);
    let n = 0;
    for (let i = 0; i < s.world.entities.high; i++) if (s.world.entities.kind[i] === KIND.structure) n++;
    expect(n).toBe(4);
  });
});
