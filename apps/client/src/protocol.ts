import type { Command, ScheduledCommand } from '@signal-fall/sim';
import type { Biome } from '@signal-fall/mapgen';
import type { NetMessage } from '@signal-fall/net';
import type { MatchStats, Replay, ScenarioSpec } from './game/scenario';

export type { ScenarioSpec };

/** What a requested replay is for: a file download, the save slot, or the recent-matches list. */
export type ReplayPurpose = 'download' | 'save' | 'autosave' | 'recent';

export type ToWorker =
  | {
      type: 'start';
      scenario: ScenarioSpec;
      localPlayer: number;
      /** Game speed multiplier (tests). */
      speed?: number;
      /** Multiplayer: the human peers' player slots; lockstep messages travel through 'net' messages. */
      net?: { peers: number[] };
      /** Watch a recorded match instead of playing. */
      replay?: Replay;
      /** The replay is a match still being played: more arrives in 'live' messages. */
      live?: boolean;
      /** Continue a saved skirmish: fast-forward through its orders, then play on. */
      resume?: Replay;
      /** Rejoin a running multiplayer match: what the others played and hold (see CatchupMessage). */
      rejoin?: { log: ScheduledCommand[]; taken: number; inputs: [number, number, Command[]][]; ownNext: number };
    }
  | { type: 'speed'; speed: number }
  /**
   * Live spectating: more of a match being played elsewhere (an agent server).
   * The worker plays recorded commands up to `until` and waits there for more;
   * `hash` arrives with the end, to verify the final state like a replay.
   */
  | { type: 'live'; commands: ScheduledCommand[]; until: number; hash?: number }
  /** Ask for the match so far as a replay file. */
  | { type: 'saveReplay'; purpose?: ReplayPurpose }
  /** Ask for the statistics so far (match report mid-game or after a replay). */
  | { type: 'requestStats' }
  | { type: 'command'; cmd: Command }
  | { type: 'pause'; paused: boolean }
  /** Multiplayer: vote to let the AI take over a person who left. */
  | { type: 'dropPeer'; player: number }
  /** Multiplayer: a player reconnects; send what they need to catch up. */
  | { type: 'catchupRequest' }
  /** Multiplayer: their new link is up; send our turns from `from` on again (some went down the dead link). */
  | { type: 'resendOwn'; from: number }
  /** A lockstep message from a remote peer. */
  | { type: 'net'; msg: NetMessage };

export interface PlayerInfo {
  faction: number;
  team: number;
}

export type FromWorker =
  /** Everyone agreed: this person is gone and the AI plays their seat. */
  | { type: 'dropped'; player: number }
  /** What a reconnecting player needs: orders played so far, and inputs held for later turns. */
  | { type: 'catchup'; log: ScheduledCommand[]; taken: number; inputs: [number, number, Command[]][] }
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
  | {
      type: 'snapshot';
      buf: ArrayBuffer;
      fog: Uint8Array | null;
      echo: Uint8Array | null;
      /** Cosmetic events since the last snapshot (sim FX_EVENT records, FX_STRIDE ints each). */
      fx: Int32Array | null;
    }
  /** A lockstep message for the remote peers. */
  | { type: 'net'; msg: NetMessage }
  | { type: 'replay'; json: string; purpose: ReplayPurpose }
  /** The match's statistics (sent when it ends, or on request). */
  | { type: 'stats'; stats: MatchStats }
  /** The match ended (live play, not replays): for the match record. */
  | { type: 'final'; tick: number; hash: number; winnerTeam: number }
  /** Replay reached its recorded end: did the state hash match the recording? */
  | { type: 'replayEnd'; tick: number; ok: boolean }
  /** Multiplayer status: input delay, round trip, who we are waiting on. */
  | { type: 'netStatus'; delayTurns: number; rtt: number; waitingOn: number[] }
  /** State hashes disagreed: the match has diverged. `report` is a JSON replay for the bug report. */
  | { type: 'desync'; tick: number; local: number; remote: number; player: number; report: string };

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
  pointCount: 7,
  crateCount: 8,
  /** Survival: waves sent, waves in all, ticks to the next (or -1). */
  wave: 9,
  waves: 10,
  waveIn: 11,
  /** Campaign mission: how many objectives (their status follows the crates). */
  objectives: 12,
  /** Campaign mission: map markers for pending objectives (after the statuses, MARKER_STRIDE each). */
  markers: 13,
} as const;
/** Objective markers: [objective, kind (sim MARKER), x, y (Q10), radius in tiles]. */
export const MARKER_STRIDE = 5;
/** Crates after the capture points: [x, y, kind]. */
export const CRATE_STRIDE = 3;
/** Capture points after the projectiles: [x, y, kind, owner, capturer team, progress ticks]. */
export const POINT_STRIDE = 6;
export const HEADER_LEN = 14;

export const P = {
  credits: 0,
  defeated: 1,
  powerProduced: 2,
  powerUsed: 3,
  lowPower: 4,
  /** Upgrade being researched (-1 none) and its progress per mille. */
  researchItem: 5,
  researchProgress: 6,
  /** Bit i set = upgrade i researched. */
  upgrades: 7,
  /** Build queues: [structures, defenses] x (item, progress per mille, ready, planned tile x, y or -1). */
  build: 8,
  /** Production queues: [infantry, vehicles, air] x (progress per mille, then QUEUE_SLOTS items, -1 = empty). */
  production: 18,
} as const;
export const QUEUE_SLOTS = 15;
export const BUILD_STRIDE = 5;
export const PROD_STRIDE = 1 + QUEUE_SLOTS;
/** Support power: -2 none, -1 unavailable, 0 ready, else ticks left (after the production queues). */
export const P_POWER = P.production + 3 * PROD_STRIDE;
/** Echo harvested over the match (income readout). */
export const P_HARVESTED = P_POWER + 1;
/** King of the hill: ticks this player's team has held the hill. */
export const P_HILL = P_POWER + 2;
/** Superweapon (public): -2 none in the faction, -1 none built, 0 ready, else ticks left. */
export const P_SUPER = P_POWER + 3;
/** Pending superweapon strike: target x, y (Q10) and ticks until impact (-1 none). */
export const P_STRIKE_X = P_POWER + 4;
export const P_STRIKE_Y = P_POWER + 5;
export const P_STRIKE_LEFT = P_POWER + 6;
export const PLAYER_STRIDE = P_POWER + 7;

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
  /** Ticks until the active ability is ready again (0 = ready). */
  abilityLeft: 34,
  /** ENT_FLAG bits. */
  flags: 35,
} as const;
export const WAYPOINTS = 3;
export const ENT_STRIDE = 36;
export const ENT_FLAG = { phased: 1, overridden: 2, covered: 4, digging: 8, dugIn: 16, jammed: 32, uplink: 64, garrisoned: 128, poweredDown: 256 } as const;

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
  /** Capture points on this map (empty on most). */
  points(): { x: number; y: number; kind: number; owner: number; capturer: number; progress: number }[] {
    const out = [];
    const base = this.projBase + this.projectileCount * PROJ_STRIDE;
    for (let i = 0; i < (this.a[H.pointCount] ?? 0); i++) {
      const o = base + i * POINT_STRIDE;
      out.push({ x: this.a[o]!, y: this.a[o + 1]!, kind: this.a[o + 2]!, owner: this.a[o + 3]!, capturer: this.a[o + 4]!, progress: this.a[o + 5]! });
    }
    return out;
  }
  /** Mission objectives: 0 pending, 1 done, 2 failed. */
  objectives(): number[] {
    const base = this.projBase + this.projectileCount * PROJ_STRIDE + (this.a[H.pointCount] ?? 0) * POINT_STRIDE + (this.a[H.crateCount] ?? 0) * CRATE_STRIDE;
    return Array.from(this.a.subarray(base, base + (this.a[H.objectives] ?? 0)));
  }
  /** Where the pending mission objectives are: areas, targets and units to protect. */
  markers(): { objective: number; kind: number; x: number; y: number; r: number }[] {
    const out = [];
    const base = this.projBase + this.projectileCount * PROJ_STRIDE + (this.a[H.pointCount] ?? 0) * POINT_STRIDE + (this.a[H.crateCount] ?? 0) * CRATE_STRIDE + (this.a[H.objectives] ?? 0);
    for (let i = 0; i < (this.a[H.markers] ?? 0); i++) {
      const o = base + i * MARKER_STRIDE;
      out.push({ objective: this.a[o]!, kind: this.a[o + 1]!, x: this.a[o + 2]!, y: this.a[o + 3]!, r: this.a[o + 4]! });
    }
    return out;
  }
  /** Crates lying on the map (only with the crates setting). */
  crates(): { x: number; y: number; kind: number }[] {
    const out = [];
    const base = this.projBase + this.projectileCount * PROJ_STRIDE + (this.a[H.pointCount] ?? 0) * POINT_STRIDE;
    for (let i = 0; i < (this.a[H.crateCount] ?? 0); i++) {
      const o = base + i * CRATE_STRIDE;
      out.push({ x: this.a[o]!, y: this.a[o + 1]!, kind: this.a[o + 2]! });
    }
    return out;
  }
  /** Field of a player record. */
  player(player: number, field: number): number {
    return this.a[HEADER_LEN + player * PLAYER_STRIDE + field]!;
  }
  credits(player: number): number {
    return this.player(player, P.credits);
  }
  /** Build queue state for category 0 (structures) or 1 (defenses). */
  buildQueue(player: number, cat: number): { item: number; progress: number; ready: boolean; at: { tx: number; ty: number } | null } {
    const o = P.build + cat * BUILD_STRIDE;
    const tx = this.player(player, o + 3);
    return {
      item: this.player(player, o),
      progress: this.player(player, o + 1),
      ready: this.player(player, o + 2) === 1,
      at: tx >= 0 ? { tx, ty: this.player(player, o + 4) } : null,
    };
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
