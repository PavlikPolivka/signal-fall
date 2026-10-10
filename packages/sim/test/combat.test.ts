import { describe, expect, it } from 'vitest';
import { FX_ONE } from '../src/fx';
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
    const enemy = spawnUnit(w, unit('grace'), 1, at(13), at(10)) & 0xffff;
    const far = spawnUnit(w, unit('grace'), 1, at(17), at(10)) & 0xffff;
    sim.run(100);
    expect(e.x[s]).toBe(at(10));
    expect(e.alive[enemy] === 0 || e.hp[enemy]! < 50).toBe(true);
    expect(e.hp[far]).toBe(50);
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
