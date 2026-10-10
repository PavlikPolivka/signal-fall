import type { WeaponRule } from '@signal-fall/data';
import { FX_ONE, ilength } from '../fx';
import { KIND, NO_ENTITY, STANCE, type Order } from '../entities';
import { acquireTarget, canTarget, distToBody, inWeaponRange, visibleTo, weaponOf } from '../query';
import type { World } from '../world';

/** Units re-scan for targets every this many ticks (staggered by slot). */
const ACQUIRE_INTERVAL = 8;
/** Idle units chase auto-targets at most this far from where they were left. */
const LEASH = 6 * FX_ONE;
/** Extra auto-acquire radius beyond weapon range for idle units. */
const IDLE_ACQUIRE_BONUS = 2 * FX_ONE;
/** Guards follow when farther than this from the guarded entity. */
const GUARD_FOLLOW = 2 * FX_ONE;
/** Guards engage enemies within this distance of the guarded entity. */
const GUARD_RADIUS = 8 * FX_ONE;

/** Units that cannot shoot an attack target stay this close to it. */
const ESCORT_RANGE = 3 * FX_ONE;
/** Idle units return fire if hit within this many ticks. */
const RETALIATE_TICKS = 40;

/** Distance within which a unit counts as arrived at its own slot. */
const ARRIVE = FX_ONE >> 2;

/**
 * Decide each unit's combat target and movement goal for this tick. Structures
 * with weapons only pick targets. Runs before movement and combat.
 */
export function behaviorSystem(world: World): void {
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const weapon = weaponOf(world, s);
    if (e.kind[s] === KIND.structure) {
      if (weapon) structureTargeting(world, s, weapon);
      continue;
    }
    e.hasGoal[s] = 0;
    unitBehavior(world, s, weapon);
  }
}

function structureTargeting(world: World, s: number, weapon: WeaponRule): void {
  const e = world.entities;
  const t = e.resolve(e.target[s]!);
  if (t >= 0 && canTarget(world, s, weapon, t) && inWeaponRange(world, s, weapon, t)) return;
  e.target[s] = NO_ENTITY;
  if ((world.tick + s) % 4 !== 0) return;
  const found = acquireTarget(world, s, weapon, weapon.range);
  if (found >= 0) e.target[s] = e.handle(found);
}

function setGoal(world: World, s: number, x: number, y: number): void {
  const e = world.entities;
  e.goalX[s] = x;
  e.goalY[s] = y;
  e.hasGoal[s] = 1;
}

/** Shift the current order and make the unit's current spot its new anchor. */
function completeOrder(world: World, s: number): void {
  const e = world.entities;
  e.orders[s]!.shift();
  e.target[s] = NO_ENTITY;
  e.anchorX[s] = e.x[s]!;
  e.anchorY[s] = e.y[s]!;
  e.paths[s] = null;
  e.pathGoal[s] = -1;
  e.stuck[s] = 0;
}

/** Has the unit reached (x, y)? Groups accept "close enough and blocked" as arrival. */
function arrived(world: World, s: number, x: number, y: number, crowd: number): boolean {
  const e = world.entities;
  const d = ilength(x - e.x[s]!, y - e.y[s]!);
  if (d <= ARRIVE) return true;
  if (e.stuck[s]! > 20 && d <= crowd) return true;
  return e.stuck[s]! > 200;
}

/** Keep a valid current target or find a new one. Returns the target slot or -1. */
function engage(world: World, s: number, weapon: WeaponRule, radius: number): number {
  const e = world.entities;
  let t = e.resolve(e.target[s]!);
  if (t >= 0 && !canTarget(world, s, weapon, t)) t = -1;
  if (t >= 0 && distToBody(world, e.x[s]!, e.y[s]!, t) > radius + FX_ONE) t = -1;
  if (t < 0 && (world.tick + s) % ACQUIRE_INTERVAL === 0) t = acquireTarget(world, s, weapon, radius);
  e.target[s] = t >= 0 ? e.handle(t) : NO_ENTITY;
  return t;
}

/** Idle units shoot back at whoever hit them recently, even from beyond their acquire radius. */
function retaliate(world: World, s: number, weapon: WeaponRule): number {
  const e = world.entities;
  if (e.lastHitTick[s]! < 0 || world.tick - e.lastHitTick[s]! > RETALIATE_TICKS) return -1;
  const a = e.resolve(e.lastAttacker[s]!);
  if (a < 0 || !canTarget(world, s, weapon, a)) return -1;
  e.target[s] = e.handle(a);
  return a;
}

/** Move toward the target until in range. */
function approach(world: World, s: number, weapon: WeaponRule, t: number): void {
  const e = world.entities;
  if (!inWeaponRange(world, s, weapon, t)) setGoal(world, s, e.x[t]!, e.y[t]!);
}

function unitBehavior(world: World, s: number, weapon: WeaponRule | null): void {
  const e = world.entities;
  const o: Order | undefined = e.orders[s]![0];
  const sight = world.rules.units[e.type[s]!]!.sight;

  if (!o) {
    if (!weapon) {
      e.target[s] = NO_ENTITY;
      return;
    }
    if (e.stance[s] === STANCE.hold) {
      engage(world, s, weapon, weapon.range);
      return;
    }
    let t = engage(world, s, weapon, weapon.range + IDLE_ACQUIRE_BONUS);
    if (t < 0) t = retaliate(world, s, weapon);
    if (t >= 0) {
      const fromAnchor = ilength(e.x[t]! - e.anchorX[s]!, e.y[t]! - e.anchorY[s]!);
      if (fromAnchor > LEASH + weapon.range) {
        e.target[s] = NO_ENTITY;
        setGoal(world, s, e.anchorX[s]!, e.anchorY[s]!);
      } else {
        approach(world, s, weapon, t);
      }
    } else if (ilength(e.x[s]! - e.anchorX[s]!, e.y[s]! - e.anchorY[s]!) > FX_ONE) {
      // Drifted away while chasing: walk back.
      setGoal(world, s, e.anchorX[s]!, e.anchorY[s]!);
    }
    return;
  }

  switch (o.type) {
    case 'move': {
      e.target[s] = NO_ENTITY;
      if (arrived(world, s, o.x, o.y, crowdRadius(world, s))) completeOrder(world, s);
      else setGoal(world, s, o.x, o.y);
      return;
    }
    case 'attackMove':
    case 'patrol': {
      const gx = o.type === 'patrol' ? (o.toB ? o.bx : o.ax) : o.x;
      const gy = o.type === 'patrol' ? (o.toB ? o.by : o.ay) : o.y;
      if (weapon) {
        const t = engage(world, s, weapon, sight);
        if (t >= 0) {
          approach(world, s, weapon, t);
          return;
        }
      }
      if (arrived(world, s, gx, gy, crowdRadius(world, s))) {
        if (o.type === 'patrol') {
          o.toB = !o.toB;
          e.stuck[s] = 0;
          e.paths[s] = null;
          e.pathGoal[s] = -1;
        } else completeOrder(world, s);
      } else setGoal(world, s, gx, gy);
      return;
    }
    case 'attack': {
      const t = e.resolve(o.target);
      const seen = t >= 0 && visibleTo(world, e.owner[s]!, t);
      if (seen) {
        o.x = e.x[t]!;
        o.y = e.y[t]!;
      }
      if (!seen) {
        // Target died or vanished into fog: keep fighting toward where it was.
        e.orders[s]![0] = { type: 'attackMove', x: o.x, y: o.y, flow: false, cx: o.x, cy: o.y };
        return;
      }
      if (weapon && canTarget(world, s, weapon, t)) {
        e.target[s] = e.handle(t);
        approach(world, s, weapon, t);
        return;
      }
      // Can't hit it (unarmed, or wrong layer): advance with the group and fight what we can.
      if (weapon) {
        const other = engage(world, s, weapon, sight);
        if (other >= 0) {
          approach(world, s, weapon, other);
          return;
        }
      }
      if (distToBody(world, e.x[s]!, e.y[s]!, t) > ESCORT_RANGE) setGoal(world, s, o.x, o.y);
      return;
    }
    case 'guard': {
      const g = e.resolve(o.target);
      if (g < 0) {
        completeOrder(world, s);
        return;
      }
      if (weapon) {
        const t = engage(world, s, weapon, sight);
        if (t >= 0 && ilength(e.x[t]! - e.x[g]!, e.y[t]! - e.y[g]!) <= GUARD_RADIUS) {
          approach(world, s, weapon, t);
          return;
        }
        e.target[s] = NO_ENTITY;
      }
      const d = distToBody(world, e.x[s]!, e.y[s]!, g);
      if (d > GUARD_FOLLOW) setGoal(world, s, e.x[g]!, e.y[g]!);
      return;
    }
  }
}

/** How close is close enough when a crowd blocks the exact spot: grows with group size. */
function crowdRadius(world: World, s: number): number {
  const o = world.entities.orders[s]![0];
  const base = FX_ONE + (FX_ONE >> 1);
  if (!o || (o.type !== 'move' && o.type !== 'attackMove')) return base;
  return o.flow ? base + 2 * FX_ONE : base;
}
