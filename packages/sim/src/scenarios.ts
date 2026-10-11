import type { Rules } from '@signal-fall/data';
import { FX_HALF, FX_SHIFT, idiv } from './fx';
import { KIND } from './entities';
import { TERRAIN } from './map';
import { Sim } from './sim';
import { spawnStructure, spawnUnit } from './spawn';

/**
 * Reusable deterministic scenarios for tests, benchmarks and the cross-runtime
 * golden hash. Pure sim code: runs identically in Node and browsers.
 */

export interface ArmySpec {
  /** [unit id, count] pairs. */
  units: [string, number][];
  structures?: [string, number, number][];
}

export interface BattleResult {
  /** 0 or 1 for the side with survivors, -1 for draw/timeout. */
  winner: number;
  survivors: [number, number];
  ticks: number;
  hash: number;
}

function unitRule(rules: Rules, id: string): number {
  const i = rules.unitIndex.get(id);
  if (i === undefined) throw new Error(`unknown unit ${id}`);
  return i;
}

function structureRule(rules: Rules, id: string): number {
  const i = rules.structureIndex.get(id);
  if (i === undefined) throw new Error(`unknown structure ${id}`);
  return i;
}

/** Place a block of units in rows around a column, `dir` = facing direction (+1 east, -1 west). */
function placeArmy(sim: Sim, owner: number, army: ArmySpec, colTile: number, rowTile: number, dir: number): number[] {
  const w = sim.world;
  const handles: number[] = [];
  let i = 0;
  const perRow = 6;
  for (const [id, count] of army.units) {
    const rule = unitRule(w.rules, id);
    for (let k = 0; k < count; k++, i++) {
      const row = i % perRow;
      const col = idiv(i, perRow);
      const x = ((colTile - dir * col) << FX_SHIFT) + FX_HALF;
      const y = ((rowTile + row - (perRow >> 1)) << FX_SHIFT) + FX_HALF;
      handles.push(spawnUnit(w, rule, owner, x, y));
    }
  }
  for (const [id, tx, ty] of army.structures ?? []) spawnStructure(w, structureRule(w.rules, id), owner, tx, ty);
  return handles;
}

export function countUnits(sim: Sim, owner: number): number {
  const e = sim.world.entities;
  let n = 0;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === owner && e.kind[s] === KIND.unit) n++;
  return n;
}

/** Live units and structures (wrecks don't count). */
function countAll(sim: Sim, owner: number): number {
  const e = sim.world.entities;
  let n = 0;
  for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === owner && e.kind[s] !== KIND.wreck) n++;
  return n;
}

/**
 * Two armies 14 tiles apart attack-move into each other on an open map.
 * Side 0 is Holdout-owned, side 1 uses `factionB` (defaults to Holdout too, so
 * mirror matchups compare raw unit stats).
 */
export function battle(rules: Rules, a: ArmySpec, b: ArmySpec, opts: { seed?: number; maxTicks?: number; factionB?: number } = {}): BattleResult {
  const size = 48;
  const sim = new Sim({
    rules,
    seed: opts.seed ?? 1,
    width: size,
    height: size,
    players: [
      { faction: 0, team: 0 },
      { faction: opts.factionB ?? 0, team: 1 },
    ],
    victoryRules: false,
  });
  const mid = size >> 1;
  const ua = placeArmy(sim, 0, a, mid - 7, mid, 1);
  const ub = placeArmy(sim, 1, b, mid + 7, mid, -1);
  sim.schedule({ tick: 0, player: 0, cmd: { type: 'attackMove', units: ua, x: ((mid + 10) << FX_SHIFT) + FX_HALF, y: (mid << FX_SHIFT) + FX_HALF } });
  sim.schedule({ tick: 0, player: 1, cmd: { type: 'attackMove', units: ub, x: ((mid - 10) << FX_SHIFT) + FX_HALF, y: (mid << FX_SHIFT) + FX_HALF } });
  const maxTicks = opts.maxTicks ?? 20 * 120;
  while (sim.tick < maxTicks) {
    sim.step();
    if (sim.tick % 20 !== 0) continue;
    const na = countAll(sim, 0);
    const nb = countAll(sim, 1);
    if (na === 0 || nb === 0) break;
  }
  const na = countAll(sim, 0);
  const nb = countAll(sim, 1);
  return {
    winner: na > 0 && nb === 0 ? 0 : nb > 0 && na === 0 ? 1 : -1,
    survivors: [na, nb],
    ticks: sim.tick,
    hash: sim.hash(),
  };
}

/** Deterministic map with walls of rock for pathing-heavy scenarios. */
export function obstacleTerrain(size: number): Uint8Array {
  const t = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Vertical walls with gaps, plus scattered rock and rough patches.
      if ((x === (size >> 2) || x === size - (size >> 2)) && y % 16 > 3) t[i] = TERRAIN.rock;
      else if ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) % 37 === 0) t[i] = TERRAIN.rock;
      else if ((x + y) % 23 < 2 && x % 5 === 0) t[i] = TERRAIN.rough;
    }
  }
  return t;
}

/**
 * Large mixed battle across an obstacle map, with commands issued over time.
 * Used for the perf bench (400 units) and the cross-runtime golden hash.
 */
export function bigBattle(rules: Rules, opts: { unitsPerSide?: number; ticks?: number; seed?: number } = {}) {
  const size = 96;
  const perSide = opts.unitsPerSide ?? 200;
  const sim = new Sim({
    rules,
    seed: opts.seed ?? 12345,
    width: size,
    height: size,
    terrain: obstacleTerrain(size),
    players: [
      { faction: 0, team: 0 },
      { faction: 1, team: 1 },
    ],
    victoryRules: false,
  });
  const w = sim.world;
  const rosterA = ['grunt', 'tankbuster', 'jackrabbit', 'bulldog', 'flak_track', 'thumper', 'hornet'];
  const rosterB = ['sentry', 'lance', 'ping', 'vector', 'firewall', 'broadcast', 'seek'];
  const spawnSide = (owner: number, roster: string[], x0: number): number[] => {
    const hs: number[] = [];
    for (let i = 0; i < perSide; i++) {
      const rule = unitRule(rules, roster[i % roster.length]!);
      const col = i % 10;
      const tx = x0 + col;
      const ty = 8 + idiv(i, 10) * 4 + (i % 3);
      if (w.map.nav[ty * size + tx] !== 1 && !rules.units[rule]!.isAir) continue;
      hs.push(spawnUnit(w, rule, owner, (tx << FX_SHIFT) + FX_HALF, (ty << FX_SHIFT) + FX_HALF));
    }
    return hs;
  };
  const a = spawnSide(0, rosterA, 4);
  const b = spawnSide(1, rosterB, size - 14);
  spawnStructure(w, structureRule(rules, 'pillbox'), 0, 20, 40);
  spawnStructure(w, structureRule(rules, 'guard'), 1, size - 21, 50);
  const cmd = (tick: number, player: number, c: Parameters<Sim['schedule']>[0]['cmd']) => sim.schedule({ tick, player, cmd: c });
  const half = (n: number) => (n << FX_SHIFT) + FX_HALF;
  cmd(0, 0, { type: 'attackMove', units: a, x: half(size - 10), y: half(48) });
  cmd(0, 1, { type: 'attackMove', units: b, x: half(10), y: half(48) });
  cmd(200, 0, { type: 'move', units: a.slice(0, 40), x: half(48), y: half(20) });
  cmd(260, 1, { type: 'scatter', units: b.slice(0, 20) });
  cmd(300, 1, { type: 'attackMove', units: b.slice(0, 60), x: half(30), y: half(70), queue: true });
  cmd(400, 0, { type: 'hold', units: a.slice(40, 60) });
  if (a[0] !== undefined && b[0] !== undefined) cmd(450, 0, { type: 'attack', units: a.slice(60, 80), target: b[0] });
  cmd(500, 1, { type: 'patrol', units: b.slice(60, 80), x: half(48), y: half(48) });
  if (b[1] !== undefined) cmd(520, 1, { type: 'guard', units: b.slice(80, 90), target: b[1] });
  return { sim, ticks: opts.ticks ?? 1200 };
}

/** Run bigBattle to completion and return the final hash: the cross-runtime golden value. */
export function goldenHash(rules: Rules): number {
  const { sim, ticks } = bigBattle(rules, { unitsPerSide: 120, ticks: 1000 });
  sim.run(ticks);
  return sim.hash();
}

/**
 * Client sandbox before maps and economy exist: an obstacle map with a few
 * structures and mixed armies per side. `unitsPerSide` large = stress test.
 */
export function sandbox(rules: Rules, opts: { unitsPerSide?: number; size?: number; seed?: number } = {}): Sim {
  const size = opts.size ?? 96;
  const sim = new Sim({
    rules,
    seed: opts.seed ?? 7,
    width: size,
    height: size,
    terrain: obstacleTerrain(size),
    players: [
      { faction: 0, team: 0 },
      { faction: 1, team: 1 },
    ],
    victoryRules: false,
  });
  const w = sim.world;
  const per = opts.unitsPerSide ?? 24;
  const sides: [number, string[], string[], number][] = [
    [0, ['grunt', 'grunt', 'tankbuster', 'jackrabbit', 'bulldog', 'flak_track', 'thumper', 'hornet', 'mule', 'homestead'], ['holdfast', 'dynamo', 'bunkhouse', 'motor_pool', 'pillbox'], 6],
    [1, ['sentry', 'sentry', 'lance', 'ping', 'vector', 'firewall', 'broadcast', 'seek', 'fetch', 'init'], ['kernel', 'powerd', 'spawn', 'make', 'guard'], size - 22],
  ];
  for (const [owner, units, structures, x0] of sides) {
    let sx = x0;
    for (const id of structures) {
      const rule = structureRule(rules, id);
      const r = rules.structures[rule]!;
      if (spawnStructure(w, rule, owner, sx, 6) >= 0) sx += r.footprintW + 1;
    }
    for (let i = 0; i < per; i++) {
      const rule = unitRule(rules, units[i % units.length]!);
      const tx = x0 + (i % 14);
      const ty = 14 + idiv(i, 14);
      if (ty >= size) break;
      if (w.map.nav[ty * size + tx] !== 1 && !rules.units[rule]!.isAir) continue;
      spawnUnit(w, rule, owner, (tx << FX_SHIFT) + FX_HALF, (ty << FX_SHIFT) + FX_HALF);
    }
  }
  return sim;
}
