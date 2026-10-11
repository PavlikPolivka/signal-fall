import type { Command } from '@signal-fall/sim';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
import type { Difficulty } from '@signal-fall/ai';

/** What the worker should set up. */
export type ScenarioSpec =
  | {
      kind: 'skirmish';
      seed: number;
      factions: number[];
      /** AI difficulty per player slot, null for the human. */
      ai: (Difficulty | null)[];
      map: { size: MapSize; biome: Biome; resources: Resources; terrain: TerrainStyle };
    }
  | { kind: 'sandbox'; unitsPerSide: number; seed: number }
  | { kind: 'stress'; unitsPerSide: number; seed: number };

export type ToWorker =
  | { type: 'start'; scenario: ScenarioSpec; localPlayer: number; /** Game speed multiplier (tests). */ speed?: number }
  | { type: 'command'; cmd: Command }
  | { type: 'pause'; paused: boolean };

export interface PlayerInfo {
  faction: number;
  team: number;
}

export type FromWorker =
  | {
      type: 'ready';
      width: number;
      height: number;
      terrain: Uint8Array;
      decoration: Uint8Array;
      /** Cosmetic ground surface (mapgen SURFACE) and landmark kind (mapgen LANDMARK) per tile. */
      surface: Uint8Array;
      landmark: Uint8Array;
      biome: Biome;
      /** Seed that actually produced the map (after validation retries). */
      mapSeed: number;
      players: PlayerInfo[];
      localPlayer: number;
    }
  | { type: 'snapshot'; buf: ArrayBuffer; fog: Uint8Array | null; echo: Uint8Array | null };

// Snapshot layout (Int32Array):
//   header (HEADER_LEN), then players (PLAYER_STRIDE each), entities (ENT_STRIDE each),
//   projectiles (PROJ_STRIDE each).
export const H = {
  tick: 0,
  ended: 1,
  winnerTeam: 2,
  entityCount: 3,
  projectileCount: 4,
  playerCount: 5,
  stalled: 6,
} as const;
export const HEADER_LEN = 8;

export const P = {
  credits: 0,
  defeated: 1,
  powerProduced: 2,
  powerUsed: 3,
  lowPower: 4,
  /** Build queues: [structures, defenses] x (item, progress per mille, ready). */
  build: 8,
  /** Production queues: [infantry, vehicles, air] x (progress per mille, then QUEUE_SLOTS items, -1 = empty). */
  production: 14,
} as const;
export const QUEUE_SLOTS = 15;
export const PROD_STRIDE = 1 + QUEUE_SLOTS;
export const PLAYER_STRIDE = P.production + 3 * PROD_STRIDE;

export const E = {
  handle: 0,
  kind: 1,
  type: 2,
  owner: 3,
  x: 4,
  y: 5,
  hp: 6,
  maxHp: 7,
  shields: 8,
  maxShields: 9,
  facing: 10,
  rank: 11,
  vx: 12,
  vy: 13,
  /** 0 none, 1 move, 2 attackMove, 3 attack, 4 patrol, 5 guard */
  order: 14,
  orderX: 15,
  orderY: 16,
  stance: 17,
  target: 18,
  orderCount: 19,
  tileX: 20,
  tileY: 21,
  repairing: 22,
  hstate: 23,
  cargo: 24,
  rallyX: 25,
  rallyY: 26,
  hmode: 27,
  /** Up to 3 further queued order points (x, y pairs), -1 when absent. */
  wp: 28,
} as const;
export const WAYPOINTS = 3;
export const ENT_STRIDE = 28 + WAYPOINTS * 2;

export const PR = { ox: 0, oy: 1, x: 2, y: 3, type: 4, ticks: 5, total: 6 } as const;
export const PROJ_STRIDE = 7;

export const ORDER_CODE = { move: 1, attackMove: 2, attack: 3, patrol: 4, guard: 5, salvage: 6 } as const;

/** Read-only view of one decoded snapshot. */
export class Snapshot {
  readonly a: Int32Array;
  readonly entityBase: number;
  readonly projBase: number;
  /** handle -> entity record offset */
  readonly index = new Map<number, number>();

  constructor(buf: ArrayBuffer) {
    this.a = new Int32Array(buf);
    this.entityBase = HEADER_LEN + this.a[H.playerCount]! * PLAYER_STRIDE;
    this.projBase = this.entityBase + this.a[H.entityCount]! * ENT_STRIDE;
    for (let i = 0; i < this.entityCount; i++) {
      const off = this.entityBase + i * ENT_STRIDE;
      this.index.set(this.a[off + E.handle]!, off);
    }
  }

  get tick(): number {
    return this.a[H.tick]!;
  }
  get entityCount(): number {
    return this.a[H.entityCount]!;
  }
  get projectileCount(): number {
    return this.a[H.projectileCount]!;
  }
  /** Field of a player record. */
  player(player: number, field: number): number {
    return this.a[HEADER_LEN + player * PLAYER_STRIDE + field]!;
  }
  credits(player: number): number {
    return this.player(player, P.credits);
  }
  /** Build queue state for category 0 (structures) or 1 (defenses). */
  buildQueue(player: number, cat: number): { item: number; progress: number; ready: boolean } {
    const o = P.build + cat * 3;
    return { item: this.player(player, o), progress: this.player(player, o + 1), ready: this.player(player, o + 2) === 1 };
  }
  /** Production queue for tab 0..2. progress is per mille of the first item. */
  productionQueue(player: number, tab: number): { progress: number; items: number[] } {
    const o = P.production + tab * PROD_STRIDE;
    const items: number[] = [];
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      const v = this.player(player, o + 1 + i);
      if (v >= 0) items.push(v);
    }
    return { progress: this.player(player, o), items };
  }
  /** Offset of entity i. */
  ent(i: number): number {
    return this.entityBase + i * ENT_STRIDE;
  }
  proj(i: number): number {
    return this.projBase + i * PROJ_STRIDE;
  }
  get(off: number, field: number): number {
    return this.a[off + field]!;
  }
}
