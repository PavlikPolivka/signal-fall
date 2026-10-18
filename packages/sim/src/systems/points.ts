import { FX_SHIFT, FX_ONE, idiv } from '../fx';
import { KIND } from '../entities';
import { isAir } from '../query';
import type { World } from '../world';

/**
 * Capture points: neutral sites on some maps that a team takes by standing ground units next to
 * them, uncontested, for CAPTURE_TICKS. An Echo derrick pumps credits to its owner, a watchtower
 * sees far, a repair depot mends the owner's units around it (machines and soldiers, not Choir crystal). Opposing units nearby stop a
 * capture; a point whose owner is defeated goes neutral again.
 */
export const POINT = { derrick: 1, watchtower: 2, depot: 3 } as const;

export interface CapturePoint {
  /** Tile. */
  x: number;
  y: number;
  kind: number;
  /** Player who holds it, or -1. */
  owner: number;
  /** Team taking it (progress counts for them), or -1. */
  capturer: number;
  /** Ticks of uncontested presence so far. */
  progress: number;
}

/** Units within this many tiles take (or hold) a point. */
export const CAPTURE_RADIUS = 3;
export const CAPTURE_TICKS = 200;
/** How often the points update, ticks. */
const STEP = 5;
/** Effects pulse every second. */
const PULSE = 20;
export const DERRICK_CREDITS = 4;
export const WATCHTOWER_SIGHT = 12;
export const DEPOT_RADIUS = 4;
/** Percent of max HP mended per pulse. */
export const DEPOT_HEAL_PCT = 2;

export function pointsSystem(world: World): void {
  if (world.points.length === 0 || world.tick % STEP !== 0) return;
  const e = world.entities;
  const players = world.players;
  const reach = CAPTURE_RADIUS * FX_ONE;
  const reach2 = reach * reach;
  for (const p of world.points) {
    if (p.owner >= 0 && players[p.owner]!.defeated) p.owner = -1;
    const px = (p.x << FX_SHIFT) + (FX_ONE >> 1);
    const py = (p.y << FX_SHIFT) + (FX_ONE >> 1);
    // Ground units near the point, per player.
    const near = players.map(() => 0);
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || isAir(world, s)) continue;
      const dx = e.x[s]! - px;
      const dy = e.y[s]! - py;
      if (dx * dx + dy * dy <= reach2) near[e.owner[s]!]! += 1;
    }
    const teams: number[] = [];
    for (let k = 0; k < players.length; k++) if (near[k]! > 0 && !teams.includes(players[k]!.team)) teams.push(players[k]!.team);
    if (teams.length === 0) {
      // Left alone, a half-taken point slips back.
      p.progress = Math.max(0, p.progress - STEP);
      if (p.progress === 0) p.capturer = -1;
    } else if (teams.length === 1) {
      const team = teams[0]!;
      if (p.owner >= 0 && players[p.owner]!.team === team) {
        p.progress = 0;
        p.capturer = -1;
      } else {
        if (p.capturer !== team) {
          p.capturer = team;
          p.progress = 0;
        }
        p.progress += STEP;
        if (p.progress >= CAPTURE_TICKS) {
          // The player of that team with the most units there takes it (lowest index on a tie).
          let best = -1;
          for (let k = 0; k < players.length; k++) if (players[k]!.team === team && (best < 0 || near[k]! > near[best]!)) best = k;
          p.owner = best;
          p.capturer = -1;
          p.progress = 0;
        }
      }
    }
  }
  if (world.tick % PULSE !== 0) return;
  for (const p of world.points) {
    if (p.owner < 0) continue;
    if (p.kind === POINT.derrick) {
      players[p.owner]!.credits += DERRICK_CREDITS;
      players[p.owner]!.harvested += DERRICK_CREDITS;
    } else if (p.kind === POINT.depot) {
      const px = (p.x << FX_SHIFT) + (FX_ONE >> 1);
      const py = (p.y << FX_SHIFT) + (FX_ONE >> 1);
      const r = DEPOT_RADIUS * FX_ONE;
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== p.owner || e.hp[s]! >= e.maxHp[s]!) continue;
        // Living crystal can't be patched up (the Choir mends its shields on its own).
        if (world.rules.units[e.type[s]!]!.shields > 0 && world.rules.factions[players[p.owner]!.faction]!.id === 'choir') continue;
        const dx = e.x[s]! - px;
        const dy = e.y[s]! - py;
        if (dx * dx + dy * dy > r * r) continue;
        e.hp[s] = Math.min(e.maxHp[s]!, e.hp[s]! + Math.max(1, idiv(e.maxHp[s]! * DEPOT_HEAL_PCT, 100)));
      }
    }
  }
}
