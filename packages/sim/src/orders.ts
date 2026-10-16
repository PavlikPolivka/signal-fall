import type { Command, ScheduledCommand } from './commands';
import { FX_ONE, FX_SHIFT, clamp, idiv, pct } from './fx';
import { HARVEST, KIND, NO_ENTITY, STANCE, type Order } from './entities';
import { CHOIR_SEED_START_PCT, isFarSeed, placementError, footprintBlocked, worldPlacementView } from './placement';
import { teamOf } from './query';
import { formationSlots } from './formation';
import { removeEntity, spawnStructure } from './spawn';
import { computeFacts, findEcho, MAX_QUEUE, requirementsMet, salvageValue, spawnFreeHarvester, TABS } from './systems/economy';
import { BUILD_CATEGORY_INDEX, type World } from './world';
import { canResearch, useAbility, usePower } from './systems/faction';
import { sanitizeDirectives } from './directives';

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

/** Any direct order takes a harvester off its harvesting loop. */
function stopHarvesting(world: World, s: number): void {
  const e = world.entities;
  if (e.hstate[s] === HARVEST.off) return;
  e.hstate[s] = HARVEST.off;
  e.target[s] = NO_ENTITY;
}

function give(world: World, s: number, order: Order, queue: boolean): void {
  const e = world.entities;
  stopHarvesting(world, s);
  // Any order packs up a dug-in unit.
  e.dugInAt[s] = 0;
  if (!queue || e.orders[s]!.length === 0) {
    e.orders[s] = [order];
    e.target[s] = NO_ENTITY;
    resetMovement(world, s);
  } else {
    e.orders[s]!.push(order);
  }
}

/**
 * Group orders: every unit gets its own slot in a role-based formation around
 * the target, and the group shares the slowest member's speed so it arrives
 * together. Large groups also share a flow field toward the target.
 */
function groupMove(world: World, units: number[], type: 'move' | 'attackMove', x: number, y: number, queue: boolean): void {
  const e = world.entities;
  const n = units.length;
  if (n === 0) return;
  const slots = formationSlots(world, units, x, y);
  const flow = n >= FLOW_MIN_GROUP;
  const group = n > 1 ? world.nextGroup++ : 0;
  let speed = 0;
  if (n > 1) {
    speed = 0x7fffffff;
    for (const s of units) speed = Math.min(speed, world.rules.units[e.type[s]!]!.speed);
  }
  units.forEach((s, i) => {
    const slot = slots[i]!;
    const base = { x: slot.x, y: slot.y, flow, cx: x, cy: y, group, speed };
    give(world, s, type === 'move' ? { type, ...base } : { type, ...base, regroupUntil: -1 }, queue);
  });
}

export function applyCommand(world: World, c: ScheduledCommand): void {
  const player = world.players[c.player]!;
  const cmd: Command = c.cmd;
  const e = world.entities;
  switch (cmd.type) {
    case 'noop':
      return;
    case 'directives':
      player.directives = sanitizeDirectives(world, c.player, cmd.directives);
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
        give(world, s, { type: 'attack', target: cmd.target, x: e.x[t]!, y: e.y[t]! }, cmd.queue ?? false);
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
        stopHarvesting(world, s);
        e.orders[s] = [];
        e.target[s] = NO_ENTITY;
        if (cmd.type === 'hold') e.stance[s] = STANCE.hold;
        e.anchorX[s] = e.x[s]!;
        e.anchorY[s] = e.y[s]!;
        resetMovement(world, s);
      }
      return;
    case 'power':
      usePower(world, c.player, cmd.x, cmd.y);
      return;
    case 'ability': {
      const units = ownedUnits(world, c.player, cmd.units);
      if (cmd.x !== undefined && cmd.y !== undefined && units.length > 0) {
        // Blink keeps the group's shape: each unit aims at the point plus its offset from the group center.
        let cx = 0;
        let cy = 0;
        for (const s of units) {
          cx += e.x[s]!;
          cy += e.y[s]!;
        }
        cx = idiv(cx, units.length);
        cy = idiv(cy, units.length);
        for (const s of units) useAbility(world, c.player, s, cmd.x + e.x[s]! - cx, cmd.y + e.y[s]! - cy, cmd.target ?? -1);
      } else for (const s of units) useAbility(world, c.player, s, -1, -1, cmd.target ?? -1);
      return;
    }
    case 'research': {
      if (canResearch(world, computeFacts(world)[c.player]!, c.player, cmd.upgrade)) player.research.item = cmd.upgrade;
      return;
    }
    case 'cancelResearch': {
      const r = player.research;
      player.credits += r.spent;
      r.item = -1;
      r.progress = 0;
      r.spent = 0;
      return;
    }
    case 'deploy':
      for (const s of ownedUnits(world, c.player, cmd.units)) deploy(world, c.player, s);
      return;
    case 'build':
      startBuild(world, c.player, cmd.category, cmd.item, cmd.tx, cmd.ty);
      return;
    case 'cancelBuild': {
      const q = player.build[BUILD_CATEGORY_INDEX[cmd.category]]!;
      player.credits += q.spent;
      q.item = -1;
      q.progress = 0;
      q.spent = 0;
      q.ready = false;
      q.atX = -1;
      q.atY = -1;
      q.atTries = 0;
      return;
    }
    case 'place':
      place(world, c.player, cmd.category, cmd.tx, cmd.ty);
      return;
    case 'train':
      train(world, c.player, cmd.item, cmd.count);
      return;
    case 'cancelTrain': {
      const rule = world.rules.units[cmd.item];
      if (!rule) return;
      const q = player.production[TABS.indexOf(rule.tab)]!;
      const i = q.items.lastIndexOf(cmd.item);
      if (i < 0) return;
      q.items.splice(i, 1);
      if (i === 0) {
        player.credits += q.spent;
        q.progress = 0;
        q.spent = 0;
      }
      return;
    }
    case 'rally': {
      const t = e.resolve(cmd.target);
      if (t < 0 || e.kind[t] !== KIND.structure || e.owner[t] !== c.player) return;
      e.rallyX[t] = clamp(cmd.x, 0, world.map.width * FX_ONE - 1);
      e.rallyY[t] = clamp(cmd.y, 0, world.map.height * FX_ONE - 1);
      return;
    }
    case 'sell': {
      const t = e.resolve(cmd.target);
      if (t < 0 || e.kind[t] !== KIND.structure || e.owner[t] !== c.player) return;
      const rule = world.rules.structures[e.type[t]!]!;
      player.credits += idiv(rule.cost * world.rules.constants.sellRefundPct, 100);
      removeEntity(world, t);
      return;
    }
    case 'repair': {
      const t = e.resolve(cmd.target);
      if (t < 0 || e.kind[t] !== KIND.structure || e.owner[t] !== c.player || e.repairing[t] === 2) return;
      e.repairing[t] = e.repairing[t] === 1 || e.hp[t]! >= e.maxHp[t]! ? 0 : 1;
      return;
    }
    case 'harvest':
      harvest(world, c.player, cmd.units, cmd.x, cmd.y);
      return;
    case 'harvestMode':
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        e.hmode[s] = cmd.mode === 1 ? 1 : 0;
        // Re-pick the tile with the new preference unless mid-harvest of a full load.
        if (e.hstate[s] === HARVEST.toField) e.htile[s] = -1;
      }
      return;
    case 'salvage': {
      const t = e.resolve(cmd.target);
      if (t < 0 || e.kind[t] !== KIND.wreck) return;
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        if (canSalvage(world, s) && salvageValue(world, c.player, t) > 0) give(world, s, { type: 'salvage', target: cmd.target }, cmd.queue ?? false);
      }
      return;
    }
    case 'stance':
      if (cmd.stance < 0 || cmd.stance > 3) return;
      for (const s of ownedUnits(world, c.player, cmd.units)) e.stance[s] = cmd.stance;
      return;
    case 'scatter': {
      const w = world.map.width * FX_ONE - 1;
      const h = world.map.height * FX_ONE - 1;
      for (const s of ownedUnits(world, c.player, cmd.units)) {
        const dx = world.rng.range(-3 * FX_ONE, 3 * FX_ONE);
        const dy = world.rng.range(-3 * FX_ONE, 3 * FX_ONE);
        const x = clamp(e.x[s]! + dx, 0, w);
        const y = clamp(e.y[s]! + dy, 0, h);
        give(world, s, { type: 'move', x, y, flow: false, cx: x, cy: y, group: 0, speed: 0 }, false);
      }
      return;
    }
  }
}

// --- economy commands ---

function startBuild(world: World, player: number, category: 'structures' | 'defenses', item: number, tx?: number, ty?: number): void {
  const p = world.players[player]!;
  const rule = world.rules.structures[item];
  if (!rule || rule.category !== category || rule.faction !== p.faction) return;
  const q = p.build[BUILD_CATEGORY_INDEX[category]]!;
  if (q.item >= 0) return; // one at a time per category
  if (!requirementsMet(computeFacts(world)[player]!, rule.requires)) return;
  q.item = item;
  q.progress = 0;
  q.spent = 0;
  q.ready = false;
  const planned = typeof tx === 'number' && typeof ty === 'number' && tx >= 0 && ty >= 0 && tx < world.map.width && ty < world.map.height;
  q.atX = planned ? tx | 0 : -1;
  q.atY = planned ? ty | 0 : -1;
  q.atTries = 0;
}

/** How long a finished building keeps trying its planned spot (units may be in the way). */
const AUTO_PLACE_TICKS = 100;

/** Place-first: finished structures with a planned spot place themselves (each tick, until it works or times out). */
export function autoPlaceSystem(world: World): void {
  for (const p of world.players) {
    if (p.defeated) continue;
    for (let cat = 0; cat < 2; cat++) {
      const q = p.build[cat]!;
      if (!q.ready || q.atX < 0) continue;
      if (place(world, p.index, cat === 0 ? 'structures' : 'defenses', q.atX, q.atY)) continue;
      q.atTries++;
      // Still blocked: let the player pick another spot.
      if (q.atTries >= AUTO_PLACE_TICKS) {
        q.atX = -1;
        q.atY = -1;
        q.atTries = 0;
      }
    }
  }
}

function place(world: World, player: number, category: 'structures' | 'defenses', tx: number, ty: number): boolean {
  const p = world.players[player]!;
  const q = p.build[BUILD_CATEGORY_INDEX[category]]!;
  if (q.item < 0 || !q.ready) return false;
  const rule = world.rules.structures[q.item]!;
  const faction = world.rules.factions[p.faction]!;
  const view = worldPlacementView(world, player);
  if (placementError(view, player, faction, rule, tx, ty) !== null) return false;
  const far = isFarSeed(view, player, faction, rule, tx, ty);
  const h = spawnStructure(world, rule.index, player, tx, ty);
  if (h < 0) return false;
  if (far) {
    // A far seed starts weak and grows (repairing = 2, see repairSystem).
    const e = world.entities;
    e.hp[h & 0xffff] = Math.max(1, pct(e.maxHp[h & 0xffff]!, CHOIR_SEED_START_PCT));
    e.repairing[h & 0xffff] = 2;
  }
  q.item = -1;
  q.progress = 0;
  q.spent = 0;
  q.ready = false;
  q.atX = -1;
  q.atY = -1;
  q.atTries = 0;
  if (rule.role === 'refinery') spawnFreeHarvester(world, player, h & 0xffff);
  return true;
}

function train(world: World, player: number, item: number, count: number): void {
  const p = world.players[player]!;
  const rule = world.rules.units[item];
  if (!rule || rule.faction !== p.faction) return;
  const q = p.production[TABS.indexOf(rule.tab)]!;
  const n = Math.max(1, Math.min(count, MAX_QUEUE - q.items.length));
  for (let i = 0; i < n && q.items.length < MAX_QUEUE; i++) q.items.push(item);
}

/** Turn a construction unit into its construction yard, centered where it stands. */
function deploy(world: World, player: number, s: number): void {
  const e = world.entities;
  const rule = world.rules.units[e.type[s]!]!;
  const ability = rule.abilities.find((a) => a.kind === 'deploy');
  if (!ability || ability.kind !== 'deploy') return;
  const si = world.rules.structureIndex.get(ability.into);
  if (si === undefined) return;
  const srule = world.rules.structures[si]!;
  const tx = (e.x[s]! >> FX_SHIFT) - (srule.footprintW >> 1);
  const ty = (e.y[s]! >> FX_SHIFT) - (srule.footprintH >> 1);
  if (footprintBlocked(worldPlacementView(world, player, s), srule, tx, ty)) return;
  removeEntity(world, s);
  spawnStructure(world, si, player, tx, ty);
}

function harvest(world: World, player: number, units: number[], x: number, y: number): void {
  const e = world.entities;
  const m = world.map;
  const tx = clamp(x >> FX_SHIFT, 0, m.width - 1);
  const ty = clamp(y >> FX_SHIFT, 0, m.height - 1);
  const clicked = ty * m.width + tx;
  const occupant = m.occupant[clicked]!;
  const toRefinery =
    occupant >= 0 && e.alive[occupant] === 1 && e.owner[occupant] === player && world.rules.structures[e.type[occupant]!]!.role === 'refinery';
  for (const s of ownedUnits(world, player, units)) {
    const rule = world.rules.units[e.type[s]!]!;
    if (!rule.abilities.some((a) => a.kind === 'harvest')) continue;
    e.orders[s] = [];
    resetMovement(world, s);
    if (toRefinery) {
      e.hstate[s] = HARVEST.toRefinery;
      e.target[s] = e.handle(occupant);
    } else {
      e.hstate[s] = HARVEST.toField;
      e.target[s] = NO_ENTITY;
      e.htile[s] = m.echo[clicked]! > 0 ? clicked : findEcho(world, tx, ty, 6, e.hmode[s]);
    }
  }
}

export function canSalvage(world: World, s: number): boolean {
  const rule = world.rules.units[world.entities.type[s]!]!;
  return rule.abilities.some((a) => a.kind === 'harvest' || (a.kind === 'engineer' && a.salvage));
}
