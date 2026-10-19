import { POINT, type CapturePoint } from './systems/points';
import { makeCrates, type Crate } from './systems/crates';
import { makeSurvival, type SurvivalState } from './systems/survival';
import { makeMission, type MissionRules, type MissionState } from './systems/mission';
import type { FactionIdx, Rules } from '@signal-fall/data';
import { Entities } from './entities';
import { IntWriter } from './hash';
import { createMap, type GameMap } from './map';
import { Pathfinder } from './path';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';

export interface PlayerSetup {
  faction: FactionIdx;
  team: number;
}

/** Construction yard queue for one category (structures or defenses): one item at a time. */
export interface BuildQueue {
  /** Structure rule index, or -1 when idle. */
  item: number;
  /** Work done, in percent-ticks (total = buildTicks * 100). */
  progress: number;
  /** Credits spent on the item so far. */
  spent: number;
  /** Finished and waiting to be placed. */
  ready: boolean;
  /** Place-first: where it goes when finished (footprint origin), -1 if not chosen yet. */
  atX: number;
  atY: number;
  /** Ticks spent trying to place it there (units in the way); gives up after a while. */
  atTries: number;
}

/** Factory queue for one tab (infantry, vehicles, air): items built in order. */
export interface ProductionQueue {
  /** Unit rule indices; items[0] is in progress. */
  items: number[];
  progress: number;
  spent: number;
}

export interface PlayerState {
  index: number;
  faction: FactionIdx;
  team: number;
  credits: number;
  defeated: boolean;
  surrendered: boolean;
  powerProduced: number;
  powerUsed: number;
  lowPower: boolean;
  /** [structures, defenses] */
  build: BuildQueue[];
  /** [infantry, vehicles, air] */
  production: ProductionQueue[];
  /** Brutal AI income bonus (percent), 0 for everyone else. */
  incomeBonusPct: number;
  /** Stats. */
  harvested: number;
  /** Units and structures lost / destroyed: counts and their cost (value). */
  stats: { unitsLost: number; unitsKilled: number; structuresLost: number; structuresKilled: number; valueLost: number; valueKilled: number };
  /** Units completed per unit rule index. */
  trained: number[];
  /** 1 per researched upgrade (rules.upgrades index). */
  upgrades: number[];
  /** Standing plan for an autopilot (AI agents), null until one is set. */
  directives: import('./directives').Directives | null;
  /** Upgrade being researched (-1 none), paid continuously like construction. */
  research: { item: number; progress: number; spent: number };
  /** Tick from which the faction's support power can be cast again. */
  powerReady: number;
  /** Superweapon: ticks charged while one stands, and the pending strike (at = -1 none). */
  superCharge: number;
  strike: { x: number; y: number; at: number };
}

export const BUILD_CATEGORY_INDEX = { structures: 0, defenses: 1 } as const;
export const TAB_INDEX = { infantry: 0, vehicles: 1, air: 2 } as const;

export interface Projectile {
  owner: number;
  /** Where it was fired from and its total flight time, for rendering. */
  ox: number;
  oy: number;
  total: number;
  source: number;
  target: number;
  /** Impact point (tracks the target while it lives). */
  x: number;
  y: number;
  damage: number;
  type: number;
  splash: number;
  hitsGround: boolean;
  hitsAir: boolean;
  ticks: number;
  /** Chain lightning: further targets to jump to, and the damage kept per jump (percent). */
  chainJumps: number;
  chainPct: number;
  /** Sweeping beam: damages enemies within this distance of the firing line (Q10), 0 = none. */
  sweep: number;
}

/** Fog bits per tile and player. */
/**
 * Cosmetic events for renderers and audio, FX_STRIDE ints each: [kind, a, b, owner, x, y, tx, ty].
 * fire:   a = shooter kind, b = shooter rule index, (x, y) muzzle, (tx, ty) target point
 * impact: a = damage type, b = splash radius, (x, y) impact point
 * death:  a = entity kind, b = rule index, (x, y) where it died
 * ability: a = 1 blink / 2 phase / 3 override / 4 dig in / 5 uplink, b = unit rule index, (x, y) from, (tx, ty) to
 * power:   a = 1 jam / 2 awaken, b = radius (Q10), owner cast it, (x, y) where
 * mission: a = line index (a mission 'say' action)
 * credits: a = amount, b = 1 recompile / 2 salvage / 3 crate (a < 0: crate kind -a), owner gets them, (x, y) where
 * The sim only appends; it never reads them, so they cannot affect determinism.
 */
export const FX_EVENT = { fire: 1, impact: 2, death: 3, ability: 4, credits: 5, power: 6, mission: 7, superweapon: 8 } as const;
/** Why credits were gained (FX_EVENT.credits b). */
export const CREDIT_REASON = { recompile: 1, salvage: 2, crate: 3 } as const;
export const FX_STRIDE = 8;
/** Events kept when nobody drains them (headless runs). */
const FX_CAP = FX_STRIDE * 4096;

export function pushFx(world: World, kind: number, a: number, b: number, owner: number, x: number, y: number, tx: number, ty: number): void {
  if (world.fx.length >= FX_CAP) world.fx.length = 0;
  world.fx.push(kind, a, b, owner, x, y, tx, ty);
}

export const FOG_VISIBLE = 1;
export const FOG_EXPLORED = 2;
/** Fog is recomputed every this many ticks. */
export const FOG_INTERVAL = 4;

/** Derived PRNG stream ids. */
export const STREAM = { combat: 1, ai: 100 } as const;

export interface World {
  rules: Rules;
  seed: number;
  tick: number;
  map: GameMap;
  entities: Entities;
  spatial: SpatialGrid;
  paths: Pathfinder;
  projectiles: Projectile[];
  /** Cosmetic event log (FX_EVENT), drained by the client; not part of the state. */
  fx: number[];
  /** Network coverage per player (tile = 1), rebuilt on a fixed tick cadence from structures. */
  coverage: Uint8Array[];
  /** fog[player][tile] = FOG_* bits. */
  fog: Uint8Array[];
  players: PlayerState[];
  rng: Rng;
  /** One stream per AI player, indexed by player index. */
  aiRng: Rng[];
  nextGroup: number;
  /** When false, nobody is ever defeated by losing everything (scenario tests). */
  victoryRules: boolean;
  ended: boolean;
  /** Winning team, or -1 for none/draw. */
  winnerTeam: number;
  /**
   * Derived each tick (not serialized): damage already in flight per target
   * slot, after the damage matrix. Used for overkill avoidance.
   */
  pending: Map<number, number>;
  /** Derived each tick: progress of each formation group (move/attack-move orders). */
  groups: Map<number, GroupInfo>;
  /** Capture points on the map (none on most maps). */
  points: CapturePoint[];
  /** A campaign mission: its objectives and triggers, or null. */
  mission: MissionState | null;
  /** Mission unlocks: rule ids the player (slot 0) may build or train, or null for everything. */
  allow: Set<string> | null;
  /** Survival: the horde's waves, or null. */
  survival: SurvivalState | null;
  /** King of the hill: ticks each team has held the hill (indexed by team). */
  hillScore: number[];
  /** Crates (an optional setting), or null. */
  crates: { rng: Rng; list: Crate[] } | null;
}

export interface GroupInfo {
  /** Remaining distance to own slot: min, median and max over members (Q10). */
  minRem: number;
  medRem: number;
  maxRem: number;
  /** Some member was hit in the last few ticks. */
  underFire: boolean;
  /** Some member is fighting (has a target). */
  engaged: boolean;
}

export interface WorldOptions {
  rules: Rules;
  seed: number;
  width: number;
  height: number;
  players: PlayerSetup[];
  terrain?: Uint8Array;
  /** Initial Echo crystals per tile (also each tile's regrowth cap). */
  echo?: Uint8Array;
  /** 1 on road tiles. */
  road?: Uint8Array;
  victoryRules?: boolean;
  /** Capture points (tile and POINT kind). */
  points?: { x: number; y: number; kind: number }[];
  /** Crates drop on the map now and then. */
  crates?: boolean;
  /** Survival: this player is the horde. */
  survivalHorde?: number;
  /** A campaign mission's objectives and triggers (positions already in tiles). */
  mission?: MissionRules;
  /** Mission unlocks for the player (slot 0). */
  allow?: string[];
  /** Survival wave size, percent of normal. */
  survivalPct?: number;
}

export function createWorld(o: WorldOptions): World {
  const map = createMap(o.width, o.height, o.terrain, o.echo, o.road);
  return {
    rules: o.rules,
    seed: o.seed >>> 0,
    tick: 0,
    map,
    entities: new Entities(),
    spatial: new SpatialGrid(o.width, o.height),
    paths: new Pathfinder(map),
    projectiles: [],
    fx: [],
    coverage: o.players.map(() => new Uint8Array(o.width * o.height)),
    fog: o.players.map(() => new Uint8Array(o.width * o.height)),
    players: o.players.map((p, index) => ({
      index,
      faction: p.faction,
      team: p.team,
      credits: o.rules.constants.startCredits,
      defeated: false,
      surrendered: false,
      powerProduced: 0,
      powerUsed: 0,
      lowPower: false,
      build: [0, 1].map(() => ({ item: -1, progress: 0, spent: 0, ready: false, atX: -1, atY: -1, atTries: 0 })),
      production: [0, 1, 2].map(() => ({ items: [], progress: 0, spent: 0 })),
      incomeBonusPct: 0,
      directives: null,
      harvested: 0,
      stats: { unitsLost: 0, unitsKilled: 0, structuresLost: 0, structuresKilled: 0, valueLost: 0, valueKilled: 0 },
      trained: o.rules.units.map(() => 0),
      upgrades: o.rules.upgrades.map(() => 0),
      research: { item: -1, progress: 0, spent: 0 },
      powerReady: 0,
      superCharge: 0,
      strike: { x: 0, y: 0, at: -1 },
    })),
    rng: Rng.derive(o.seed, STREAM.combat),
    aiRng: o.players.map((_, i) => Rng.derive(o.seed, STREAM.ai + i)),
    nextGroup: 1,
    victoryRules: o.victoryRules ?? true,
    ended: false,
    winnerTeam: -1,
    pending: new Map(),
    groups: new Map(),
    points: (o.points ?? []).map((p) => ({ x: p.x, y: p.y, kind: p.kind, owner: -1, capturer: -1, progress: 0 })),
    crates: o.crates ? makeCrates(o.seed) : null,
    hillScore: o.players.map(() => 0),
    mission: o.mission ? makeMission(o.mission) : null,
    allow: o.allow ? new Set(o.allow) : null,
    survival: o.survivalHorde !== undefined ? makeSurvival(o.seed, o.survivalHorde, o.survivalPct) : null,
  };
}

/**
 * Serialize the full authoritative sim state into w, in a fixed order. Derived
 * caches (spatial grid, flow fields, nav) are excluded; fog is included since
 * targeting depends on its timing.
 */
export function serializeWorld(world: World, w: IntWriter): void {
  w.push(world.seed);
  w.push(world.tick);
  w.push(world.map.width);
  w.push(world.map.height);
  w.push(world.map.navVersion);
  w.pushArray(world.rng.s);
  w.push(world.nextGroup);
  w.push(world.ended ? 1 : 0);
  w.push(world.winnerTeam);
  w.push(world.players.length);
  for (const p of world.players) {
    w.push(p.faction);
    w.push(p.team);
    w.push(p.credits);
    w.push(p.defeated ? 1 : 0);
    w.push(p.surrendered ? 1 : 0);
    w.push(p.powerProduced);
    w.push(p.powerUsed);
    w.push(p.lowPower ? 1 : 0);
    w.push(p.incomeBonusPct);
    w.push(p.harvested);
    const st = p.stats;
    w.push(st.unitsLost);
    w.push(st.unitsKilled);
    w.push(st.structuresLost);
    w.push(st.structuresKilled);
    w.push(st.valueLost);
    w.push(st.valueKilled);
    w.pushArray(p.trained);
    w.pushArray(p.upgrades);
    w.push(p.research.item);
    w.push(p.powerReady);
    w.push(p.superCharge);
    w.push(p.strike.x);
    w.push(p.strike.y);
    w.push(p.strike.at);
    w.push(p.research.progress);
    w.push(p.research.spent);
    for (const b of p.build) {
      w.push(b.item);
      w.push(b.progress);
      w.push(b.spent);
      w.push(b.ready ? 1 : 0);
      w.push(b.atX);
      w.push(b.atY);
      w.push(b.atTries);
    }
    for (const q of p.production) {
      w.push(q.items.length);
      w.pushArray(q.items);
      w.push(q.progress);
      w.push(q.spent);
    }
  }
  w.pushArray(world.map.echo);
  for (const r of world.aiRng) w.pushArray(r.s);
  world.entities.serialize(w);
  if (world.mission) {
    for (const v of world.mission.status) w.push(v);
    for (const v of world.mission.next) w.push(v);
    for (const v of world.mission.held) w.push(v);
    for (const v of world.mission.fired) w.push(v);
  }
  if (world.survival) {
    w.push(world.survival.wave);
    w.push(world.survival.nextTick);
    w.pushArray(world.survival.rng.s);
  }
  // Only matches with crates carry them (other states hash exactly as before).
  if (world.crates) {
    w.pushArray(world.crates.rng.s);
    for (const c of world.crates.list) {
      w.push(c.x);
      w.push(c.y);
      w.push(c.kind);
    }
  }
  // Only maps with capture points carry them (other states hash exactly as before).
  if (world.points.some((p) => p.kind === POINT.hill)) for (const v of world.hillScore) w.push(v);
  for (const p of world.points) {
    w.push(p.owner);
    w.push(p.capturer);
    w.push(p.progress);
  }
  w.push(world.projectiles.length);
  for (const p of world.projectiles) {
    w.push(p.owner);
    w.push(p.ox);
    w.push(p.oy);
    w.push(p.total);
    w.push(p.source);
    w.push(p.target);
    w.push(p.x);
    w.push(p.y);
    w.push(p.damage);
    w.push(p.type);
    w.push(p.splash);
    w.push((p.hitsGround ? 1 : 0) | (p.hitsAir ? 2 : 0));
    w.push(p.ticks);
    w.push(p.chainJumps);
    w.push(p.chainPct);
    w.push(p.sweep);
  }
  // Fog: pack visible bits of each player, 32 tiles per word.
  for (const f of world.fog) {
    let word = 0;
    for (let i = 0; i < f.length; i++) {
      if (f[i]! & FOG_VISIBLE) word |= 1 << (i & 31);
      if ((i & 31) === 31) {
        w.push(word);
        word = 0;
      }
    }
    w.push(word);
  }
}

export function serializeToWriter(world: World): IntWriter {
  const w = new IntWriter();
  serializeWorld(world, w);
  return w;
}
