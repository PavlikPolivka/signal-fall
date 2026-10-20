import { describe, expect, it } from 'vitest';
import { FX_ONE } from '../src/fx';
import { STANCE } from '../src/entities';
import { battle } from '../src/scenarios';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { damage } from '../src/systems/combat';
import { at, makeSim, rules, structure, unit } from './helpers';

const fight = (a: [string, number][], b: [string, number][]) => battle(rules, { units: a }, { units: b });

describe('damage matrix scenarios', () => {
  it('2 Bulldogs beat 10 Grunts (tanks beat infantry)', () => {
    expect(fight([['grunt', 10]], [['bulldog', 2]]).winner).toBe(1);
  });
  it('4 Tankbusters beat 2 Bulldogs (explosive: AT infantry beats tanks)', () => {
    expect(fight([['tankbuster', 4]], [['bulldog', 2]]).winner).toBe(0);
  });
  it('6 Grunts beat 3 Tankbusters (kinetic: anti-infantry beats infantry)', () => {
    expect(fight([['grunt', 6]], [['tankbuster', 3]]).winner).toBe(0);
  });
  it('2 Flak Tracks beat 2 Hornets (flak: AA beats air)', () => {
    expect(fight([['flak_track', 2]], [['hornet', 2]]).winner).toBe(0);
  });
  it('2 Hornets beat 6 Grunts (air beats slow ground)', () => {
    expect(fight([['hornet', 2]], [['grunt', 6]]).winner).toBe(0);
  });
  it('2 Bulldogs beat 4 Jackrabbits (tanks beat light vehicles)', () => {
    expect(fight([['bulldog', 2]], [['jackrabbit', 4]]).winner).toBe(0);
  });
  it('2 vectors beat 4 Jackrabbits (energy shreds medium armor)', () => {
    expect(battle(rules, { units: [['jackrabbit', 4]] }, { units: [['vector', 2]] }, { factionB: 1 }).winner).toBe(1);
  });
  it('2 Thumpers destroy a Pillbox without losses (siege beats static defenses)', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const pill = spawnStructure(w, structure('pillbox'), 1, 30, 20);
    const t = [spawnUnit(w, unit('thumper'), 0, at(10), at(19)), spawnUnit(w, unit('thumper'), 0, at(10), at(21))];
    // A spotter just outside the pillbox's range reveals it (thumper range 10 > sight 6).
    const spotter = spawnUnit(w, unit('jackrabbit'), 0, at(23), at(20));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'hold', units: [spotter] } });
    sim.run(4);
    sim.schedule({ tick: sim.tick, player: 0, cmd: { type: 'attack', units: t, target: pill } });
    sim.run(20 * 60);
    expect(w.entities.resolve(pill)).toBe(-1);
    expect(t.every((h) => w.entities.resolve(h) >= 0)).toBe(true);
  });
  it('explosive weapons cannot hurt air units', () => {
    const sim = makeSim();
    const w = sim.world;
    const h = spawnUnit(w, unit('hornet'), 1, at(5), at(5));
    damage(w, h & 0xffff, 1000, 1, -1);
    expect(w.entities.hp[h & 0xffff]).toBe(rules.units[unit('hornet')]!.hp);
  });
});

describe('veterancy', () => {
  it('kills promote and raise max HP', () => {
    const sim = makeSim();
    const w = sim.world;
    const e = w.entities;
    const killer = spawnUnit(w, unit('bulldog'), 0, at(10), at(10)) & 0xffff;
    // Bulldog costs 900; thresholds are 100/250/500% of own cost.
    for (let i = 0; i < 9; i++) {
      const victim = spawnUnit(w, unit('grunt'), 1, at(20), at(5 + i)) & 0xffff;
      damage(w, victim, 10_000, 0, e.handle(killer));
    }
    sim.step();
    expect(e.rank[killer]).toBe(1);
    expect(e.maxHp[killer]).toBe(880);
  });
});

describe('shields', () => {
  it('absorb damage first and regenerate out of combat', () => {
    const sim = makeSim();
    const w = sim.world;
    const e = w.entities;
    const s = spawnUnit(w, unit('basso'), 1, at(10), at(10)) & 0xffff;
    damage(w, s, 300, 1, -1); // explosive vs heavy = 100%
    expect(e.shields[s]).toBe(100);
    expect(e.hp[s]).toBe(400);
    damage(w, s, 300, 1, -1);
    expect(e.shields[s]).toBe(0);
    expect(e.hp[s]).toBe(200);
    sim.run(20 * 10);
    expect(e.shields[s]).toBeGreaterThan(0);
    expect(e.hp[s]).toBe(200);
  });
});

describe('stances and fog', () => {
  it('hold position never moves but still fires', () => {
    const sim = makeSim();
    const w = sim.world;
    const e = w.entities;
    const g = spawnUnit(w, unit('grunt'), 0, at(10), at(10));
    const s = g & 0xffff;
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'hold', units: [g] } });
    // Staccato is no faster than a Grunt, so it can't kite out of range.
    const enemy = spawnUnit(w, unit('staccato'), 1, at(13), at(10)) & 0xffff;
    const far = spawnUnit(w, unit('staccato'), 1, at(17), at(10)) & 0xffff;
    e.stance[far] = STANCE.holdFire;
    sim.run(100);
    expect(e.x[s]).toBe(at(10));
    expect(e.alive[enemy] === 0 || e.hp[enemy]! < 60).toBe(true);
    expect(e.hp[far]).toBe(60);
  });

  it('units do not target what their owner cannot see', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    // Thumper range 10 > sight 6: an enemy at distance 8 is in range but in fog.
    const t = spawnUnit(w, unit('thumper'), 0, at(10), at(10)) & 0xffff;
    const v = spawnUnit(w, unit('basso'), 1, at(18), at(10)) & 0xffff;
    sim.run(60);
    expect(e.hp[v]).toBe(rules.units[unit('basso')]!.hp);
    // A spotter reveals it.
    spawnUnit(w, unit('jackrabbit'), 0, at(15), at(12));
    sim.run(100);
    expect(e.shields[v]! + e.hp[v]!).toBeLessThan(800);
    expect(e.alive[t]).toBe(1);
  });

  it('idle units chase within a leash and return', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const g = spawnUnit(w, unit('bulldog'), 0, at(10), at(10)) & 0xffff;
    const target = spawnUnit(w, unit('glissando'), 1, at(16), at(10)) & 0xffff;
    sim.run(10);
    expect(e.target[g]).toBe(e.handle(target));
    // Move the bait far away: the tank must not follow beyond the leash.
    e.x[target] = at(40);
    sim.run(200);
    expect(Math.abs(e.x[g]! - at(10))).toBeLessThanOrEqual(FX_ONE + (FX_ONE >> 1));
  });
});

describe('attack orders', () => {
  it('keep fighting toward the target position after it dies, instead of stopping', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const target = spawnUnit(w, unit('grace'), 1, at(30), at(10));
    const guardian = spawnUnit(w, unit('grace'), 1, at(34), at(14)) & 0xffff;
    const army = [spawnUnit(w, unit('bulldog'), 0, at(6), at(10)), spawnUnit(w, unit('grunt'), 0, at(6), at(12))];
    // Reveal the target so the order is legal.
    spawnUnit(w, unit('jackrabbit'), 0, at(26), at(10));
    sim.run(4);
    sim.schedule({ tick: sim.tick, player: 0, cmd: { type: 'attack', units: army, target } });
    e.hp[target & 0xffff] = 1; // dies to the first hit
    sim.run(20 * 30);
    expect(e.resolve(target)).toBe(-1);
    // The army pushed on and engaged the second enemy near the target's position.
    expect(e.alive[guardian] === 0 || e.hp[guardian]! + e.shields[guardian]! < 100).toBe(true);
  });

  it('idle units shoot back at attackers beyond their acquire radius', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const tank = spawnUnit(w, unit('bulldog'), 0, at(10), at(10)) & 0xffff;
    const arty = spawnUnit(w, unit('crescendo'), 1, at(19), at(10)) & 0xffff;
    // Enemy artillery can see the tank via a spotter.
    spawnUnit(w, unit('glissando'), 1, at(14), at(14));
    sim.schedule({ tick: 0, player: 1, cmd: { type: 'attack', units: [w.entities.handle(arty)], target: w.entities.handle(tank) } });
    sim.run(20 * 10);
    expect(e.hp[arty]! + e.shields[arty]!).toBeLessThan(240);
  });
});

describe('match statistics', () => {
  it('count losses for the owner and kills for whoever hit last', async () => {
    const { defaultRules } = await import('@signal-fall/data');
    const { Sim } = await import('../src/sim');
    const { spawnUnit } = await import('../src/spawn');
    const rules = defaultRules();
    const sim = new Sim({ rules, seed: 1, width: 32, height: 32, players: [{ faction: 0, team: 0 }, { faction: 0, team: 1 }], victoryRules: false });
    const tank = rules.unitIndex.get('bulldog')!;
    const grunt = rules.unitIndex.get('grunt')!;
    spawnUnit(sim.world, tank, 0, 10 * 1024, 10 * 1024);
    spawnUnit(sim.world, grunt, 1, 13 * 1024, 10 * 1024);
    sim.run(400);
    const [a, b] = sim.world.players;
    expect(b!.stats.unitsLost).toBe(1);
    expect(b!.stats.valueLost).toBe(rules.units[grunt]!.cost);
    expect(a!.stats.unitsKilled).toBe(1);
    expect(a!.stats.valueKilled).toBe(rules.units[grunt]!.cost);
    expect(a!.stats.unitsLost).toBe(0);
  });
});

describe('attack ground', () => {
  it('artillery ordered onto a spot walks into range and shells it, hurting what stands there', () => {
    const sim = makeSim({ size: 40 });
    const e = sim.world.entities;
    const gun = spawnUnit(sim.world, unit('thumper'), 0, at(5), at(20));
    const victim = spawnUnit(sim.world, unit('grunt'), 1, at(30), at(20));
    const hp = e.hp[victim & 0xffff]!;
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'attackGround', units: [gun], x: at(30), y: at(20) } });
    sim.run(20 * 40);
    expect(e.alive[victim & 0xffff] !== 1 || e.hp[victim & 0xffff]! < hp).toBe(true);
    expect(e.orders[gun & 0xffff]![0]?.type).toBe('attackGround');
  });

  it('units without a splash weapon ignore the order', () => {
    const sim = makeSim();
    const e = sim.world.entities;
    const g = spawnUnit(sim.world, unit('grunt'), 0, at(5), at(5));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'attackGround', units: [g], x: at(20), y: at(20) } });
    sim.run(2);
    expect(e.orders[g & 0xffff]).toHaveLength(0);
  });
});
