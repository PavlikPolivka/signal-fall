import type { WeaponRule } from '@signal-fall/data';
import { FX_ONE, FX_SHIFT, ilength } from './fx';
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
  if (teamOf(world, victim) === teamOf(world, attacker)) return false;
  if (isAir(world, victim) ? !weapon.targetsAir : !weapon.targetsGround) return false;
  return visibleTo(world, e.owner[attacker]!, victim);
}

export function inWeaponRange(world: World, attacker: number, weapon: WeaponRule, victim: number): boolean {
  const e = world.entities;
  const d = distToBody(world, e.x[attacker]!, e.y[attacker]!, victim);
  return d <= weapon.range && d >= weapon.minRange;
}

/** Priority class for auto-targeting: lower is preferred. */
function threatClass(world: World, slot: number): number {
  const e = world.entities;
  if (e.kind[slot] === KIND.unit) return world.rules.units[e.type[slot]!]!.weapon ? 0 : 1;
  const rule = world.rules.structures[e.type[slot]!]!;
  if (rule.weapon) return 0;
  return rule.role === 'wall' ? 3 : 2;
}

/**
 * Best auto-target for `attacker` within `radius` (Q10, measured to the
 * victim's body): lowest threat class, then nearest, then lowest slot.
 */
export function acquireTarget(world: World, attacker: number, weapon: WeaponRule, radius: number): number {
  const e = world.entities;
  const ax = e.x[attacker]!;
  const ay = e.y[attacker]!;
  let best = -1;
  let bestClass = 99;
  let bestDist = 0;
  // Structures can be up to 3 tiles wide; widen the query so their centers are found.
  world.spatial.query(ax, ay, radius + 2 * FX_ONE, (s) => {
    if (!canTarget(world, attacker, weapon, s)) return;
    const d = distToBody(world, ax, ay, s);
    if (d > radius || d < weapon.minRange) return;
    const c = threatClass(world, s);
    if (best < 0 || c < bestClass || (c === bestClass && (d < bestDist || (d === bestDist && s < best)))) {
      best = s;
      bestClass = c;
      bestDist = d;
    }
  });
  return best;
}
