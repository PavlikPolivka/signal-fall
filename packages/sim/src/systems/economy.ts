import type { Role, Tab, UnitRule } from '@signal-fall/data';
import { FX_HALF, FX_ONE, FX_SHIFT, idiv, ilength, isqrt, pct } from '../fx';
import { HARVEST, HARVEST_MODE, KIND, NO_ENTITY } from '../entities';
import { removeEntity, spawnUnit } from '../spawn';
import { distToBody } from '../query';
import { tileAt } from '../map';
import { upgradePct } from './faction';
import { CHOIR_SEED_GROW_PCT } from '../placement';
import { CREDIT_REASON, FX_EVENT, pushFx, type PlayerState, type World } from '../world';

/** Ticks between crystals while harvesting. */
export const HARVEST_TICKS = 8;
/** Credits unloaded per tick at a refinery. */
export const UNLOAD_PER_TICK = 35;
/** Harvesters look for Echo this far (tiles) before a full-map search. */
const LOCAL_SEARCH = 12;
/** Harvesters stay off the fields this long after being shot at (6 s). */
const FLEE_TICKS = 120;
/** Max items per factory queue. */
export const MAX_QUEUE = 15;
/** Garage repair per second, percent of max HP. */
const GARAGE_HEAL_PCT = 3;

export const TABS: readonly Tab[] = ['infantry', 'vehicles', 'air'];

/** Per-tick derived facts about each player (not serialized: recomputed from entities). */
export interface PlayerFacts {
  roles: Map<Role, number>;
  units: number;
  /** Producer structure slots per tab, ascending. */
  producers: number[][];
  refineries: number[];
  /** Construction units alive (deployable into a construction yard). */
  constructionUnits: number;
}

export function computeFacts(world: World): PlayerFacts[] {
  const e = world.entities;
  const facts: PlayerFacts[] = world.players.map(() => ({ roles: new Map(), units: 0, producers: [[], [], []], refineries: [], constructionUnits: 0 }));
  for (const p of world.players) {
    p.powerProduced = 0;
    p.powerUsed = 0;
  }
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    const owner = e.owner[s]!;
    const f = facts[owner]!;
    if (e.kind[s] === KIND.unit) {
      f.units++;
      if (e.type[s] === world.rules.factions[world.players[owner]!.faction]!.constructionUnit) f.constructionUnits++;
      continue;
    }
    if (e.kind[s] !== KIND.structure) continue;
    const rule = world.rules.structures[e.type[s]!]!;
    f.roles.set(rule.role, (f.roles.get(rule.role) ?? 0) + 1);
    const p = world.players[owner]!;
    if (rule.power > 0) p.powerProduced += rule.power;
    else p.powerUsed -= rule.power;
    if (rule.produces) f.producers[TABS.indexOf(rule.produces)]!.push(s);
    if (rule.role === 'refinery') f.refineries.push(s);
  }
  for (const p of world.players) p.lowPower = p.powerUsed > p.powerProduced;
  return facts;
}

export function requirementsMet(facts: PlayerFacts, requires: readonly Role[]): boolean {
  for (const r of requires) if (!facts.roles.get(r)) return false;
  return true;
}

/**
 * Comeback rule: with no construction yard and no construction unit left, a refinery can build
 * the construction unit (normal cost and time), so a surviving economy can always rebuild.
 */
export function emergencyRebuild(world: World, facts: PlayerFacts, player: number, unit: number): boolean {
  return (
    unit === world.rules.factions[world.players[player]!.faction]!.constructionUnit &&
    !facts.roles.get('conyard') &&
    facts.constructionUnits === 0 &&
    facts.refineries.length > 0
  );
}

function speedPct(world: World, p: PlayerState): number {
  return p.lowPower ? world.rules.constants.lowPowerSpeedPct : 100;
}

/**
 * Advance a C&C-style build: spending is continuous and proportional to
 * progress; with too little money the item simply waits. Returns true when done.
 */
function advance(p: PlayerState, q: { progress: number; spent: number }, cost: number, total: number, speed: number): boolean {
  const next = Math.min(total, q.progress + speed);
  const target = idiv(cost * next, total);
  const delta = target - q.spent;
  if (delta > p.credits) return false;
  p.credits -= delta;
  q.spent = target;
  q.progress = next;
  return next >= total;
}

/** Construction yard queues: one structure at a time per category, then wait for placement. */
export function buildSystem(world: World, facts: PlayerFacts[]): void {
  for (const p of world.players) {
    if (p.defeated) continue;
    const f = facts[p.index]!;
    if (!f.roles.get('conyard')) continue;
    for (const q of p.build) {
      if (q.item < 0 || q.ready) continue;
      const rule = world.rules.structures[q.item]!;
      // Rapid Growth: Choir structures grow faster.
      const speed = pct(speedPct(world, p), 100 + upgradePct(world, p.index, 'growSpeedPct'));
      if (advance(p, q, rule.cost, rule.buildTicks * 100, speed)) q.ready = true;
    }
  }
}

/** Factory queues: extra factories of the same type speed the queue up (diminishing). */
export function productionSystem(world: World, facts: PlayerFacts[]): void {
  const c = world.rules.constants;
  for (const p of world.players) {
    if (p.defeated) continue;
    const f = facts[p.index]!;
    for (let tab = 0; tab < 3; tab++) {
      const q = p.production[tab]!;
      const item = q.items[0];
      if (item === undefined) continue;
      const rule = world.rules.units[item]!;
      const emergency = emergencyRebuild(world, f, p.index, item);
      const producers = f.producers[tab]!.length > 0 ? f.producers[tab]! : emergency ? f.refineries : [];
      if (producers.length === 0) continue;
      if (!emergency && !requirementsMet(f, rule.requires)) continue;
      if (f.units >= world.unitCap) continue;
      let bonus = 0;
      for (let i = 0; i < producers.length - 1 && i < c.extraFactoryBonusPct.length; i++) bonus += c.extraFactoryBonusPct[i]!;
      const speed = pct(speedPct(world, p), 100 + bonus);
      if (!advance(p, q, rule.cost, rule.buildTicks * 100, speed)) continue;
      q.items.shift();
      q.progress = 0;
      q.spent = 0;
      emitUnit(world, p.index, producers[0]!, rule);
      p.trained[rule.index]!++;
      f.units++;
    }
  }
}

/** Spawn a finished unit at its factory's exit and send it to the rally point. */
function emitUnit(world: World, owner: number, factory: number, rule: UnitRule): number {
  const e = world.entities;
  const m = world.map;
  const srule = world.rules.structures[e.type[factory]!]!;
  let x: number;
  let y: number;
  if (rule.isAir) {
    x = e.x[factory]!;
    y = e.y[factory]!;
  } else {
    const ex = e.tileX[factory]! + (srule.footprintW >> 1);
    const ey = e.tileY[factory]! + srule.footprintH;
    let tile = ey < m.height ? ey * m.width + ex : -1;
    if (tile < 0 || m.nav[tile] !== 1) tile = world.paths.nearestPassable(Math.min(ey, m.height - 1) * m.width + ex);
    if (tile < 0) tile = e.tileY[factory]! * m.width + e.tileX[factory]!;
    x = ((tile % m.width) << FX_SHIFT) + FX_HALF;
    y = (idiv(tile, m.width) << FX_SHIFT) + FX_HALF;
  }
  const h = spawnUnit(world, rule.index, owner, x, y);
  const s = h & 0xffff;
  if (rule.abilities.some((a) => a.kind === 'harvest')) {
    e.hstate[s] = HARVEST.toField;
    return h;
  }
  // Each new unit walks to its own free spot near the rally point (or just clear of the door),
  // so a stream of reinforcements fans out instead of piling up on one point.
  const rally = e.rallyX[factory]! >= 0;
  const tx = rally ? e.rallyX[factory]! : x;
  const ty = rally ? e.rallyY[factory]! : y + (EXIT_CLEARANCE << FX_SHIFT);
  const spot = rule.isAir ? { x: tx, y: ty } : freeSpotNear(world, owner, s, tx, ty, rule.tab === 'vehicles' ? 2 : 1);
  if (rally || spot.x !== x || spot.y !== y)
    e.orders[s] = [{ type: 'move', x: spot.x, y: spot.y, flow: false, cx: spot.x, cy: spot.y, group: 0, speed: 0 }];
  return h;
}

/** Tiles in front of a factory door that new units clear before stopping. */
const EXIT_CLEARANCE = 2;
/** How far (tiles) to look for a free spot around a rally point. */
const SPOT_SEARCH = 6;

/**
 * The nearest walkable tile center to (x, y) that no unit stands on and no own
 * unit is already walking to. Searched ring by ring in a fixed order (deterministic).
 * Vehicles look on a 2-tile grid and want that much room: a tile apart, their hulls overlap.
 */
function freeSpotNear(world: World, owner: number, self: number, x: number, y: number, step = 1): { x: number; y: number } {
  const e = world.entities;
  const m = world.map;
  // Where own units are already headed (their move orders), so two arrivals don't pick one spot.
  const claimed: number[] = [];
  for (let u = 0; u < e.high; u++) {
    if (u === self || e.alive[u] !== 1 || e.kind[u] !== KIND.unit || e.owner[u] !== owner) continue;
    const o = e.orders[u]![0];
    if (o && o.type === 'move') claimed.push(tileAt(m, o.x, o.y));
  }
  const cx = x >> FX_SHIFT;
  const cy = y >> FX_SHIFT;
  const room = step * FX_ONE - FX_HALF;
  const near = (t: number) => claimed.some((c) => c >= 0 && Math.abs((c % m.width) - (t % m.width)) < step && Math.abs(idiv(c, m.width) - idiv(t, m.width)) < step);
  for (let r = 0; r <= SPOT_SEARCH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t = tileAt(m, ((cx + dx * step) << FX_SHIFT) + FX_HALF, ((cy + dy * step) << FX_SHIFT) + FX_HALF);
        if (t < 0 || m.nav[t] !== 1 || near(t)) continue;
        const px = ((t % m.width) << FX_SHIFT) + FX_HALF;
        const py = (idiv(t, m.width) << FX_SHIFT) + FX_HALF;
        let taken = false;
        world.spatial.query(px, py, room, (n) => {
          if (n !== self && e.kind[n] === KIND.unit && e.hasGoal[n] === 0 && ilength(e.x[n]! - px, e.y[n]! - py) < room) taken = true;
        });
        if (!taken) return { x: px, y: py };
      }
    }
  }
  return { x, y };
}

/** Spawn a refinery's free harvester at its dock. */
export function spawnFreeHarvester(world: World, owner: number, refinery: number): void {
  const faction = world.rules.factions[world.players[owner]!.faction]!;
  const rule = world.rules.units[faction.harvester]!;
  emitUnit(world, owner, refinery, rule);
}

// --- harvesting ---

function harvestCapacity(rule: UnitRule): number {
  for (const a of rule.abilities) if (a.kind === 'harvest') return a.capacity;
  return 0;
}

/** Crystals are worth this many tiles of extra travel each when choosing the richest tile. */
const RICH_WEIGHT = 2;

/** A tile another harvester already works counts as this many tiles farther away (per harvester). */
const CLAIM_PENALTY = 4;
/** Stuck ticks after which a harvester near its tile starts harvesting anyway. */
const STUCK_SETTLE = 40;

/**
 * Best Echo tile within `radius` tiles of (tx, ty). `nearest` picks the closest
 * tile; `richest` trades distance for crystal count (each crystal is worth
 * RICH_WEIGHT tiles of travel). Tiles other harvesters have claimed are
 * penalized so harvesters spread out instead of shoving over one tile.
 * Ties go to the lowest tile index.
 */
export function findEcho(
  world: World,
  tx: number,
  ty: number,
  radius: number,
  mode: number = HARVEST_MODE.nearest,
  claimed: Map<number, number> | null = null,
): number {
  const m = world.map;
  let best = -1;
  let bestScore = 0x7fffffff;
  const x0 = Math.max(0, tx - radius);
  const x1 = Math.min(m.width - 1, tx + radius);
  const y0 = Math.max(0, ty - radius);
  const y1 = Math.min(m.height - 1, ty + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * m.width + x;
      const n = m.echo[i]!;
      if (n === 0) continue;
      const d2 = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      // Scores are compared in quarter-tiles so the richest mode stays integral.
      let score = mode === HARVEST_MODE.richest ? isqrt(d2 * 16) - n * RICH_WEIGHT * 4 : d2;
      const k = claimed ? (claimed.get(i) ?? 0) : 0;
      if (k > 0) score += mode === HARVEST_MODE.richest ? k * CLAIM_PENALTY * 4 : k * CLAIM_PENALTY * CLAIM_PENALTY;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best;
}

/** Where harvesters unload: the open tile nearest the middle of the refinery's front edge. */
function dockPoint(world: World, refinery: number): { x: number; y: number } {
  const e = world.entities;
  const m = world.map;
  const rule = world.rules.structures[e.type[refinery]!]!;
  const tx = e.tileX[refinery]! + (rule.footprintW >> 1);
  const ty = Math.min(m.height - 1, e.tileY[refinery]! + rule.footprintH);
  let tile = ty * m.width + tx;
  if (m.nav[tile] !== 1) tile = world.paths.nearestPassable(tile, 6);
  if (tile < 0) return { x: e.x[refinery]!, y: e.y[refinery]! };
  return { x: ((tile % m.width) << FX_SHIFT) + FX_HALF, y: (idiv(tile, m.width) << FX_SHIFT) + FX_HALF };
}

function nearestRefinery(world: World, facts: PlayerFacts[], s: number): number {
  const e = world.entities;
  let best = -1;
  let bestD = 0;
  for (const r of facts[e.owner[s]!]!.refineries) {
    const d = ilength(e.x[r]! - e.x[s]!, e.y[r]! - e.y[s]!);
    if (best < 0 || d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

function goal(world: World, s: number, x: number, y: number): void {
  const e = world.entities;
  e.goalX[s] = x;
  e.goalY[s] = y;
  e.hasGoal[s] = 1;
}

/**
 * Harvester state machine: field -> harvest -> refinery -> unload -> field.
 * Runs after behavior (which leaves order-less harvesters alone) and before movement.
 */
export function harvestSystem(world: World, facts: PlayerFacts[]): void {
  const e = world.entities;
  const m = world.map;
  const c = world.rules.constants;

  // Release docks whose harvester left or died.
  for (const f of facts) {
    for (const r of f.refineries) {
      const h = e.resolve(e.dock[r]!);
      if (h < 0 || e.hstate[h] !== HARVEST.unloading || e.target[h] !== e.handle(r)) e.dock[r] = NO_ENTITY;
    }
  }

  // Tiles being worked or headed for, by how many harvesters (insertion order is deterministic).
  const claimed = new Map<number, number>();
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit) continue;
    if (e.hstate[s] !== HARVEST.toField && e.hstate[s] !== HARVEST.harvesting) continue;
    const t = e.htile[s]!;
    if (t >= 0) claimed.set(t, (claimed.get(t) ?? 0) + 1);
  }

  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || e.hstate[s] === HARVEST.off) continue;
    if (e.orders[s]!.length > 0) continue;
    const rule = world.rules.units[e.type[s]!]!;
    const cap = harvestCapacity(rule);
    const p = world.players[e.owner[s]!]!;
    const tx = e.x[s]! >> FX_SHIFT;
    const ty = e.y[s]! >> FX_SHIFT;

    // Under fire: run to the refinery (with whatever is loaded) and lie low for a while.
    if (e.lastHitTick[s]! >= 0 && world.tick - e.lastHitTick[s]! <= 2) {
      e.fleeUntil[s] = world.tick + FLEE_TICKS;
      if (e.hstate[s] === HARVEST.toField || e.hstate[s] === HARVEST.harvesting) e.hstate[s] = e.cargo[s]! > 0 ? HARVEST.toRefinery : HARVEST.hiding;
    }

    switch (e.hstate[s]) {
      case HARVEST.hiding: {
        if (world.tick >= e.fleeUntil[s]!) {
          e.hstate[s] = HARVEST.toField;
          break;
        }
        // Wait next to the nearest refinery, off its dock.
        const r = nearestRefinery(world, facts, s);
        if (r >= 0) {
          const d = dockPoint(world, r);
          if (ilength(d.x - e.x[s]!, d.y - e.y[s]!) > 3 * FX_ONE) goal(world, s, d.x, d.y);
        }
        break;
      }
      case HARVEST.toField: {
        if (e.cargo[s]! >= cap) {
          e.hstate[s] = HARVEST.toRefinery;
          break;
        }
        let tile = e.htile[s]!;
        if (tile < 0 || m.echo[tile] === 0) {
          tile = findEcho(world, tx, ty, LOCAL_SEARCH, e.hmode[s], claimed);
          if (tile < 0 && e.htimer[s]!-- <= 0) {
            // Expensive full-map search, at most twice a second.
            tile = findEcho(world, tx, ty, Math.max(m.width, m.height), e.hmode[s], claimed);
            e.htimer[s] = 10;
          }
          e.htile[s] = tile;
          if (tile >= 0) claimed.set(tile, (claimed.get(tile) ?? 0) + 1);
        }
        if (tile < 0) {
          if (e.cargo[s]! > 0) e.hstate[s] = HARVEST.toRefinery;
          break;
        }
        const gx = ((tile % m.width) << FX_SHIFT) + FX_HALF;
        const gy = (idiv(tile, m.width) << FX_SHIFT) + FX_HALF;
        // Harvest from the tile or right next to it; a jostled harvester settles for two tiles.
        const dist = ilength(gx - e.x[s]!, gy - e.y[s]!);
        if (dist <= FX_ONE || (e.stuck[s]! > STUCK_SETTLE && dist <= 2 * FX_ONE)) {
          e.hstate[s] = HARVEST.harvesting;
          e.htimer[s] = HARVEST_TICKS;
        } else goal(world, s, gx, gy);
        break;
      }
      case HARVEST.harvesting: {
        if (--e.htimer[s]! > 0) break;
        e.htimer[s] = HARVEST_TICKS;
        const tile = e.htile[s]!;
        if (tile >= 0 && m.echo[tile]! > 0) {
          m.echo[tile]!--;
          e.cargo[s] = Math.min(cap, e.cargo[s]! + c.echoValuePerCrystal);
        }
        if (e.cargo[s]! >= cap) e.hstate[s] = HARVEST.toRefinery;
        else if (tile < 0 || m.echo[tile] === 0) {
          e.htile[s] = findEcho(world, tx, ty, 3, e.hmode[s], claimed);
          e.hstate[s] = HARVEST.toField;
        }
        break;
      }
      case HARVEST.toRefinery:
      case HARVEST.waiting: {
        let r = e.resolve(e.target[s]!);
        if (r < 0 || e.kind[r] !== KIND.structure || e.owner[r] !== e.owner[s]) {
          r = nearestRefinery(world, facts, s);
          e.target[s] = r >= 0 ? e.handle(r) : NO_ENTITY;
        }
        if (r < 0) break; // no refinery: wait where we are
        const d = dockPoint(world, r);
        if (ilength(d.x - e.x[s]!, d.y - e.y[s]!) <= FX_ONE + FX_HALF || distToBody(world, e.x[s]!, e.y[s]!, r) <= FX_ONE) {
          const holder = e.resolve(e.dock[r]!);
          if (holder < 0 || holder === s) {
            e.dock[r] = e.handle(s);
            e.hstate[s] = HARVEST.unloading;
          } else e.hstate[s] = HARVEST.waiting;
        } else {
          e.hstate[s] = HARVEST.toRefinery;
          goal(world, s, d.x, d.y);
        }
        break;
      }
      case HARVEST.unloading: {
        const amount = Math.min(e.cargo[s]!, UNLOAD_PER_TICK);
        e.cargo[s]! -= amount;
        p.credits += amount + pct(amount, p.incomeBonusPct);
        p.harvested += amount;
        if (e.cargo[s] === 0) {
          const r = e.resolve(e.target[s]!);
          if (r >= 0) e.dock[r] = NO_ENTITY;
          e.target[s] = NO_ENTITY;
          e.hstate[s] = world.tick < e.fleeUntil[s]! ? HARVEST.hiding : HARVEST.toField;
        }
        break;
      }
    }
  }
}

/** Fields regrow one crystal per tile every echoRegrowTicks, up to each tile's cap. */
export function echoRegrowSystem(world: World): void {
  if (world.tick % world.rules.constants.echoRegrowTicks !== 0 || world.tick === 0) return;
  const m = world.map;
  for (let i = 0; i < m.echo.length; i++) if (m.echoCap[i]! > m.echo[i]!) m.echo[i]!++;
}

// --- repair ---

/** Paid structure repair, Garage bays and repair-aura units; runs once per second. */
export function repairSystem(world: World): void {
  const c = world.rules.constants;
  if (world.tick % c.tickRate !== 0) return;
  const e = world.entities;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1) continue;
    if (e.kind[s] === KIND.structure) {
      const rule = world.rules.structures[e.type[s]!]!;
      if (e.repairing[s] === 2) {
        // A Choir far seed growing to full strength, for free.
        e.hp[s] = Math.min(e.maxHp[s]!, e.hp[s]! + Math.max(1, pct(e.maxHp[s]!, CHOIR_SEED_GROW_PCT)));
        if (e.hp[s] === e.maxHp[s]) e.repairing[s] = 0;
      } else if (e.repairing[s] === 1) {
        const p = world.players[e.owner[s]!]!;
        const missing = e.maxHp[s]! - e.hp[s]!;
        if (missing <= 0) e.repairing[s] = 0;
        else {
          const heal = Math.min(missing, Math.max(1, pct(e.maxHp[s]!, c.repairHpPctPerSecond)));
          const cost = Math.max(1, idiv(rule.cost * c.repairCostPct * heal, 100 * e.maxHp[s]!));
          if (p.credits >= cost) {
            p.credits -= cost;
            e.hp[s]! += heal;
          }
        }
      }
      if (rule.repairRadius > 0 && !world.players[e.owner[s]!]!.lowPower) healVehiclesNear(world, s, rule.repairRadius, -GARAGE_HEAL_PCT);
    } else if (e.kind[s] === KIND.unit) {
      const rule = world.rules.units[e.type[s]!]!;
      for (const a of rule.abilities) if (a.kind === 'repairAura') healVehiclesNear(world, s, a.radius, a.hpPerSecond);
    }
  }
}

/** Heal own ground vehicles near `src`. amount > 0 = flat HP, amount < 0 = percent of max HP. */
function healVehiclesNear(world: World, src: number, radius: number, amount: number): void {
  const e = world.entities;
  world.spatial.query(e.x[src]!, e.y[src]!, radius + 2 * FX_ONE, (t) => {
    if (t === src || e.kind[t] !== KIND.unit || e.owner[t] !== e.owner[src]) return;
    const rule = world.rules.units[e.type[t]!]!;
    if (rule.tab !== 'vehicles' || rule.isAir || e.hp[t]! >= e.maxHp[t]!) return;
    if (distToBody(world, e.x[t]!, e.y[t]!, src) > radius) return;
    const heal = amount > 0 ? amount : Math.max(1, pct(e.maxHp[t]!, -amount));
    e.hp[t] = Math.min(e.maxHp[t]!, e.hp[t]! + heal);
  });
}

// --- wrecks ---

/** Ground vehicles leave a wreck that Holdout can salvage. */
export function spawnWreck(world: World, dead: number): void {
  const e = world.entities;
  if (e.kind[dead] !== KIND.unit) return;
  const rule = world.rules.units[e.type[dead]!]!;
  if (rule.tab !== 'vehicles') return;
  const h = e.allocate();
  const s = h & 0xffff;
  e.kind[s] = KIND.wreck;
  e.type[s] = rule.index;
  e.owner[s] = e.owner[dead]!;
  e.x[s] = e.x[dead]!;
  e.y[s] = e.y[dead]!;
  e.radius[s] = rule.radius;
  e.hp[s] = 1;
  e.maxHp[s] = 1;
  e.facing[s] = e.facing[dead]!;
  e.value[s] = rule.cost;
  e.expires[s] = world.tick + world.rules.constants.wreckLifetimeTicks;
}

export function wreckSystem(world: World): void {
  const e = world.entities;
  const collect = world.tick % SALVAGE_INTERVAL === 0;
  for (let s = 0; s < e.high; s++) {
    if (e.alive[s] !== 1 || e.kind[s] !== KIND.wreck) continue;
    if (world.tick >= e.expires[s]!) removeEntity(world, s);
    else if (collect) autoSalvage(world, s);
  }
}

/** How often vehicles pick up wrecks they drive past, ticks. */
const SALVAGE_INTERVAL = 10;
/** How close a vehicle must be to pick up a wreck. */
const SALVAGE_REACH = FX_ONE + FX_HALF;

/** Salvage factions' ground vehicles pick up wrecks they pass, no order needed. */
function autoSalvage(world: World, wreck: number): void {
  const e = world.entities;
  let by = -1;
  world.spatial.query(e.x[wreck]!, e.y[wreck]!, SALVAGE_REACH + FX_ONE, (u) => {
    if (by >= 0 || e.kind[u] !== KIND.unit || e.alive[u] !== 1) return;
    const rule = world.rules.units[e.type[u]!]!;
    if (rule.tab !== 'vehicles' || rule.isAir || salvageValue(world, e.owner[u]!, wreck) <= 0) return;
    if (ilength(e.x[u]! - e.x[wreck]!, e.y[u]! - e.y[wreck]!) <= SALVAGE_REACH) by = u;
  });
  if (by < 0) return;
  const owner = e.owner[by]!;
  const value = salvageValue(world, owner, wreck);
  world.players[owner]!.credits += value;
  pushFx(world, FX_EVENT.credits, value, CREDIT_REASON.salvage, owner, e.x[wreck]!, e.y[wreck]!, 0, 0);
  removeEntity(world, wreck);
}

/** Credits a salvaging unit's owner gets for a wreck (0 for factions without salvage). */
export function salvageValue(world: World, player: number, wreck: number): number {
  const faction = world.rules.factions[world.players[player]!.faction]!;
  return pct(world.entities.value[wreck]!, pct(faction.salvagePct, 100 + upgradePct(world, player, 'salvagePct')));
}
