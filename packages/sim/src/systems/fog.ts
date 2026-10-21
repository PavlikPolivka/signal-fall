import { FX_SHIFT } from '../fx';
import { sightOf } from '../query';
import { FOG_EXPLORED, FOG_INTERVAL, FOG_VISIBLE, type World } from '../world';
import { POINT, WATCHTOWER_SIGHT } from './points';
import { BRUSH_SIGHT, TERRAIN } from '../map';

/** Circle stencils per radius in tiles: flat [dx0, dy0, dx1, dy1, ...]. */
const STENCILS = new Map<number, Int32Array>();

function stencil(r: number): Int32Array {
  let st = STENCILS.get(r);
  if (st) return st;
  const pts: number[] = [];
  const r2 = r * r + r; // slightly generous so circles look round
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2) pts.push(dx, dy);
  st = Int32Array.from(pts);
  STENCILS.set(r, st);
  return st;
}

/**
 * Recompute visibility every FOG_INTERVAL ticks. Players share vision with
 * their team. Explored bits are never cleared.
 */
export function fogSystem(world: World, force = false): void {
  if (!force && world.tick % FOG_INTERVAL !== 0) return;
  const e = world.entities;
  const m = world.map;
  const w = m.width;
  const h = m.height;
  const teams = world.players.map((p) => p.team);
  for (const f of world.fog) for (let i = 0; i < f.length; i++) f[i]! &= ~FOG_VISIBLE;
  // Tiles each player would see but for the brush (shooting from the brush gives a unit away).
  const hidden = world.players.map(() => new Uint8Array(w * h));

  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const r = sightOf(world, s) >> FX_SHIFT;
    if (r === 0) continue;
    const team = teams[e.owner[s]!]!;
    const st = stencil(r);
    const cx = e.x[s]! >> FX_SHIFT;
    const cy = e.y[s]! >> FX_SHIFT;
    for (let p = 0; p < world.players.length; p++) {
      if (teams[p] !== team) continue;
      const f = world.fog[p]!;
      for (let i = 0; i < st.length; i += 2) {
        const dx = st[i]!;
        const dy = st[i + 1]!;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const t = y * w + x;
        // Brush: rough ground is only seen into from close by.
        if (m.terrain[t] === TERRAIN.rough && dx * dx + dy * dy > BRUSH_SIGHT * BRUSH_SIGHT) {
          f[t]! |= FOG_EXPLORED;
          hidden[p]![t] = 1;
          continue;
        }
        f[t] = FOG_VISIBLE | FOG_EXPLORED;
      }
    }
  }
  // A unit in the brush that is shooting is seen by anyone who could see that tile.
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.cooldown[s]! <= 0) continue;
    const t = (e.y[s]! >> FX_SHIFT) * w + (e.x[s]! >> FX_SHIFT);
    if (m.terrain[t] !== TERRAIN.rough) continue;
    for (let p = 0; p < world.players.length; p++) if (hidden[p]![t] === 1) world.fog[p]![t]! |= FOG_VISIBLE;
  }
  // A revealed map (match option): everyone sees everything.
  if (world.revealed) for (const f of world.fog) f.fill(FOG_VISIBLE | FOG_EXPLORED);
  // A reveal crate: the finder's team sees the whole map for a while.
  for (const finder of world.players) {
    if (finder.revealUntil <= world.tick) continue;
    for (let p = 0; p < world.players.length; p++) if (teams[p] === finder.team) world.fog[p]!.fill(FOG_VISIBLE | FOG_EXPLORED);
  }
  // Watchtowers see far for their owner's team.
  for (const pt of world.points) {
    if (pt.kind !== POINT.watchtower || pt.owner < 0) continue;
    const team = teams[pt.owner]!;
    const st = stencil(WATCHTOWER_SIGHT);
    for (let p = 0; p < world.players.length; p++) {
      if (teams[p] !== team) continue;
      const f = world.fog[p]!;
      for (let i = 0; i < st.length; i += 2) {
        const x = pt.x + st[i]!;
        const y = pt.y + st[i + 1]!;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        f[y * w + x] = FOG_VISIBLE | FOG_EXPLORED;
      }
    }
  }
}
