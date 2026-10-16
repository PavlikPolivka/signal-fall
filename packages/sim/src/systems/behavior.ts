import type { WeaponRule } from '@signal-fall/data';
import { ARMOR } from '@signal-fall/data';
import { FX_HALF, FX_ONE, clamp, idiv, ilength, pct } from '../fx';
import { HARVEST, KIND, NO_ENTITY, STANCE, type Order } from '../entities';
import { acquireTarget, armorOf, bestTarget, canTarget, distToBody, inWeaponRange, isAir, targetScore, teamOf, visibleTo, weaponOf, STICKY_BONUS } from '../query';
import { CREDIT_REASON, FX_EVENT, pushFx, type GroupInfo, type World } from '../world';
import { removeEntity } from '../spawn';
import { salvageValue } from './economy';

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

/** Engineers and salvagers act within this distance. */
const CONTACT = (FX_ONE * 3) >> 2;
/** Units that cannot shoot an attack target stay this close to it. */
const ESCORT_RANGE = 3 * FX_ONE;
/** Idle units return fire if hit within this many ticks. */
const RETALIATE_TICKS = 40;

/** Units re-check whether a better target is available this often (staggered). */
const RETARGET_INTERVAL = 10;
/** A new target must beat the current one by this much score to switch. */
const SWITCH_MARGIN = 200;
/** The vanguard of a strung-out group holds at most this long for stragglers. */
const REGROUP_TICKS = 120;
/** A group counts as strung out when its last member is this much farther behind than the vanguard. */
const STRUNG_OUT = 6 * FX_ONE;
/** Hit this recently = under fire (no regrouping, harvesters flee). */
const UNDER_FIRE_TICKS = 20;
/** Kiting units step this far away from their attacker. */
const KITE_STEP = 2 * FX_ONE;
/** Artillery backs off this far when enemies get inside its minimum range. */
const BACKOFF_STEP = 3 * FX_ONE;

/** Distance within which a unit counts as arrived at its own slot. */
const ARRIVE = FX_ONE >> 2;

/**
 * Decide each unit's combat target and movement goal for this tick. Structures
 * with weapons only pick targets. Runs before movement and combat.
 */
export function behaviorSystem(world: World): void {
  const e = world.entities;
  computePending(world);
  computeGroups(world);
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const weapon = weaponOf(world, s);
    if (e.kind[s] === KIND.structure) {
      if (weapon) structureTargeting(world, s, weapon);
      continue;
    }
    if (e.kind[s] !== KIND.unit) continue;
    e.hasGoal[s] = 0;
    unitBehavior(world, s, weapon);
  }
}

function structureTargeting(world: World, s: number, weapon: WeaponRule): void {
  engage(world, s, weapon, weapon.range);
}

/** Damage already in flight per target, after the damage matrix (overkill avoidance). */
function computePending(world: World): void {
  const e = world.entities;
  world.pending.clear();
  for (const p of world.projectiles) {
    const t = e.resolve(p.target);
    if (t < 0) continue;
    const dmg = pct(p.damage, world.rules.damageMatrix[p.type * ARMOR.length + armorOf(world, t)]!);
    world.pending.set(t, (world.pending.get(t) ?? 0) + dmg);
  }
}

/** Remaining-distance stats per formation group (for moving together and regrouping). */
function computeGroups(world: World): void {
  const e = world.entities;
  const rems = new Map<number, number[]>();
  world.groups.clear();
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    const o = e.orders[s]![0];
    if (!o || (o.type !== 'move' && o.type !== 'attackMove') || o.group === 0) continue;
    const rem = ilength(o.x - e.x[s]!, o.y - e.y[s]!);
    let list = rems.get(o.group);
    if (!list) {
      list = [];
      rems.set(o.group, list);
      world.groups.set(o.group, { minRem: rem, medRem: rem, maxRem: rem, underFire: false, engaged: false });
    }
    list.push(rem);
    const g = world.groups.get(o.group)!;
    if (e.lastHitTick[s]! >= 0 && world.tick - e.lastHitTick[s]! <= UNDER_FIRE_TICKS) g.underFire = true;
    if (e.resolve(e.target[s]!) >= 0) g.engaged = true;
  }
  for (const [id, list] of rems) {
    list.sort((a, b) => a - b);
    const g = world.groups.get(id)!;
    g.minRem = list[0]!;
    g.maxRem = list[list.length - 1]!;
    g.medRem = list[list.length >> 1]!;
  }
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

/**
 * Keep the current target or find a better one. Targets are scored by
 * targetScore (effectiveness, threat, low HP, distance, overkill); the current
 * target gets a stickiness bonus and is re-evaluated every RETARGET_INTERVAL
 * ticks, switching only for a clearly better one. Returns the target slot or -1.
 */
function engage(world: World, s: number, weapon: WeaponRule, radius: number): number {
  const e = world.entities;
  let t = e.resolve(e.target[s]!);
  if (t >= 0 && !canTarget(world, s, weapon, t)) t = -1;
  const dist = t >= 0 ? distToBody(world, e.x[s]!, e.y[s]!, t) : 0;
  if (t >= 0 && dist > radius + FX_ONE) t = -1;
  if (t < 0) {
    if ((world.tick + s) % ACQUIRE_INTERVAL === 0) t = acquireTarget(world, s, weapon, radius);
  } else if ((world.tick + s) % RETARGET_INTERVAL === 0) {
    const current = targetScore(world, s, weapon, t, dist);
    const best = bestTarget(world, s, weapon, radius);
    // bestTarget already includes the sticky bonus for the current target; others must beat it by a margin.
    if (best.slot >= 0 && best.slot !== t && (current === null || best.score > current + SWITCH_MARGIN - STICKY_BONUS)) t = best.slot;
  }
  e.target[s] = t >= 0 ? e.handle(t) : NO_ENTITY;
  return t;
}

/** Point `step` away from (fx, fy), as seen from unit s, clamped to the map. */
function awayFrom(world: World, s: number, fx: number, fy: number, step: number): [number, number] {
  const e = world.entities;
  const dx = e.x[s]! - fx;
  const dy = e.y[s]! - fy;
  const len = Math.max(1, ilength(dx, dy));
  const maxX = world.map.width * FX_ONE - 1;
  const maxY = world.map.height * FX_ONE - 1;
  return [clamp(e.x[s]! + idiv(dx * step, len), 0, maxX), clamp(e.y[s]! + idiv(dy * step, len), 0, maxY)];
}

/**
 * Micro while fighting `t`: artillery backs off from enemies inside its
 * minimum range; ranged units that outrange and outpace their attacker step
 * back while reloading (auto-kite). Returns true if it set a movement goal.
 */
function micro(world: World, s: number, weapon: WeaponRule, t: number): boolean {
  const e = world.entities;
  if (e.stance[s] === STANCE.hold) return false;
  if (weapon.minRange > 0) {
    // Nearest visible enemy ground unit inside min range + half a tile.
    const team = teamOf(world, s);
    let near = -1;
    let nearD = weapon.minRange + FX_HALF;
    world.spatial.query(e.x[s]!, e.y[s]!, nearD + FX_ONE, (o) => {
      if (e.kind[o] !== KIND.unit || teamOf(world, o) === team || isAir(world, o)) return;
      if (!visibleTo(world, e.owner[s]!, o)) return;
      const d = ilength(e.x[o]! - e.x[s]!, e.y[o]! - e.y[s]!);
      if (d < nearD) {
        nearD = d;
        near = o;
      }
    });
    if (near >= 0) {
      const [gx, gy] = awayFrom(world, s, e.x[near]!, e.y[near]!, BACKOFF_STEP);
      setGoal(world, s, gx, gy);
      return true;
    }
    return false;
  }
  if (e.kind[t] !== KIND.unit || e.cooldown[s]! <= 2) return false;
  const tr = world.rules.units[e.type[t]!]!;
  const tw = tr.weapon;
  if (!tw || !(isAir(world, s) ? tw.targetsAir : tw.targetsGround)) return false;
  const me = world.rules.units[e.type[s]!]!;
  if (weapon.range <= tw.range || me.speed <= tr.speed) return false;
  const d = distToBody(world, e.x[s]!, e.y[s]!, t);
  if (d >= tw.range + FX_HALF) return false;
  const [gx, gy] = awayFrom(world, s, e.x[t]!, e.y[t]!, KITE_STEP);
  setGoal(world, s, gx, gy);
  return true;
}

/** Fight `t`: micro if useful, otherwise close to range. */
function fight(world: World, s: number, weapon: WeaponRule, t: number): void {
  if (!micro(world, s, weapon, t)) approach(world, s, weapon, t);
}

/**
 * Should this attack-moving unit hold for stragglers? The vanguard of a
 * strung-out group waits (up to REGROUP_TICKS) when it first meets enemies,
 * unless the group is already under fire.
 */
function holdForGroup(world: World, s: number, o: Order & { type: 'attackMove' }): boolean {
  if (o.group === 0) return false;
  const g: GroupInfo | undefined = world.groups.get(o.group);
  if (!g || g.underFire) return false;
  const e = world.entities;
  const rem = ilength(o.x - e.x[s]!, o.y - e.y[s]!);
  const strungOut = g.maxRem - rem > STRUNG_OUT;
  if (!strungOut) return false;
  if (o.regroupUntil < 0) o.regroupUntil = world.tick + REGROUP_TICKS;
  return world.tick < o.regroupUntil;
}

/**
 * Engineers capture enemy structures (attack order) or fully repair damaged own
 * structures (guard order) on contact, and are consumed. Returns true if this
 * unit handled the order as an engineer.
 */
function engineerAt(world: World, s: number, t: number, action: 'capture' | 'repair'): boolean {
  const e = world.entities;
  if (t < 0 || e.kind[t] !== KIND.structure) return false;
  const rule = world.rules.units[e.type[s]!]!;
  const eng = rule.abilities.find((a) => a.kind === 'engineer');
  if (!eng || eng.kind !== 'engineer') return false;
  if (action === 'capture' ? !eng.capture : !eng.repair || e.hp[t]! >= e.maxHp[t]!) return false;
  if (distToBody(world, e.x[s]!, e.y[s]!, t) > CONTACT) {
    setGoal(world, s, e.x[t]!, e.y[t]!);
    return true;
  }
  if (action === 'capture') {
    e.owner[t] = e.owner[s]!;
    e.target[t] = NO_ENTITY;
    e.repairing[t] = 0;
    e.dock[t] = NO_ENTITY;
    e.rallyX[t] = -1;
    e.rallyY[t] = -1;
  } else e.hp[t] = e.maxHp[t]!;
  removeEntity(world, s);
  return true;
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

  const stance = e.stance[s]!;
  if (!o) {
    if (!weapon || stance === STANCE.holdFire) {
      // Harvesters keep their refinery in `target` while working.
      if (e.hstate[s] === HARVEST.off) e.target[s] = NO_ENTITY;
      return;
    }
    if (stance === STANCE.hold) {
      engage(world, s, weapon, weapon.range);
      return;
    }
    const aggressive = stance === STANCE.aggressive;
    let t = engage(world, s, weapon, aggressive ? sight : weapon.range + IDLE_ACQUIRE_BONUS);
    if (t < 0) t = retaliate(world, s, weapon);
    if (t >= 0) {
      const fromAnchor = ilength(e.x[t]! - e.anchorX[s]!, e.y[t]! - e.anchorY[s]!);
      if (!aggressive && fromAnchor > LEASH + weapon.range) {
        e.target[s] = NO_ENTITY;
        setGoal(world, s, e.anchorX[s]!, e.anchorY[s]!);
      } else {
        fight(world, s, weapon, t);
        // Aggressive units make wherever the chase ends their new post.
        if (aggressive) {
          e.anchorX[s] = e.x[s]!;
          e.anchorY[s] = e.y[s]!;
        }
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
      const fights = weapon !== null && stance !== STANCE.holdFire;
      if (fights) {
        const t = engage(world, s, weapon, sight);
        if (t >= 0) {
          // The vanguard holds (still shooting what's in range) while stragglers catch up.
          if (o.type === 'attackMove' && holdForGroup(world, s, o)) return;
          fight(world, s, weapon, t);
          return;
        }
      }
      if (arrived(world, s, gx, gy, crowdRadius(world, s))) {
        // Clear the area: don't finish while enemies are still in sight of the destination.
        if (fights && o.type === 'attackMove') {
          const t = acquireTarget(world, s, weapon, sight);
          if (t >= 0) {
            e.target[s] = e.handle(t);
            fight(world, s, weapon, t);
            return;
          }
        }
        if (o.type === 'patrol') {
          o.toB = !o.toB;
          e.stuck[s] = 0;
          e.paths[s] = null;
          e.pathGoal[s] = -1;
        } else completeOrder(world, s);
      } else setGoal(world, s, gx, gy);
      return;
    }
    case 'salvage': {
      const t = e.resolve(o.target);
      if (t < 0 || e.kind[t] !== KIND.wreck) {
        completeOrder(world, s);
        return;
      }
      if (ilength(e.x[t]! - e.x[s]!, e.y[t]! - e.y[s]!) <= CONTACT) {
        const value = salvageValue(world, e.owner[s]!, t);
        world.players[e.owner[s]!]!.credits += value;
        pushFx(world, FX_EVENT.credits, value, CREDIT_REASON.salvage, e.owner[s]!, e.x[t]!, e.y[t]!, 0, 0);
        removeEntity(world, t);
        completeOrder(world, s);
      } else setGoal(world, s, e.x[t]!, e.y[t]!);
      return;
    }
    case 'attack': {
      const t = e.resolve(o.target);
      if (engineerAt(world, s, t, 'capture')) return;
      const seen = t >= 0 && visibleTo(world, e.owner[s]!, t);
      if (seen) {
        o.x = e.x[t]!;
        o.y = e.y[t]!;
      }
      if (!seen) {
        // Target died or vanished into fog: keep fighting toward where it was.
        e.orders[s]![0] = { type: 'attackMove', x: o.x, y: o.y, flow: false, cx: o.x, cy: o.y, group: 0, speed: 0, regroupUntil: -1 };
        return;
      }
      if (weapon && canTarget(world, s, weapon, t)) {
        e.target[s] = e.handle(t);
        fight(world, s, weapon, t);
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
      if (engineerAt(world, s, g, 'repair')) return;
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
