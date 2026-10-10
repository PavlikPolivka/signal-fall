import type { IntWriter } from './hash';

/** Entity kinds. */
export const KIND = { none: 0, unit: 1, structure: 2 } as const;

/** Unit stance. */
export const STANCE = { normal: 0, hold: 1 } as const;

/**
 * Orders are plain data. A unit executes orders[0]; when it completes it is
 * shifted off. Positions are Q10 world coordinates.
 */
export type Order =
  | { type: 'move'; x: number; y: number; flow: boolean; cx: number; cy: number }
  | { type: 'attackMove'; x: number; y: number; flow: boolean; cx: number; cy: number }
  /** x, y = target's last known position, used when it dies or vanishes into fog. */
  | { type: 'attack'; target: number; x: number; y: number }
  | { type: 'patrol'; ax: number; ay: number; bx: number; by: number; toB: boolean }
  | { type: 'guard'; target: number };

export const SLOT_BITS = 16;
export const MAX_SLOTS = 1 << SLOT_BITS;
const SLOT_MASK = MAX_SLOTS - 1;
export const NO_ENTITY = -1;

/**
 * Structure-of-arrays entity store. An entity is addressed by a handle =
 * slot | (generation << 16); stale handles fail `valid()`. Systems iterate
 * slots 0..high in ascending order, which is the canonical sim order.
 */
export class Entities {
  capacity: number;
  /** One past the highest slot ever used. */
  high = 0;
  private freeSlots: number[] = [];

  alive!: Uint8Array;
  gen!: Uint16Array;
  kind!: Uint8Array;
  /** Rule index into rules.units or rules.structures depending on kind. */
  type!: Int16Array;
  owner!: Int8Array;
  x!: Int32Array;
  y!: Int32Array;
  radius!: Int32Array;
  hp!: Int32Array;
  maxHp!: Int32Array;
  shields!: Int32Array;
  maxShields!: Int32Array;
  facing!: Int16Array;
  cooldown!: Int32Array;
  target!: Int32Array;
  lastAttacker!: Int32Array;
  lastHitTick!: Int32Array;
  xp!: Int32Array;
  rank!: Uint8Array;
  stance!: Uint8Array;
  anchorX!: Int32Array;
  anchorY!: Int32Array;
  /** Movement goal for this tick (computed by behavior). */
  goalX!: Int32Array;
  goalY!: Int32Array;
  hasGoal!: Uint8Array;
  /** Path waypoint cursor; path tiles are in `paths`. */
  pathIdx!: Int32Array;
  /** Target tile index of the path or flow field in use, -1 if none. */
  pathGoal!: Int32Array;
  stuck!: Int32Array;
  /** Velocity of the last tick, Q10 per tick (for renderer interpolation). */
  vx!: Int32Array;
  vy!: Int32Array;
  /** Structures: footprint origin tile. */
  tileX!: Int16Array;
  tileY!: Int16Array;

  orders: Order[][] = [];
  paths: (Int32Array | null)[] = [];

  constructor(capacity = 512) {
    this.capacity = 0;
    this.grow(capacity);
  }

  private grow(capacity: number): void {
    const re = <T extends Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array>(
      old: T | undefined,
      make: (n: number) => T,
    ): T => {
      const next = make(capacity);
      if (old) next.set(old);
      return next;
    };
    this.alive = re(this.alive, (n) => new Uint8Array(n));
    this.gen = re(this.gen, (n) => new Uint16Array(n));
    this.kind = re(this.kind, (n) => new Uint8Array(n));
    this.type = re(this.type, (n) => new Int16Array(n));
    this.owner = re(this.owner, (n) => new Int8Array(n));
    this.x = re(this.x, (n) => new Int32Array(n));
    this.y = re(this.y, (n) => new Int32Array(n));
    this.radius = re(this.radius, (n) => new Int32Array(n));
    this.hp = re(this.hp, (n) => new Int32Array(n));
    this.maxHp = re(this.maxHp, (n) => new Int32Array(n));
    this.shields = re(this.shields, (n) => new Int32Array(n));
    this.maxShields = re(this.maxShields, (n) => new Int32Array(n));
    this.facing = re(this.facing, (n) => new Int16Array(n));
    this.cooldown = re(this.cooldown, (n) => new Int32Array(n));
    this.target = re(this.target, (n) => new Int32Array(n));
    this.lastAttacker = re(this.lastAttacker, (n) => new Int32Array(n));
    this.lastHitTick = re(this.lastHitTick, (n) => new Int32Array(n));
    this.xp = re(this.xp, (n) => new Int32Array(n));
    this.rank = re(this.rank, (n) => new Uint8Array(n));
    this.stance = re(this.stance, (n) => new Uint8Array(n));
    this.anchorX = re(this.anchorX, (n) => new Int32Array(n));
    this.anchorY = re(this.anchorY, (n) => new Int32Array(n));
    this.goalX = re(this.goalX, (n) => new Int32Array(n));
    this.goalY = re(this.goalY, (n) => new Int32Array(n));
    this.hasGoal = re(this.hasGoal, (n) => new Uint8Array(n));
    this.pathIdx = re(this.pathIdx, (n) => new Int32Array(n));
    this.pathGoal = re(this.pathGoal, (n) => new Int32Array(n));
    this.stuck = re(this.stuck, (n) => new Int32Array(n));
    this.vx = re(this.vx, (n) => new Int32Array(n));
    this.vy = re(this.vy, (n) => new Int32Array(n));
    this.tileX = re(this.tileX, (n) => new Int16Array(n));
    this.tileY = re(this.tileY, (n) => new Int16Array(n));
    this.capacity = capacity;
  }

  /** Allocate a slot and return its handle. Fields are reset to defaults. */
  allocate(): number {
    let slot: number;
    if (this.freeSlots.length > 0) slot = this.freeSlots.pop()!;
    else {
      slot = this.high++;
      if (slot >= MAX_SLOTS) throw new Error('entity limit reached');
      if (slot >= this.capacity) this.grow(Math.min(MAX_SLOTS, this.capacity * 2));
    }
    this.alive[slot] = 1;
    this.target[slot] = NO_ENTITY;
    this.lastAttacker[slot] = NO_ENTITY;
    this.lastHitTick[slot] = -1;
    this.cooldown[slot] = 0;
    this.xp[slot] = 0;
    this.rank[slot] = 0;
    this.stance[slot] = STANCE.normal;
    this.hasGoal[slot] = 0;
    this.pathIdx[slot] = 0;
    this.pathGoal[slot] = -1;
    this.stuck[slot] = 0;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.facing[slot] = 0;
    this.shields[slot] = 0;
    this.maxShields[slot] = 0;
    this.tileX[slot] = 0;
    this.tileY[slot] = 0;
    this.orders[slot] = [];
    this.paths[slot] = null;
    return slot | (this.gen[slot]! << SLOT_BITS);
  }

  free(slot: number): void {
    this.alive[slot] = 0;
    this.kind[slot] = KIND.none;
    this.gen[slot] = (this.gen[slot]! + 1) & 0xffff;
    this.orders[slot] = [];
    this.paths[slot] = null;
    this.freeSlots.push(slot);
    // Keep the free list sorted descending so the lowest slot is reused first.
    this.freeSlots.sort((a, b) => b - a);
  }

  handle(slot: number): number {
    return slot | (this.gen[slot]! << SLOT_BITS);
  }

  /** Slot for a handle if it is still alive, otherwise -1. */
  resolve(h: number): number {
    if (h < 0) return -1;
    const slot = h & SLOT_MASK;
    return slot < this.high && this.alive[slot] === 1 && this.gen[slot] === h >>> SLOT_BITS ? slot : -1;
  }

  serialize(w: IntWriter): void {
    w.push(this.high);
    w.push(this.freeSlots.length);
    w.pushArray(this.freeSlots);
    for (let s = 0; s < this.high; s++) {
      w.push(this.gen[s]!);
      if (this.alive[s] !== 1) {
        w.push(0);
        continue;
      }
      w.push(1);
      w.push(this.kind[s]!);
      w.push(this.type[s]!);
      w.push(this.owner[s]!);
      w.push(this.x[s]!);
      w.push(this.y[s]!);
      w.push(this.hp[s]!);
      w.push(this.maxHp[s]!);
      w.push(this.shields[s]!);
      w.push(this.facing[s]!);
      w.push(this.cooldown[s]!);
      w.push(this.target[s]!);
      w.push(this.lastAttacker[s]!);
      w.push(this.lastHitTick[s]!);
      w.push(this.xp[s]!);
      w.push(this.rank[s]!);
      w.push(this.stance[s]!);
      w.push(this.anchorX[s]!);
      w.push(this.anchorY[s]!);
      w.push(this.pathIdx[s]!);
      w.push(this.pathGoal[s]!);
      w.push(this.stuck[s]!);
      w.push(this.vx[s]!);
      w.push(this.vy[s]!);
      const orders = this.orders[s]!;
      w.push(orders.length);
      for (const o of orders) serializeOrder(o, w);
      const path = this.paths[s];
      w.push(path ? path.length : -1);
      if (path) w.pushArray(path);
    }
  }
}

const ORDER_CODE = { move: 1, attackMove: 2, attack: 3, patrol: 4, guard: 5 } as const;

function serializeOrder(o: Order, w: IntWriter): void {
  w.push(ORDER_CODE[o.type]);
  switch (o.type) {
    case 'move':
    case 'attackMove':
      w.push(o.x);
      w.push(o.y);
      w.push(o.flow ? 1 : 0);
      w.push(o.cx);
      w.push(o.cy);
      return;
    case 'attack':
      w.push(o.target);
      w.push(o.x);
      w.push(o.y);
      return;
    case 'guard':
      w.push(o.target);
      return;
    case 'patrol':
      w.push(o.ax);
      w.push(o.ay);
      w.push(o.bx);
      w.push(o.by);
      w.push(o.toB ? 1 : 0);
      return;
  }
}
