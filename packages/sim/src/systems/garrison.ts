import { FX_HALF, FX_ONE, FX_SHIFT, idiv } from '../fx';
import { KIND } from '../entities';
import { TERRAIN, TERRAIN_SPEED_PCT } from '../map';
import type { World } from '../world';

/**
 * Garrisons: infantry can climb into city ruins. Inside, a soldier takes half damage, shoots one
 * tile farther and sees two tiles farther, but cannot move; any new order brings it back out.
 * One soldier per ruins tile.
 */
export const GARRISON_DAMAGE_PCT = 50;
export const GARRISON_RANGE = FX_ONE;
export const GARRISON_SIGHT = 2 * FX_ONE;

const center = (world: World, t: number) => ({ x: ((t % world.map.width) << FX_SHIFT) + FX_HALF, y: (idiv(t, world.map.width) << FX_SHIFT) + FX_HALF });

/** An open tile next to ruins tile t (to walk to, or to step out onto), or -1. */
export function doorOf(world: World, t: number): number {
  const m = world.map;
  const x = t % m.width;
  const y = idiv(t, m.width);
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
    const n = ny * m.width + nx;
    if (TERRAIN_SPEED_PCT[m.terrain[n]!]! > 0 && m.occupant[n] === -1) return n;
  }
  return -1;
}

/** Ruins tiles near (tx, ty) with a way in that nobody holds or is heading for, nearest first. */
export function freeRuins(world: World, tx: number, ty: number, want: number): number[] {
  const m = world.map;
  const e = world.entities;
  const taken = new Set<number>();
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    if (e.garrison[s]! > 0) taken.add(e.garrison[s]! - 1);
    if (e.garrisonGoal[s]! > 0) taken.add(e.garrisonGoal[s]! - 1);
  }
  const out: [number, number][] = [];
  for (let y = ty - 4; y <= ty + 4; y++)
    for (let x = tx - 4; x <= tx + 4; x++) {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      const t = y * m.width + x;
      if (m.terrain[t] !== TERRAIN.ruins || taken.has(t) || doorOf(world, t) < 0) continue;
      out.push([t, (x - tx) * (x - tx) + (y - ty) * (y - ty)]);
    }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out.slice(0, want).map(([t]) => t);
}

/** Step a garrisoned unit back out onto open ground. */
export function leaveGarrison(world: World, s: number): void {
  const e = world.entities;
  e.garrisonGoal[s] = 0;
  const t = e.garrison[s]! - 1;
  if (t < 0) return;
  e.garrison[s] = 0;
  const door = doorOf(world, t);
  if (door < 0) return;
  const c = center(world, door);
  e.x[s] = c.x;
  e.y[s] = c.y;
}

/** Units that reached their ruins go in; units that gave up the walk forget it. */
export function garrisonSystem(world: World): void {
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.garrisonGoal[s] === 0) continue;
    const t = e.garrisonGoal[s]! - 1;
    const c = center(world, t);
    const dx = e.x[s]! - c.x;
    const dy = e.y[s]! - c.y;
    if (dx * dx + dy * dy <= ((FX_ONE * 3) >> 1) * ((FX_ONE * 3) >> 1)) {
      e.garrisonGoal[s] = 0;
      e.garrison[s] = t + 1;
      e.x[s] = c.x;
      e.y[s] = c.y;
      e.vx[s] = 0;
      e.vy[s] = 0;
      e.orders[s] = [];
      e.hasGoal[s] = 0;
    } else if (e.orders[s]!.length === 0) e.garrisonGoal[s] = 0;
  }
}
