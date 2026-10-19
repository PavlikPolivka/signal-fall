import { describe, expect, it } from 'vitest';
import { FX_ONE, ilength } from '../src/fx';
import { TERRAIN, createMap, passable } from '../src/map';
import { Pathfinder, UNREACHABLE } from '../src/path';
import { spawnStructure, spawnUnit } from '../src/spawn';
import { at, makeSim, structure, unit } from './helpers';

/** 32x32 map with a vertical rock wall at x=16 from y=0..27 (gap at the bottom). */
function wallTerrain(size = 32): Uint8Array {
  const t = new Uint8Array(size * size);
  for (let y = 0; y < 28; y++) t[y * size + 16] = TERRAIN.rock;
  return t;
}

describe('pathfinding', () => {
  it('A* routes around a wall through the gap', () => {
    const map = createMap(32, 32, wallTerrain());
    const pf = new Pathfinder(map);
    const path = pf.findPath(5 * 32 + 5, 5 * 32 + 27)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toBe(5 * 32 + 27);
    // Some waypoint must be below the wall's end.
    expect(Array.from(path).some((t) => Math.trunc(t / 32) >= 28)).toBe(true);
    for (const t of path) expect(map.nav[t]).toBe(1);
  });

  it('unreachable goals lead to the closest reachable tile', () => {
    const size = 32;
    const t = new Uint8Array(size * size);
    // Box in tile (25,25).
    for (let y = 23; y <= 27; y++) for (let x = 23; x <= 27; x++) if (x === 23 || x === 27 || y === 23 || y === 27) t[y * size + x] = TERRAIN.water;
    const map = createMap(size, size, t);
    const pf = new Pathfinder(map);
    const path = pf.findPath(2 * size + 2, 25 * size + 25)!;
    const end = path[path.length - 1]!;
    expect(Math.abs((end % size) - 25)).toBeLessThanOrEqual(3);
    expect(Math.abs(Math.trunc(end / size) - 25)).toBeLessThanOrEqual(3);
  });

  it('flow field matches walkable distances and never cuts corners', () => {
    const map = createMap(32, 32, wallTerrain());
    const pf = new Pathfinder(map);
    const goal = 5 * 32 + 27;
    const dist = pf.flowField(goal);
    expect(dist[goal]).toBe(0);
    expect(dist[16]).toBe(UNREACHABLE); // rock tile
    // Following the field from the far side reaches the goal.
    let tile = 5 * 32 + 5;
    for (let i = 0; i < 200 && tile !== goal; i++) tile = pf.flowStep(dist, tile);
    expect(tile).toBe(goal);
    // Cached until nav changes.
    expect(pf.flowField(goal)).toBe(dist);
  });

  it('structures block the nav grid and bump navVersion', () => {
    const sim = makeSim();
    const m = sim.world.map;
    const v = m.navVersion;
    spawnStructure(sim.world, structure('dynamo'), 0, 10, 10);
    expect(passable(m, 10, 10)).toBe(false);
    expect(passable(m, 11, 11)).toBe(false);
    expect(passable(m, 12, 12)).toBe(true);
    expect(m.navVersion).toBe(v + 1);
    expect(spawnStructure(sim.world, structure('dynamo'), 0, 11, 11)).toBe(-1);
  });
});

describe('movement', () => {
  it('a tank group sent onto a building parks spaced out around it and then sits still', () => {
    const sim = makeSim({ size: 40 });
    const e = sim.world.entities;
    spawnStructure(sim.world, structure('bunkhouse'), 0, 26, 18);
    const hs: number[] = [];
    for (let i = 0; i < 12; i++) hs.push(spawnUnit(sim.world, unit('bulldog'), 0, at(4 + 2 * (i % 4)), at(4 + 2 * Math.trunc(i / 4))));
    // Onto the building itself: every slot there is blocked and must find its own open ground.
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: hs, x: at(27), y: at(19) } });
    sim.run(20 * 50);
    const ss = hs.map((h) => h & 0xffff);
    for (const s of ss) expect(e.orders[s]).toHaveLength(0);
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++) expect(ilength(e.x[ss[i]!]! - e.x[ss[j]!]!, e.y[ss[i]!]! - e.y[ss[j]!]!)).toBeGreaterThan(FX_ONE);
    // Parked: nobody keeps shuffling.
    const before = ss.map((s) => [e.x[s]!, e.y[s]!] as const);
    sim.run(20 * 5);
    const drift = ss.reduce((sum, s, k) => sum + ilength(e.x[s]! - before[k]![0], e.y[s]! - before[k]![1]), 0);
    expect(drift).toBeLessThan(FX_ONE >> 2);
  });

  it('a single unit walks around a wall to its destination', () => {
    const sim = makeSim({ terrain: wallTerrain() });
    const e = sim.world.entities;
    const h = spawnUnit(sim.world, unit('jackrabbit'), 0, at(5), at(5));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(27), y: at(5) } });
    sim.run(20 * 40);
    const s = h & 0xffff;
    expect(ilength(e.x[s]! - at(27), e.y[s]! - at(5))).toBeLessThan(FX_ONE >> 1);
    expect(e.orders[s]).toHaveLength(0);
  });

  it('a group move arrives in formation using a shared flow field', () => {
    const sim = makeSim({ terrain: wallTerrain() });
    const e = sim.world.entities;
    const hs: number[] = [];
    for (let i = 0; i < 12; i++) hs.push(spawnUnit(sim.world, unit('grunt'), 0, at(3 + (i % 4)), at(3 + Math.trunc(i / 4))));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: hs, x: at(26), y: at(6) } });
    sim.run(20 * 60);
    for (const h of hs) {
      const s = h & 0xffff;
      expect(e.orders[s]).toHaveLength(0);
      expect(ilength(e.x[s]! - at(26), e.y[s]! - at(6))).toBeLessThan(5 * FX_ONE);
      expect(e.x[s]! >> 10).toBeGreaterThan(16);
    }
    // No two infantry overlap much after arriving.
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++) {
        const a = hs[i]! & 0xffff;
        const b = hs[j]! & 0xffff;
        expect(ilength(e.x[a]! - e.x[b]!, e.y[a]! - e.y[b]!)).toBeGreaterThan(FX_ONE >> 2);
      }
  });

  it('air units fly straight over walls', () => {
    const sim = makeSim({ terrain: wallTerrain() });
    const e = sim.world.entities;
    const h = spawnUnit(sim.world, unit('hornet'), 0, at(5), at(5));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(27), y: at(5) } });
    // 22 tiles at 3.5 tiles/s is ~6.3 s; a ground detour would take much longer.
    sim.run(20 * 7);
    expect(e.x[h & 0xffff]! >> 10).toBe(27);
  });

  it('rough terrain slows ground units', () => {
    const rough = new Uint8Array(32 * 32).fill(TERRAIN.rough);
    const a = makeSim();
    const b = makeSim({ terrain: rough });
    for (const sim of [a, b]) {
      const h = spawnUnit(sim.world, unit('grunt'), 0, at(2), at(2));
      sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(30), y: at(2) } });
      sim.run(100);
    }
    expect(a.world.entities.x[0]!).toBeGreaterThan(b.world.entities.x[0]!);
  });

  it('queued orders run in sequence; stop clears them', () => {
    const sim = makeSim();
    const e = sim.world.entities;
    const h = spawnUnit(sim.world, unit('jackrabbit'), 0, at(2), at(2));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(10), y: at(2) } });
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(10), y: at(10), queue: true } });
    sim.run(5);
    expect(e.orders[0]).toHaveLength(2);
    sim.run(20 * 10);
    expect(e.y[0]! >> 10).toBe(10);
    sim.schedule({ tick: sim.tick, player: 0, cmd: { type: 'move', units: [h], x: at(20), y: at(20) } });
    sim.schedule({ tick: sim.tick + 5, player: 0, cmd: { type: 'stop', units: [h] } });
    sim.run(10);
    expect(e.orders[0]).toHaveLength(0);
  });

  it('commands for units the player does not own are ignored', () => {
    const sim = makeSim();
    const h = spawnUnit(sim.world, unit('grace'), 1, at(5), at(5));
    sim.schedule({ tick: 0, player: 0, cmd: { type: 'move', units: [h], x: at(20), y: at(20) } });
    sim.run(40);
    expect(sim.world.entities.x[0]).toBe(at(5));
  });
});
