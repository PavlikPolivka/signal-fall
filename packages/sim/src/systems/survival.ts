import { FX_ONE, FX_SHIFT, idiv } from '../fx';
import { KIND } from '../entities';
import { Rng } from '../rng';
import { TERRAIN_SPEED_PCT } from '../map';
import { spawnUnit } from '../spawn';
import type { World } from '../world';

/**
 * Survival: the horde (a player with no base) sends ever bigger waves from the map edges; the
 * defenders win by holding out through every wave. The horde is scripted (it spawns units, its
 * brain sends them at the bases); it plays no economy and can't be "defeated" for lacking a base.
 */
export interface SurvivalState {
  horde: number;
  /** Waves sent so far. */
  wave: number;
  /** Waves to hold out through. */
  waves: number;
  nextTick: number;
  rng: Rng;
  /** Wave size, percent of normal (the survival difficulty). */
  levelPct: number;
}

/** First wave at 2:30, then one every 75 s. */
export const FIRST_WAVE_TICK = 150 * 20;
export const WAVE_GAP = 75 * 20;
export const SURVIVAL_WAVES = 15;

export function makeSurvival(seed: number, horde: number, levelPct = 100): SurvivalState {
  return { horde, wave: 0, waves: SURVIVAL_WAVES, nextTick: FIRST_WAVE_TICK, rng: Rng.derive(seed, 400), levelPct };
}

/** Army value of wave k (1-based), scaled by how many defenders there are. */
export function waveBudget(k: number, defenders: number): number {
  return idiv((700 + 450 * k + 35 * k * k) * (60 + 40 * defenders), 100);
}

export function survivalSystem(world: World): void {
  const s = world.survival;
  if (!s || world.tick < s.nextTick || s.wave >= s.waves) return;
  s.wave++;
  s.nextTick = world.tick + WAVE_GAP;
  const rules = world.rules;
  const faction = rules.factions[world.players[s.horde]!.faction]!;
  // Armed, buildable units; heavier ones join as the waves grow.
  const pool = faction.units.map((i) => rules.units[i]!).filter((u) => u.weapon && u.tier <= 1 + idiv(s.wave + 2, 5));
  const defenders = world.players.filter((p) => p.index !== s.horde && !p.defeated).length;
  let budget = idiv(waveBudget(s.wave, defenders) * s.levelPct, 100);
  const m = world.map;
  const reach = reachable(world);
  // Two entry points on random map edges this wave (where they can walk to the bases).
  const entries: [number, number][] = [];
  for (let k = 0; k < 2; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const side = s.rng.int(4);
      const t = 8 + s.rng.int(m.width - 16);
      const x = side === 0 ? 5 : side === 1 ? m.width - 6 : t;
      const y = side === 2 ? 5 : side === 3 ? m.height - 6 : t;
      if (reach[y * m.width + x] !== 1) continue;
      entries.push([x, y]);
      break;
    }
  }
  if (entries.length === 0 || pool.length === 0) return;
  let n = 0;
  while (budget > 0 && n < 60) {
    const u = pool[s.rng.int(pool.length)]!;
    budget -= u.cost;
    const [x, y] = entries[n % entries.length]!;
    // Spread them a little, on ground they can walk off.
    let tx = x + s.rng.int(5) - 2;
    let ty = y + s.rng.int(5) - 2;
    if (reach[ty * m.width + tx] !== 1) {
      tx = x;
      ty = y;
    }
    spawnUnit(world, u.index, s.horde, (tx << FX_SHIFT) + (FX_ONE >> 1), (ty << FX_SHIFT) + (FX_ONE >> 1));
    n++;
  }
}

/** Ground the defenders' first start connects to (derived from the map, cached per world). */
const REACH = new WeakMap<World, Uint8Array>();
function reachable(world: World): Uint8Array {
  let r = REACH.get(world);
  if (r) return r;
  const m = world.map;
  r = new Uint8Array(m.width * m.height);
  // Seed from any defender's unit or building.
  const e = world.entities;
  let seed = -1;
  for (let s = 0; s < e.high && seed < 0; s++) if (e.alive[s] === 1 && e.owner[s] !== world.survival!.horde && e.owner[s]! >= 0) seed = (e.y[s]! >> FX_SHIFT) * m.width + (e.x[s]! >> FX_SHIFT);
  if (seed < 0) return r;
  const stack = [seed];
  r[seed] = 1;
  while (stack.length > 0) {
    const t = stack.pop()!;
    const x = t % m.width;
    for (const n of [x > 0 ? t - 1 : -1, x < m.width - 1 ? t + 1 : -1, t - m.width, t + m.width]) {
      if (n < 0 || n >= r.length || r[n] === 1 || TERRAIN_SPEED_PCT[m.terrain[n]!] === 0) continue;
      r[n] = 1;
      stack.push(n);
    }
  }
  REACH.set(world, r);
  return r;
}

/** Survival is over for the defenders' side: every wave sent and none of the horde left. */
export function hordeBeaten(world: World): boolean {
  const s = world.survival;
  if (!s || s.wave < s.waves) return false;
  const e = world.entities;
  for (let k = 0; k < e.high; k++) if (e.alive[k] === 1 && e.owner[k] === s.horde && e.kind[k] === KIND.unit) return false;
  return true;
}
