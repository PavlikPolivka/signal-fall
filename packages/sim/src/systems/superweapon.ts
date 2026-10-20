import { FX_ONE, FX_SHIFT, idiv, pct } from '../fx';
import { KIND } from '../entities';
import { inBounds } from '../map';
import { distToBody, teamOf } from '../query';
import { FX_EVENT, pushFx, type World } from '../world';
import { damage } from './combat';

// Superweapons: one tier-3 building per player charges for minutes (everyone sees the
// timer), then strikes a map point after a warning everyone sees. Damage falls off to 50%
// at the edge and spares the caster's team.

/** The player's standing superweapon (slot), or -1. */
export function superweaponOf(world: World, player: number): number {
  const e = world.entities;
  for (let s = 0; s < e.high; s++)
    if (e.alive[s] === 1 && e.kind[s] === KIND.structure && e.owner[s] === player && world.rules.structures[e.type[s]!]!.superweapon) return s;
  return -1;
}

/** The faction's superweapon rule (via its building), or null. */
function ruleOf(world: World, player: number) {
  const f = world.rules.factions[world.players[player]!.faction]!;
  for (const i of f.structures) {
    const sw = world.rules.structures[i]!.superweapon;
    if (sw) return sw;
  }
  return null;
}

/**
 * Superweapon state for the UI: -2 the faction has none, -1 none built, 0 ready, otherwise ticks
 * until charged. Every player's is public.
 */
export function superweaponStatus(world: World, player: number): number {
  const sw = ruleOf(world, player);
  if (!sw) return -2;
  if (superweaponOf(world, player) < 0) return -1;
  return Math.max(0, sw.charge - world.players[player]!.superCharge);
}

/** Fire the player's charged superweapon at (x, y); it lands after the warning delay. */
export function fireSuperweapon(world: World, player: number, x: number, y: number): boolean {
  const p = world.players[player]!;
  const sw = ruleOf(world, player);
  if (!sw || p.strike.at >= 0 || p.superCharge < sw.charge || superweaponOf(world, player) < 0) return false;
  if (!inBounds(world.map, x >> FX_SHIFT, y >> FX_SHIFT)) return false;
  p.superCharge = 0;
  p.strike = { x, y, at: world.tick + sw.delay };
  pushFx(world, FX_EVENT.superweapon, 0, sw.radius, player, x, y, sw.delay, 0);
  return true;
}

/** Charge standing superweapons (paused on low power, lost with the building); land due strikes. */
export function superweaponSystem(world: World): void {
  for (const p of world.players) {
    if (p.defeated) continue;
    const sw = ruleOf(world, p.index);
    if (!sw) continue;
    if (superweaponOf(world, p.index) < 0) p.superCharge = 0;
    else if (!p.lowPower && world.entities.poweredDown[superweaponOf(world, p.index)] === 0 && p.superCharge < sw.charge) p.superCharge++;
    if (p.strike.at >= 0 && world.tick >= p.strike.at) {
      strike(world, p.index, p.strike.x, p.strike.y);
      p.strike = { x: 0, y: 0, at: -1 };
    }
  }
}

function strike(world: World, player: number, x: number, y: number): void {
  const sw = ruleOf(world, player)!;
  const e = world.entities;
  const team = world.players[player]!.team;
  const victims: number[] = [];
  world.spatial.query(x, y, sw.radius + 2 * FX_ONE, (s) => {
    if (e.alive[s] !== 1 || (e.kind[s] !== KIND.unit && e.kind[s] !== KIND.structure) || teamOf(world, s) === team) return;
    if (distToBody(world, x, y, s) <= sw.radius) victims.push(s);
  });
  // The spatial query's order is fixed, so this stays deterministic.
  for (const s of victims) {
    const falloff = 100 - idiv(50 * distToBody(world, x, y, s), sw.radius);
    damage(world, s, pct(sw.damage, falloff), sw.type, -1);
    e.lastAttackerOwner[s] = player;
    // Air-gapped machines and soldiers have no network to jam.
    if (sw.jam > 0 && !world.rules.factions[world.players[e.owner[s]!]!.faction]!.airGapped) e.jammedUntil[s] = world.tick + sw.jam;
  }
  pushFx(world, FX_EVENT.superweapon, 1, sw.radius, player, x, y, sw.type, 0);
}
