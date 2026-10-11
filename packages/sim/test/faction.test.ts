import { describe, expect, it } from 'vitest';
import { FX_ONE } from '../src/fx';
import { KIND } from '../src/entities';
import { Sim } from '../src/sim';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { inCoverage } from '../src/systems/faction';
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

  it('units inside coverage fire 15% faster and slowly self-repair', () => {
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
    expect(inside.dealt).toBeGreaterThan(outside.dealt * 1.1);
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
  });
});

describe('active abilities', () => {
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

  it('root overrides an enemy vehicle for a while; Holdout is air-gapped and Choir resists', () => {
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
    expect(tryOverride(HOLDOUT, 'bulldog').owned).toBe(1);
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
