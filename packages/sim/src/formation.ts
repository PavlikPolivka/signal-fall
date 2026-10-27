import type { UnitRule } from '@signal-fall/data';
import { FX_ONE, FX_SHIFT, clamp, idiv, ilength, isqrt } from './fx';
import type { World } from './world';

/** Formation rows, front to back. */
export const ROW = { front: 0, line: 1, support: 2, back: 3 } as const;

/**
 * Role-based row for a unit: heavies up front, direct-fire behind them, AA and
 * support (repair, engineers, harvesters) in the middle, artillery at the back.
 */
export function formationRow(rule: UnitRule): number {
  const w = rule.weapon;
  if (!w) return ROW.support;
  if (w.minRange > 0 || w.type === 4 /* siege */) return ROW.back;
  if (!w.targetsGround) return ROW.support; // anti-air only
  if (rule.armor === 2 /* heavy */) return ROW.front;
  return ROW.line;
}

export interface Slot {
  x: number;
  y: number;
}

/**
 * Formation slots for `units` around the target point (x, y), facing from the
 * group's centroid toward the target. Rows are filled front to back; within a
 * row units keep their current left-to-right order to avoid crossing paths.
 * Returns slots in the same order as `units`.
 */
export function formationSlots(world: World, units: number[], x: number, y: number): Slot[] {
  const e = world.entities;
  const n = units.length;
  if (n === 1) return [{ x, y }];
  let sx = 0;
  let sy = 0;
  for (const s of units) {
    sx += e.x[s]!;
    sy += e.y[s]!;
  }
  const cx = idiv(sx, n);
  const cy = idiv(sy, n);
  // Facing unit vector (Q10), default east when ordering onto the centroid.
  let fx = x - cx;
  let fy = y - cy;
  const flen = ilength(fx, fy);
  if (flen < FX_ONE) {
    fx = FX_ONE;
    fy = 0;
  } else {
    fx = idiv(fx * FX_ONE, flen);
    fy = idiv(fy * FX_ONE, flen);
  }
  // Lateral axis: facing rotated 90°.
  const lx = -fy;
  const ly = fx;

  const rows: number[][] = [[], [], [], []];
  for (let i = 0; i < n; i++) rows[formationRow(world.rules.units[e.type[units[i]!]!]!)]!.push(i);

  // Spacing per unit: a bit more than its diameter side by side. Front to back a ground vehicle needs
  // its hull length (drawn about three radii long), or parked rows overlap nose to tail. (Hull-length
  // spacing side by side too moved the faction balance; see the balance tuning log.)
  const spacing = (i: number) => Math.max(FX_ONE, world.rules.units[e.type[units[i]!]!]!.radius * 2 + (FX_ONE >> 2));
  const length = (i: number) => {
    const r = world.rules.units[e.type[units[i]!]!]!;
    return r.tab === 'vehicles' && !r.isAir ? Math.max(spacing(i), r.radius * 3 + (FX_ONE >> 2)) : spacing(i);
  };
  // Rows wider than this wrap into sub-rows, keeping the block roughly square.
  const maxPerRow = Math.max(3, isqrt(n) + 2);

  const local: { f: number; l: number }[] = new Array(n);
  let depth = 0;
  for (const row of rows) {
    if (row.length === 0) continue;
    // Left-to-right by current lateral position.
    row.sort((a, b) => lateralOf(e.x[units[a]!]! - cx, e.y[units[a]!]! - cy, lx, ly) - lateralOf(e.x[units[b]!]! - cx, e.y[units[b]!]! - cy, lx, ly) || a - b);
    for (let start = 0; start < row.length; start += maxPerRow) {
      const chunk = row.slice(start, start + maxPerRow);
      let width = 0;
      for (const i of chunk) width += spacing(i);
      let lat = -(width >> 1);
      let rowDepth = 0;
      for (const i of chunk) {
        const sp = spacing(i);
        local[i] = { f: -depth, l: lat + (sp >> 1) };
        lat += sp;
        rowDepth = Math.max(rowDepth, length(i));
      }
      depth += rowDepth;
    }
  }
  // Center the block on the target point along the facing axis.
  const shift = depth >> 1;
  const maxX = world.map.width * FX_ONE - 1;
  const maxY = world.map.height * FX_ONE - 1;
  // Open tiles already given to a displaced slot: each displaced unit gets its own.
  const used: number[] = [];
  return local.map(({ f, l }) => {
    const ff = f + shift;
    let px = x + ((fx * ff + lx * l) >> FX_SHIFT);
    let py = y + ((fy * ff + ly * l) >> FX_SHIFT);
    px = clamp(px, 0, maxX);
    py = clamp(py, 0, maxY);
    // Slots on blocked ground move to the nearest open tile.
    const m = world.map;
    const tile = (py >> FX_SHIFT) * m.width + (px >> FX_SHIFT);
    if (m.nav[tile] !== 1) {
      const open = freeOpenTile(world, tile, used);
      if (open >= 0) {
        used.push(open);
        px = ((open % m.width) << FX_SHIFT) + (FX_ONE >> 1);
        py = (idiv(open, m.width) << FX_SHIFT) + (FX_ONE >> 1);
      }
    }
    return { x: px, y: py };
  });
}

/**
 * The nearest walkable tile to `tile` that no other displaced slot took (ring by ring, fixed order).
 * Slots on a building all used to snap to the same nearest open tile, and their units piled up there.
 */
function freeOpenTile(world: World, tile: number, used: number[]): number {
  const m = world.map;
  const cx = tile % m.width;
  const cy = idiv(tile, m.width);
  for (let r = 1; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        const t = y * m.width + x;
        if (m.nav[t] === 1 && !used.includes(t)) return t;
      }
  return world.paths.nearestPassable(tile, 6);
}

function lateralOf(dx: number, dy: number, lx: number, ly: number): number {
  return (dx * lx + dy * ly) >> FX_SHIFT;
}
