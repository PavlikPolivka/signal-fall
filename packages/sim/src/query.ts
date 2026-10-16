import type { WeaponRule } from '@signal-fall/data';
import { FX_ONE, FX_SHIFT, idiv, ilength } from './fx';
import { KIND } from './entities';
import { FOG_VISIBLE, type World } from './world';

export const ARMOR_STRUCTURE = 4;

export function teamOf(world: World, slot: number): number {
  return world.players[world.entities.owner[slot]!]!.team;
}

export function isAir(world: World, slot: number): boolean {
  const e = world.entities;
  return e.kind[slot] === KIND.unit && world.rules.units[e.type[slot]!]!.isAir;
}

export function armorOf(world: World, slot: number): number {
  const e = world.entities;
  return e.kind[slot] === KIND.unit ? world.rules.units[e.type[slot]!]!.armor : ARMOR_STRUCTURE;
}

export function weaponOf(world: World, slot: number): WeaponRule | null {
  const e = world.entities;
  const k = e.kind[slot];
  if (k === KIND.unit) return world.rules.units[e.type[slot]!]!.weapon;
  if (k === KIND.structure) return world.rules.structures[e.type[slot]!]!.weapon;
  return null;
}

export function costOf(world: World, slot: number): number {
  const e = world.entities;
  return e.kind[slot] === KIND.unit
    ? world.rules.units[e.type[slot]!]!.cost
    : world.rules.structures[e.type[slot]!]!.cost;
}

export function sightOf(world: World, slot: number): number {
  const e = world.entities;
  if (e.kind[slot] === KIND.wreck) return 0;
  return e.kind[slot] === KIND.unit
    ? world.rules.units[e.type[slot]!]!.sight
    : world.rules.structures[e.type[slot]!]!.sight;
}

/** Is the entity in a tile currently visible to `player`? */
export function visibleTo(world: World, player: number, slot: number): boolean {
  const e = world.entities;
  const m = world.map;
  const fog = world.fog[player]!;
  if (e.kind[slot] === KIND.structure) {
    const rule = world.rules.structures[e.type[slot]!]!;
    const tx = e.tileX[slot]!;
    const ty = e.tileY[slot]!;
    for (let y = ty; y < ty + rule.footprintH; y++)
      for (let x = tx; x < tx + rule.footprintW; x++) if (fog[y * m.width + x]! & FOG_VISIBLE) return true;
    return false;
  }
  const tx = e.x[slot]! >> FX_SHIFT;
  const ty = e.y[slot]! >> FX_SHIFT;
  if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) return false;
  return (fog[ty * m.width + tx]! & FOG_VISIBLE) !== 0;
}

/**
 * Distance from point (x, y) to the target's body: to a unit's edge, or to the
 * nearest point of a structure's footprint. Q10.
 */
export function distToBody(world: World, x: number, y: number, target: number): number {
  const e = world.entities;
  if (e.kind[target] === KIND.structure) {
    const rule = world.rules.structures[e.type[target]!]!;
    const x0 = e.tileX[target]! << FX_SHIFT;
    const y0 = e.tileY[target]! << FX_SHIFT;
    const x1 = x0 + rule.footprintW * FX_ONE;
    const y1 = y0 + rule.footprintH * FX_ONE;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return ilength(dx, dy);
  }
  const d = ilength(e.x[target]! - x, e.y[target]! - y) - e.radius[target]!;
  return d < 0 ? 0 : d;
}

/** Could `attacker` (owned by its owner) legally shoot `victim` with `weapon`? Ignores range. */
export function canTarget(world: World, attacker: number, weapon: WeaponRule, victim: number): boolean {
  const e = world.entities;
  if (e.alive[victim] !== 1 || victim === attacker) return false;
  const k = e.kind[victim];
  if (k !== KIND.unit && k !== KIND.structure) return false;
  if (teamOf(world, victim) === teamOf(world, attacker)) return false;
  // Phased-out units are untouchable.
  if (e.phasedUntil[victim]! > world.tick) return false;
  if (isAir(world, victim) ? !weapon.targetsAir : !weapon.targetsGround) return false;
  return visibleTo(world, e.owner[attacker]!, victim);
}

export function inWeaponRange(world: World, attacker: number, weapon: WeaponRule, victim: number): boolean {
  const e = world.entities;
  const d = distToBody(world, e.x[attacker]!, e.y[attacker]!, victim);
  return d <= rangeOf(world, attacker, weapon) && d >= weapon.minRange;
}

/** Dig In settings of a unit, or null if it cannot dig in. */
export function digInOf(world: World, s: number): { setup: number; damageTakenPct: number; rangeBonus: number } | null {
  if (world.entities.kind[s] !== KIND.unit) return null;
  for (const a of world.rules.units[world.entities.type[s]!]!.abilities) if (a.kind === 'digIn') return a;
  return null;
}

/** Dug in (and done setting up): takes less damage and outranges a little. */
export function isDugIn(world: World, s: number): boolean {
  const at = world.entities.dugInAt[s]!;
  return at > 0 && world.tick >= at;
}

/** Weapon range, plus the Dig In bonus while entrenched. */
export function rangeOf(world: World, s: number, weapon: WeaponRule): number {
  if (!isDugIn(world, s)) return weapon.range;
  return weapon.range + (digInOf(world, s)?.rangeBonus ?? 0);
}

/** Score bonus for the unit's current target, so units don't flicker between targets. */
export const STICKY_BONUS = 300;

/**
 * How much `attacker` wants to shoot `victim` (higher is better), for automatic
 * targeting. Combines weapon effectiveness against the victim's armor, whether
 * the victim can hurt the attacker (threats first), how hurt it is (finish
 * kills), distance, damage already in flight (overkill avoidance) and target
 * class (units > defenses > production/power > other buildings > walls).
 * Siege weapons prefer buildings and clumps. Returns null if it can't be hurt.
 */
export function targetScore(world: World, attacker: number, weapon: WeaponRule, victim: number, dist: number): number | null {
  const e = world.entities;
  const armor = armorOf(world, victim);
  const eff = world.rules.damageMatrix[weapon.type * ARMOR_COUNT + armor]!;
  if (eff <= 0) return null;
  let score = eff * 10;
  const siege = weapon.type === DAMAGE_SIEGE || weapon.splash >= FX_ONE;
  const life = e.hp[victim]! + e.shields[victim]!;
  const maxLife = Math.max(1, e.maxHp[victim]! + e.maxShields[victim]!);

  if (e.kind[victim] === KIND.unit) {
    const vr = world.rules.units[e.type[victim]!]!;
    const vw = vr.weapon;
    // Threats first: can it shoot back at me?
    if (vw && (isAir(world, attacker) ? vw.targetsAir : vw.targetsGround)) score += 600;
    else if (vr.abilities.some((a) => a.kind === 'harvest')) score += 150;
  } else {
    const sr = world.rules.structures[e.type[victim]!]!;
    if (sr.weapon) score += 400;
    else if (sr.role === 'wall') score -= 800;
    else if (sr.produces || sr.role === 'power' || sr.role === 'refinery' || sr.role === 'conyard') score += 100;
    if (siege) score += 500;
  }
  // Finish kills: up to +250 for a nearly dead target.
  score += idiv((maxLife - life) * 250, maxLife);
  // Overkill: shots already in flight will finish it.
  if ((world.pending.get(victim) ?? 0) >= life) score -= 2000;
  // Siege: more enemies inside the splash is better.
  if (siege && weapon.splash > 0 && e.kind[victim] === KIND.unit) {
    const team = teamOf(world, attacker);
    let clump = 0;
    world.spatial.query(e.x[victim]!, e.y[victim]!, weapon.splash + FX_ONE, (o) => {
      if (o === victim || e.kind[o] !== KIND.unit || teamOf(world, o) === team) return;
      if (ilength(e.x[o]! - e.x[victim]!, e.y[o]! - e.y[victim]!) <= weapon.splash) clump++;
    });
    score += clump * 120;
  }
  // Nearer is better: -40 per tile.
  score -= (dist * 40) >> 10;
  if (e.target[attacker] === e.handle(victim)) score += STICKY_BONUS;
  return score;
}

const ARMOR_COUNT = 5;
const DAMAGE_SIEGE = 4;

/**
 * Best automatic target for `attacker` within `radius` (Q10, to the victim's
 * body) by targetScore; ties go to the lowest slot. Returns -1 if none.
 */
export function acquireTarget(world: World, attacker: number, weapon: WeaponRule, radius: number): number {
  const best = bestTarget(world, attacker, weapon, radius);
  return best.slot;
}

export function bestTarget(world: World, attacker: number, weapon: WeaponRule, radius: number): { slot: number; score: number } {
  const e = world.entities;
  const ax = e.x[attacker]!;
  const ay = e.y[attacker]!;
  let best = -1;
  let bestScore = 0;
  // Structures can be up to 3 tiles wide; widen the query so their centers are found.
  world.spatial.query(ax, ay, radius + 2 * FX_ONE, (s) => {
    if (!canTarget(world, attacker, weapon, s)) return;
    const d = distToBody(world, ax, ay, s);
    if (d > radius || d < weapon.minRange) return;
    const score = targetScore(world, attacker, weapon, s, d);
    if (score === null) return;
    if (best < 0 || score > bestScore || (score === bestScore && s < best)) {
      best = s;
      bestScore = score;
    }
  });
  return { slot: best, score: bestScore };
}
