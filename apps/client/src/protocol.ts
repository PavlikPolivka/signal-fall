import type { Command } from '@signal-fall/sim';

/** What the worker should set up. */
export type ScenarioSpec =
  | { kind: 'sandbox'; unitsPerSide: number; seed: number }
  | { kind: 'stress'; unitsPerSide: number; seed: number };

export type ToWorker =
  | { type: 'start'; scenario: ScenarioSpec; localPlayer: number }
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
      players: PlayerInfo[];
      localPlayer: number;
    }
  | { type: 'snapshot'; buf: ArrayBuffer; fog: Uint8Array | null };

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

export const P = { credits: 0, defeated: 1 } as const;
export const PLAYER_STRIDE = 4;

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
} as const;
export const ENT_STRIDE = 20;

export const PR = { ox: 0, oy: 1, x: 2, y: 3, type: 4, ticks: 5, total: 6 } as const;
export const PROJ_STRIDE = 7;

export const ORDER_CODE = { move: 1, attackMove: 2, attack: 3, patrol: 4, guard: 5 } as const;

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
  credits(player: number): number {
    return this.a[HEADER_LEN + player * PLAYER_STRIDE + P.credits]!;
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
