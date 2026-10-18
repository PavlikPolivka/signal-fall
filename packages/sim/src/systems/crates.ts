import { FX_ONE, FX_SHIFT, idiv } from '../fx';
import { KIND } from '../entities';
import { isAir } from '../query';
import { Rng } from '../rng';
import { TERRAIN_SPEED_PCT } from '../map';
import { pushFx, CREDIT_REASON, FX_EVENT, type World } from '../world';
import { promote } from './combat';

/**
 * Crates (an optional skirmish setting): every so often a crate drops on open ground somewhere on
 * the map. The first ground unit to reach it opens it: credits for its owner, a full repair for
 * the units around it, or a promotion for the unit itself. Their own random stream, so matches
 * without crates play exactly as before.
 */
export const CRATE = { credits: 1, repair: 2, veteran: 3 } as const;

export interface Crate {
  x: number;
  y: number;
  kind: number;
}

/** Seconds between drops, and how many may lie on the map at once. */
const DROP_TICKS = 900;
const MAX_CRATES = 3;
export const CRATE_CREDITS = 500;
const REPAIR_RADIUS = 3;
/** A unit this close (Q10, each axis) opens a crate. */
const REACH = (FX_ONE * 3) >> 2;

export function cratesSystem(world: World): void {
  if (!world.crates) return;
  const c = world.crates;
  const e = world.entities;
  const m = world.map;
  // Drop a new one now and then, on a random open tile (a few tries).
  if (world.tick > 0 && world.tick % DROP_TICKS === 0 && c.list.length < MAX_CRATES) {
    for (let k = 0; k < 20; k++) {
      const x = 4 + c.rng.int(m.width - 8);
      const y = 4 + c.rng.int(m.height - 8);
      const t = y * m.width + x;
      if (TERRAIN_SPEED_PCT[m.terrain[t]!] === 0 || m.echo[t] !== 0 || m.occupant[t] !== -1) continue;
      c.list.push({ x, y, kind: 1 + c.rng.int(3) });
      break;
    }
  }
  if (world.tick % 5 !== 0) return;
  for (let i = c.list.length - 1; i >= 0; i--) {
    const crate = c.list[i]!;
    const cx = (crate.x << FX_SHIFT) + (FX_ONE >> 1);
    const cy = (crate.y << FX_SHIFT) + (FX_ONE >> 1);
    let taker = -1;
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || isAir(world, s)) continue;
      if (Math.abs(e.x[s]! - cx) <= REACH && Math.abs(e.y[s]! - cy) <= REACH) {
        taker = s;
        break;
      }
    }
    if (taker < 0) continue;
    const owner = e.owner[taker]!;
    if (crate.kind === CRATE.credits) world.players[owner]!.credits += CRATE_CREDITS;
    else if (crate.kind === CRATE.repair) {
      const r = REPAIR_RADIUS * FX_ONE;
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.owner[s] !== owner) continue;
        const dx = e.x[s]! - cx;
        const dy = e.y[s]! - cy;
        if (dx * dx + dy * dy <= r * r) e.hp[s] = e.maxHp[s]!;
      }
    } else {
      // Enough experience for the next rank.
      const rule = world.rules.units[e.type[taker]!]!;
      const th = world.rules.constants.veterancyThresholdPct;
      if (e.rank[taker]! < th.length) {
        e.xp[taker] = Math.max(e.xp[taker]!, idiv(rule.cost * th[e.rank[taker]!]! + 99, 100));
        promote(world, taker);
      }
    }
    // a: the credits, or minus the crate kind for the others (the client shows what it gave).
    pushFx(world, FX_EVENT.credits, crate.kind === CRATE.credits ? CRATE_CREDITS : -crate.kind, CREDIT_REASON.crate, owner, cx, cy, 0, 0);
    c.list.splice(i, 1);
  }
}

/** Crate state for a world that has them: its own random stream (from the match seed). */
export function makeCrates(seed: number): { rng: Rng; list: Crate[] } {
  return { rng: Rng.derive(seed, 300), list: [] };
}
