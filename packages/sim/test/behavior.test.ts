import { describe, expect, it } from 'vitest';
import { FX_ONE, ilength } from '../src/fx';
import { HARVEST, STANCE } from '../src/entities';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { at, makeSim, rules, structure, unit } from './helpers';

const slotOf = (h: number) => h & 0xffff;

describe('group movement', () => {
  it('a mixed group moves together and arrives as a formation', () => {
    const sim = makeSim({ size: 64 });
    const w = sim.world;
    const e = w.entities;
    const ids = ['jackrabbit', 'jackrabbit', 'bulldog', 'bulldog', 'grunt', 'grunt', 'grunt', 'thumper', 'flak_track'];
    const hs = ids.map((id, i) => spawnUnit(w, unit(id), 0, at(6 + (i % 3)), at(30 + Math.trunc(i / 3))));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: hs, x: at(50), y: at(31) } });
    // Halfway there the fast jackrabbits haven't run ahead.
    sim.run(20 * 10);
    const xs = hs.map((h) => e.x[slotOf(h)]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(6 * FX_ONE);
    sim.run(20 * 25);
    for (const h of hs) expect(e.orders[slotOf(h)]).toHaveLength(0);
    // Heavies in front (toward +x), artillery at the back.
    const x = (id: string) => hs.filter((_, i) => ids[i] === id).map((h) => e.x[slotOf(h)]!);
    expect(Math.min(...x('bulldog'))).toBeGreaterThan(Math.max(...x('thumper')));
    // Tidy arrival: no two units overlap.
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++) {
        const a = slotOf(hs[i]!);
        const b = slotOf(hs[j]!);
        expect(ilength(e.x[a]! - e.x[b]!, e.y[a]! - e.y[b]!)).toBeGreaterThan(FX_ONE >> 1);
      }
  });
});

describe('target priority', () => {
  it('prefers threats over harmless units and walls', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const e = w.entities;
    const g = slotOf(spawnUnit(w, unit('grunt'), 0, at(10), at(10)));
    spawnStructure(w, structure('fermata'), 1, 12, 10);
    spawnUnit(w, unit('refrain'), 1, at(10), at(13));
    const threat = spawnUnit(w, unit('grace'), 1, at(13), at(11));
    sim.run(20);
    expect(e.target[g]).toBe(threat);
  });

  it('anti-armor picks the tank, anti-infantry picks the infantry', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const e = w.entities;
    const tb = slotOf(spawnUnit(w, unit('tankbuster'), 0, at(10), at(10)));
    const gr = slotOf(spawnUnit(w, unit('grunt'), 0, at(10), at(12)));
    const tank = spawnUnit(w, unit('basso'), 1, at(14), at(11));
    const inf = spawnUnit(w, unit('grace'), 1, at(13), at(11));
    sim.run(20);
    expect(e.target[tb]).toBe(tank);
    expect(e.target[gr]).toBe(inf);
  });

  it('avoids overkill: shots already in flight free other shooters for new targets', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const e = w.entities;
    const shooters = [0, 1, 2, 3].map((i) => slotOf(spawnUnit(w, unit('thumper'), 0, at(6), at(8 + i))));
    const weak = slotOf(spawnUnit(w, unit('grace'), 1, at(15), at(10)));
    e.hp[weak] = 5;
    e.shields[weak] = 0;
    spawnUnit(w, unit('grace'), 1, at(15), at(14));
    spawnUnit(w, unit('jackrabbit'), 0, at(12), at(11)); // spotter
    // Count how many shells are ever in flight at the nearly dead unit at once.
    let maxAtWeak = 0;
    for (let t = 0; t < 60; t++) {
      sim.step();
      const n = w.projectiles.filter((p) => e.resolve(p.target) === weak).length;
      maxAtWeak = Math.max(maxAtWeak, n);
    }
    expect(maxAtWeak).toBe(1);
    void shooters;
  });
});

describe('attack-move', () => {
  it('clears the area around the destination before stopping', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const tanks = [spawnUnit(w, unit('bulldog'), 0, at(5), at(20)), spawnUnit(w, unit('bulldog'), 0, at(5), at(22))];
    // Enemies off to the side of the destination, out of the path.
    const a = slotOf(spawnUnit(w, unit('grace'), 1, at(30), at(26)));
    const b = slotOf(spawnUnit(w, unit('grace'), 1, at(32), at(15)));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'attackMove', units: tanks, x: at(30), y: at(21) } });
    sim.run(20 * 45);
    expect(e.alive[a] === 0 || e.hp[a]! <= 0).toBe(true);
    expect(e.alive[b] === 0 || e.hp[b]! <= 0).toBe(true);
  });
});

describe('stances', () => {
  it('hold fire never shoots on its own', () => {
    const sim = makeSim();
    const w = sim.world;
    const e = w.entities;
    const g = spawnUnit(w, unit('grunt'), 0, at(10), at(10));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'stance', units: [g], stance: STANCE.holdFire } });
    const enemy = slotOf(spawnUnit(w, unit('glissando'), 1, at(12), at(10)));
    sim.run(100);
    expect(e.hp[enemy]! + e.shields[enemy]!).toBe(240);
  });

  it('aggressive chases beyond the guard leash', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const t = spawnUnit(w, unit('bulldog'), 0, at(10), at(10));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'stance', units: [t], stance: STANCE.aggressive } });
    const bait = slotOf(spawnUnit(w, unit('glissando'), 1, at(15), at(10)));
    e.hp[bait] = 100_000; // survives the chase
    e.stance[bait] = STANCE.holdFire; // doesn't fight back or close in
    sim.run(10);
    // The bait backs off slowly, staying in sight.
    for (let i = 0; i < 300; i++) {
      e.x[bait] = Math.min(at(40), e.x[bait]! + 60);
      e.anchorX[bait] = e.x[bait]!; // its own post moves with it, so it doesn't walk back
      sim.step();
    }
    // A guard-area unit would stop at its leash (~11 tiles from x=10); aggressive keeps going.
    expect(e.x[slotOf(t)]! >> 10).toBeGreaterThan(24);
  });
});

describe('micro', () => {
  it('artillery backs away from enemies inside its minimum range', () => {
    const sim = makeSim({ size: 40 });
    const w = sim.world;
    const e = w.entities;
    const art = slotOf(spawnUnit(w, unit('thumper'), 0, at(20), at(20)));
    spawnUnit(w, unit('grace'), 1, at(21), at(20));
    sim.run(40);
    expect(e.x[art]!).toBeLessThan(at(19));
  });

  it('a faster, longer-ranged unit kites a slower attacker', () => {
    const sim = makeSim({ size: 48 });
    const w = sim.world;
    const e = w.entities;
    const v = slotOf(spawnUnit(w, unit('vector'), 0, at(20), at(20)));
    const g = spawnUnit(w, unit('grunt'), 1, at(24), at(20));
    sim.schedule({ tick: 0, player: 1, cmd: { type: 'attack', units: [g], target: e.handle(v) } });
    let minX = e.x[v]!;
    for (let t = 0; t < 20 * 4; t++) {
      sim.step();
      minX = Math.min(minX, e.x[v]!);
    }
    // It gave ground between shots instead of standing still (and returns to its post after).
    expect(minX).toBeLessThan(at(18));
  });
});

describe('harvesters', () => {
  it('flee when shot at and go back to work later', () => {
    const sim = makeSim({ size: 40, victoryRules: false });
    const w = sim.world;
    const e = w.entities;
    spawnStructure(w, structure('dynamo'), 0, 2, 2);
    spawnStructure(w, structure('smelter'), 0, 6, 2);
    for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) w.map.echo[y * 40 + x] = 12;
    const mule = slotOf(spawnUnit(w, unit('mule'), 0, at(15), at(15)));
    e.hstate[mule] = HARVEST.toField;
    sim.run(40);
    e.lastHitTick[mule] = w.tick;
    sim.run(2);
    expect([HARVEST.toRefinery, HARVEST.hiding]).toContain(e.hstate[mule]);
    sim.run(20 * 20);
    expect([HARVEST.toField, HARVEST.harvesting, HARVEST.toRefinery, HARVEST.unloading]).toContain(e.hstate[mule]);
  });
});

void rules;
