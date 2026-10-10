import { FX_SHIFT } from '../fx';
import { sightOf } from '../query';
import { FOG_EXPLORED, FOG_INTERVAL, FOG_VISIBLE, type World } from '../world';

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

  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const team = teams[e.owner[s]!]!;
    const r = sightOf(world, s) >> FX_SHIFT;
    const st = stencil(r);
    const cx = e.x[s]! >> FX_SHIFT;
    const cy = e.y[s]! >> FX_SHIFT;
    for (let p = 0; p < world.players.length; p++) {
      if (teams[p] !== team) continue;
      const f = world.fog[p]!;
      for (let i = 0; i < st.length; i += 2) {
        const x = cx + st[i]!;
        const y = cy + st[i + 1]!;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        f[y * w + x] = FOG_VISIBLE | FOG_EXPLORED;
      }
    }
  }
}
