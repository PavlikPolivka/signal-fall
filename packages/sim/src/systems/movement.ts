import { FX_ONE, clamp, iatan2, idiv, ilength } from '../fx';
import { KIND, NO_ENTITY } from '../entities';
import { ROAD_SPEED_PCT, TERRAIN_SPEED_PCT, tileAt, tileCenterX, tileCenterY } from '../map';
import type { World } from '../world';

/** A speed crate: this much of the normal speed while it lasts. */
export const HASTE_PCT = 150;

/** Waypoint counts as reached within this distance of its tile center. */
const WAYPOINT_REACHED = (FX_ONE * 3) >> 3;
/** Within this distance and with a clear line, steer straight at the goal. */
const DIRECT_RANGE = 6 * FX_ONE;
/** A chase path is kept while the goal tile stays within this many tiles of the path's end. */
const REPATH_SLACK = 2;
/** Separation looks this far beyond the unit's own radius. */
const NEIGHBOR_RANGE = FX_ONE;
/** Overlaps smaller than this are left alone: nudging them only makes a parked group shimmer. */
const SEPARATION_SLACK = FX_ONE >> 5;
/**
 * Extra room two parked ground vehicles keep between them: hulls are drawn about three radii long, so two
 * bodies apart they still overlap nose to tail. Only for vehicles at rest with nothing to shoot, so fights
 * pack exactly as before.
 */
const VEHICLE_GAP = (FX_ONE * 7) >> 3;

export function movementSystem(world: World): void {
  const e = world.entities;
  const m = world.map;
  const maxX = m.width * FX_ONE - 1;
  const maxY = m.height * FX_ONE - 1;

  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    // Garrisoned in ruins: stays put.
    if (e.garrison[s]! > 0) continue;
    const rule = world.rules.units[e.type[s]!]!;
    const air = rule.isAir;
    const x = e.x[s]!;
    const y = e.y[s]!;
    const cur = tileAt(m, x, y);

    // --- steering toward the goal ---
    let vx = 0;
    let vy = 0;
    if (e.hasGoal[s] === 1) {
      const gx = e.goalX[s]!;
      const gy = e.goalY[s]!;
      let tx = gx;
      let ty = gy;
      if (!air) {
        const next = groundSteer(world, s, cur, gx, gy);
        if (next >= 0) {
          tx = tileCenterX(m, next);
          ty = tileCenterY(m, next);
        }
      }
      const dx = tx - x;
      const dy = ty - y;
      const d = ilength(dx, dy);
      if (d > 0) {
        // Rough ground slows everyone on foot or wheels; roads speed them up.
        const onRoad = !air && cur >= 0 && m.road[cur] === 1;
        const terrainPct = air || cur < 0 ? 100 : onRoad ? ROAD_SPEED_PCT : TERRAIN_SPEED_PCT[m.terrain[cur]!]! || 100;
        const own = e.hasteUntil[s]! > world.tick ? idiv(rule.speed * HASTE_PCT, 100) : rule.speed;
        const speed = idiv(groupSpeed(world, s, own) * terrainPct, 100);
        const step = d < speed ? d : speed;
        vx = idiv(dx * step, d);
        vy = idiv(dy * step, d);
        e.facing[s] = iatan2(dy, dx);
      }
    }

    // --- separation from overlapping units on the same layer ---
    let px = 0;
    let py = 0;
    const r = e.radius[s]!;
    const moving = e.hasGoal[s] === 1;
    const parkedVehicle = !air && rule.tab === 'vehicles' && e.hasGoal[s] === 0 && e.target[s] === NO_ENTITY;
    world.spatial.query(x, y, r + NEIGHBOR_RANGE, (n) => {
      if (n === s || e.kind[n] !== KIND.unit) return;
      const nrule = world.rules.units[e.type[n]!]!;
      if (nrule.isAir !== air) return;
      const dx = x - e.x[n]!;
      const dy = y - e.y[n]!;
      // Parked vehicles keep extra room (their hulls are long); moving and fighting ones pack as before.
      const parkedPair = parkedVehicle && nrule.tab === 'vehicles' && e.hasGoal[n] === 0 && e.target[n] === NO_ENTITY;
      const minD = r + e.radius[n]! + (parkedPair ? VEHICLE_GAP : 0);
      if (dx >= minD || dx <= -minD || dy >= minD || dy <= -minD) return;
      const dist = ilength(dx, dy);
      if (dist >= minD) return;
      let overlap = minD - dist;
      if (overlap < SEPARATION_SLACK) return;
      // Idle units make way: a moving unit barely yields to them, and they take the whole shove.
      // Two parked units ease apart gently instead of bouncing.
      const other = e.hasGoal[n] === 1;
      if (moving && !other) overlap >>= 2;
      else if (!moving && other) overlap <<= 1;
      else if (!moving) overlap >>= 1;
      if (dist === 0) {
        px += s < n ? -(overlap >> 1) : overlap >> 1;
      } else {
        px += idiv(dx * overlap, dist * 2);
        py += idiv(dy * overlap, dist * 2);
      }
      // Two movers meeting head-on both keep right, so they slide past instead of stalling.
      if (moving && other && -(dx * vx + dy * vy) > 0) {
        const vl = ilength(vx, vy);
        if (vl > 0) {
          px += idiv(-vy * overlap, vl * 2);
          py += idiv(vx * overlap, vl * 2);
        }
      }
    });
    const pmax = rule.speed;
    const plen = ilength(px, py);
    if (plen > pmax) {
      px = idiv(px * pmax, plen);
      py = idiv(py * pmax, plen);
    }

    // --- integrate, sliding along blocked tiles for ground units ---
    let nx = clamp(x + vx + px, 0, maxX);
    let ny = clamp(y + vy + py, 0, maxY);
    if (!air && !walkable(world, cur, nx, ny)) {
      if (walkable(world, cur, nx, y)) ny = y;
      else if (walkable(world, cur, x, ny)) nx = x;
      else {
        nx = x;
        ny = y;
      }
    }
    e.vx[s] = nx - x;
    e.vy[s] = ny - y;
    e.x[s] = nx;
    e.y[s] = ny;

    // --- stuck detection: barely moving while wanting to move ---
    if (e.hasGoal[s] === 1) {
      const moved = ilength(nx - x, ny - y);
      if (moved * 3 < rule.speed) {
        e.stuck[s]!++;
        if (e.stuck[s] === 60) {
          // Try a fresh path once in a while.
          e.paths[s] = null;
          e.pathGoal[s] = -1;
        }
      } else if (e.stuck[s]! > 0) e.stuck[s] = e.stuck[s]! > 2 ? e.stuck[s]! - 2 : 0;
    }
  }
}

/** A ground unit may enter the tile at (x, y) if it is open, or if it is already standing in it. */
function walkable(world: World, cur: number, x: number, y: number): boolean {
  const t = tileAt(world.map, x, y);
  return t >= 0 && (world.map.nav[t] === 1 || t === cur);
}

/**
 * Pick the next tile a ground unit should head for, or -1 to steer straight at
 * the goal. Uses the group's flow field for formation moves, A* otherwise.
 */
function groundSteer(world: World, s: number, cur: number, gx: number, gy: number): number {
  const e = world.entities;
  const m = world.map;
  const paths = world.paths;
  if (cur < 0) return -1;
  const goalTile = tileAt(m, clamp(gx, 0, m.width * FX_ONE - 1), clamp(gy, 0, m.height * FX_ONE - 1));
  if (goalTile === cur) return -1;
  const near = ilength(gx - e.x[s]!, gy - e.y[s]!) <= DIRECT_RANGE;
  if (near && paths.lineClear(cur, goalTile)) {
    e.paths[s] = null;
    e.pathGoal[s] = -1;
    return -1;
  }

  const o = e.orders[s]![0];
  if (o && (o.type === 'move' || o.type === 'attackMove') && o.flow && e.target[s] === NO_ENTITY) {
    const field = paths.flowField(tileAt(m, o.cx, o.cy));
    const next = paths.flowStep(field, cur);
    if (next >= 0) return next;
    // At the bottom of the field (group center) but not at our own slot: A* from here on. Going back to
    // the field next tick pulled the unit back toward the center (a building, say) and it danced in place.
    o.flow = false;
  }

  let path = e.paths[s];
  if (!path || !closeTiles(m.width, e.pathGoal[s]!, goalTile)) {
    path = paths.findPath(cur, goalTile);
    e.paths[s] = path;
    e.pathIdx[s] = 0;
    e.pathGoal[s] = goalTile;
    if (!path) return -1;
  }
  let i = e.pathIdx[s]!;
  while (i < path.length) {
    const wp = path[i]!;
    const d = ilength(tileCenterX(m, wp) - e.x[s]!, tileCenterY(m, wp) - e.y[s]!);
    if (d > WAYPOINT_REACHED) break;
    i++;
  }
  e.pathIdx[s] = i;
  return i < path.length ? path[i]! : -1;
}

/** Are tiles a and b within REPATH_SLACK tiles of each other on both axes? */
function closeTiles(width: number, a: number, b: number): boolean {
  if (a < 0) return false;
  return (
    Math.abs((a % width) - (b % width)) <= REPATH_SLACK &&
    Math.abs(idiv(a, width) - idiv(b, width)) <= REPATH_SLACK
  );
}

/**
 * Units ordered together move at the slowest member's speed. Stragglers (more
 * than 2 tiles behind the group's median progress) may use their full speed to
 * catch up, and units ahead ease off to 3/4 of the group speed. Once the group
 * is fighting, everyone moves at full speed.
 */
function groupSpeed(world: World, s: number, own: number): number {
  const e = world.entities;
  const o = e.orders[s]![0];
  if (!o || (o.type !== 'move' && o.type !== 'attackMove') || o.speed <= 0) return own;
  const g = world.groups.get(o.group);
  if (!g || g.engaged) return own;
  const rem = ilength(o.x - e.x[s]!, o.y - e.y[s]!);
  if (rem > g.medRem + 2 * FX_ONE) return own;
  const cap = Math.min(own, o.speed);
  return rem + FX_ONE < g.medRem ? Math.max(1, idiv(cap * 3, 4)) : cap;
}
