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

export interface PlayerState {
  index: number;
  faction: FactionIdx;
  team: number;
  credits: number;
  defeated: boolean;
  surrendered: boolean;
}

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
}

/** Fog bits per tile and player. */
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
}

export interface WorldOptions {
  rules: Rules;
  seed: number;
  width: number;
  height: number;
  players: PlayerSetup[];
  terrain?: Uint8Array;
  victoryRules?: boolean;
}

export function createWorld(o: WorldOptions): World {
  const map = createMap(o.width, o.height, o.terrain);
  return {
    rules: o.rules,
    seed: o.seed >>> 0,
    tick: 0,
    map,
    entities: new Entities(),
    spatial: new SpatialGrid(o.width, o.height),
    paths: new Pathfinder(map),
    projectiles: [],
    fog: o.players.map(() => new Uint8Array(o.width * o.height)),
    players: o.players.map((p, index) => ({
      index,
      faction: p.faction,
      team: p.team,
      credits: o.rules.constants.startCredits,
      defeated: false,
      surrendered: false,
    })),
    rng: Rng.derive(o.seed, STREAM.combat),
    aiRng: o.players.map((_, i) => Rng.derive(o.seed, STREAM.ai + i)),
    nextGroup: 1,
    victoryRules: o.victoryRules ?? true,
    ended: false,
    winnerTeam: -1,
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
  }
  for (const r of world.aiRng) w.pushArray(r.s);
  world.entities.serialize(w);
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
