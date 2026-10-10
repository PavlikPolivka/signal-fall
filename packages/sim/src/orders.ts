import type { Command, ScheduledCommand } from './commands';
import { FX_ONE, clamp, idiv, ilength, isqrt } from './fx';
import { KIND, NO_ENTITY, STANCE, type Order } from './entities';
import { teamOf } from './query';
import type { World } from './world';

/** Groups of at least this many units share a flow field instead of running A* each. */
export const FLOW_MIN_GROUP = 4;

/** Live unit slots in `handles` owned by `player`, in ascending slot order, deduplicated. */
function ownedUnits(world: World, player: number, handles: number[]): number[] {
  const e = world.entities;
  const out: number[] = [];
  for (const h of handles) {
    const s = e.resolve(h);
    if (s < 0 || e.kind[s] !== KIND.unit || e.owner[s] !== player) continue;
    out.push(s);
  }
  out.sort((a, b) => a - b);
  return out.filter((s, i) => i === 0 || out[i - 1] !== s);
}

function resetMovement(world: World, s: number): void {
  const e = world.entities;
  e.paths[s] = null;
  e.pathGoal[s] = -1;
  e.pathIdx[s] = 0;
  e.stuck[s] = 0;
}

function give(world: World, s: number, order: Order, queue: boolean): void {
  const e = world.entities;
  if (!queue || e.orders[s]!.length === 0) {
    e.orders[s] = [order];
    e.target[s] = NO_ENTITY;
    e.stance[s] = STANCE.normal;
    resetMovement(world, s);
  } else {
    e.orders[s]!.push(order);
  }
}

/**
 * Formation: each unit keeps its offset from the group's centroid, compressed
 * so the group spreads over at most ~sqrt(n) tiles around the target.
 */
function groupMove(world: World, units: number[], type: 'move' | 'attackMove', x: number, y: number, queue: boolean): void {
  const e = world.entities;
  const n = units.length;
  if (n === 0) return;
  let sx = 0;
  let sy = 0;
  for (const s of units) {
    sx += e.x[s]!;
    sy += e.y[s]!;
  }
  const cx = idiv(sx, n);
  const cy = idiv(sy, n);
  const spread = idiv((isqrt(n) + 1) * FX_ONE * 3, 4);
  const flow = n >= FLOW_MIN_GROUP;
  const w = world.map.width * FX_ONE - 1;
  const h = world.map.height * FX_ONE - 1;
  for (const s of units) {
    let ox = e.x[s]! - cx;
    let oy = e.y[s]! - cy;
    const len = ilength(ox, oy);
    if (n === 1) {
      ox = 0;
      oy = 0;
    } else if (len > spread) {
      ox = idiv(ox * spread, len);
      oy = idiv(oy * spread, len);
    }
    give(world, s, { type, x: clamp(x + ox, 0, w), y: clamp(y + oy, 0, h), flow, cx: x, cy: y }, queue);
  }
}

export function applyCommand(world: World, c: ScheduledCommand): void {
  const player = world.players[c.player]!;
  const cmd: Command = c.cmd;
  const e = world.entities;
  switch (cmd.type) {
    case 'noop':
      return;
    case 'surrender':
      player.surrendered = true;
      player.defeated = true;
      return;
    case 'move':
    case 'attackMove':
      groupMove(world, ownedUnits(world, c.player, cmd.units), cmd.type, cmd.x, cmd.y, cmd.queue ?? false);
      return;
    case 'attack': {
      const t = e.resolve(cmd.target);
      if (t < 0) return;
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        if (teamOf(world, t) === player.team) continue;
        give(world, s, { type: 'attack', target: cmd.target }, cmd.queue ?? false);
      }
      return;
    }
    case 'guard': {
      const t = e.resolve(cmd.target);
      if (t < 0 || teamOf(world, t) !== player.team) return;
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        if (s === t) continue;
        give(world, s, { type: 'guard', target: cmd.target }, cmd.queue ?? false);
      }
      return;
    }
    case 'patrol':
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        const o: Order = { type: 'patrol', ax: e.x[s]!, ay: e.y[s]!, bx: cmd.x, by: cmd.y, toB: true };
        give(world, s, o, cmd.queue ?? false);
      }
      return;
    case 'stop':
    case 'hold':
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        e.orders[s] = [];
        e.target[s] = NO_ENTITY;
        e.stance[s] = cmd.type === 'hold' ? STANCE.hold : STANCE.normal;
        e.anchorX[s] = e.x[s]!;
        e.anchorY[s] = e.y[s]!;
        resetMovement(world, s);
      }
      return;
    case 'scatter': {
      const w = world.map.width * FX_ONE - 1;
      const h = world.map.height * FX_ONE - 1;
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        const dx = world.rng.range(-3 * FX_ONE, 3 * FX_ONE);
        const dy = world.rng.range(-3 * FX_ONE, 3 * FX_ONE);
        const x = clamp(e.x[s]! + dx, 0, w);
        const y = clamp(e.y[s]! + dy, 0, h);
        give(world, s, { type: 'move', x, y, flow: false, cx: x, cy: y }, false);
      }
      return;
    }
  }
}
