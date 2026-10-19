import { FX_ONE, FX_SHIFT, idiv } from '../fx';
import { KIND } from '../entities';
import { groupMove } from '../orders';
import { spawnUnit } from '../spawn';
import { FX_EVENT, pushFx, type World } from '../world';

/**
 * Campaign missions: objectives to complete, and triggers that fire actions (reinforcements, waves,
 * spoken lines, credits, victory or defeat). Plain data, evaluated on a fixed cadence with integer
 * math only, so mission replays reproduce exactly. Areas and positions are in tiles.
 */
export interface Area {
  x: number;
  y: number;
  r: number;
}

export type Objective =
  /** Destroy every structure of a player (or one role of theirs, `count` of them). */
  | { kind: 'destroy'; player: number; role?: string; count?: number }
  /** Own at least `count` structures of a role. */
  | { kind: 'have'; role: string; count: number }
  /** Harvest this many credits in total. */
  | { kind: 'harvest'; amount: number }
  /** Hold out until this tick. */
  | { kind: 'survive'; ticks: number }
  /** Get a unit (any, or one tagged) into the area. */
  | { kind: 'reach'; area: Area; tag?: string }
  /** Keep the tagged unit alive (fails the mission if it dies). */
  | { kind: 'protect'; tag: string }
  /** Have ground units in the area, with no enemy there, for this many ticks in total. */
  | { kind: 'hold'; area: Area; ticks: number }
  /** A player loses this many units. */
  | { kind: 'kill'; player: number; count: number };

export type Action =
  | { kind: 'spawn'; player: number; unit: string; count: number; x: number; y: number; tag?: string; attack?: { x: number; y: number } }
  | { kind: 'say'; line: number }
  | { kind: 'credits'; player: number; amount: number }
  | { kind: 'reveal'; area: Area }
  | { kind: 'win' }
  | { kind: 'lose' };

export interface Trigger {
  /** When: at a tick, once an objective is done, or when the player's units enter an area. */
  at?: number;
  objective?: number;
  enter?: Area;
  /** Repeat every this many ticks after the first firing (waves). */
  every?: number;
  /** Stop repeating at this tick. */
  until?: number;
  actions: Action[];
}

export interface MissionRules {
  objectives: Objective[];
  triggers: Trigger[];
}

export interface MissionState {
  rules: MissionRules;
  /** 0 pending, 1 done, 2 failed, per objective. */
  status: number[];
  /** Next tick each trigger may fire, or -1 once spent. */
  next: number[];
  /** Tagged units (handles). */
  tags: Map<string, number>;
  /** Ticks held so far, per 'hold' objective. */
  held: number[];
}

const STEP = 10;

export function makeMission(rules: MissionRules): MissionState {
  return { rules, status: rules.objectives.map(() => 0), next: rules.triggers.map((t) => t.at ?? 0), tags: new Map(), held: rules.objectives.map(() => 0) };
}

const inArea = (x: number, y: number, a: Area) => {
  const dx = (x >> FX_SHIFT) - a.x;
  const dy = (y >> FX_SHIFT) - a.y;
  return dx * dx + dy * dy <= a.r * a.r;
};

function act(world: World, m: MissionState, a: Action, index: number): void {
  if (a.kind === 'spawn') {
    const rule = world.rules.unitIndex.get(a.unit);
    if (rule === undefined) return;
    const made: number[] = [];
    for (let k = 0; k < a.count; k++) {
      const h = spawnUnit(world, rule, a.player, ((a.x + (k % 3) - 1) << FX_SHIFT) + (FX_ONE >> 1), ((a.y + (idiv(k, 3) % 3) - 1) << FX_SHIFT) + (FX_ONE >> 1));
      made.push(h);
      if (a.tag && k === 0) m.tags.set(a.tag, h);
    }
    if (a.attack) groupMove(world, made.map((h) => h & 0xffff), 'attackMove', (a.attack.x << FX_SHIFT) + (FX_ONE >> 1), (a.attack.y << FX_SHIFT) + (FX_ONE >> 1), false);
  } else if (a.kind === 'say') pushFx(world, FX_EVENT.mission, a.line, index, 0, 0, 0, 0, 0);
  else if (a.kind === 'credits') world.players[a.player]!.credits += a.amount;
  else if (a.kind === 'reveal') {
    const f = world.fog[0]!;
    const w = world.map.width;
    for (let y = a.area.y - a.area.r; y <= a.area.y + a.area.r; y++)
      for (let x = a.area.x - a.area.r; x <= a.area.x + a.area.r; x++) if (x >= 0 && y >= 0 && x < w && y < world.map.height) f[y * w + x]! |= 2;
  } else end(world, a.kind === 'win');
}

function end(world: World, won: boolean): void {
  if (world.ended) return;
  world.ended = true;
  world.winnerTeam = won ? world.players[0]!.team : (world.players.find((p) => p.team !== world.players[0]!.team)?.team ?? -1);
}

function done(world: World, m: MissionState, o: Objective, i: number): boolean {
  const e = world.entities;
  switch (o.kind) {
    case 'destroy': {
      let left = 0;
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.owner[s] !== o.player || e.kind[s] !== KIND.structure) continue;
        if (o.role && world.rules.structures[e.type[s]!]!.role !== o.role) continue;
        left++;
      }
      // Counted: that many destroyed (tracked as they fall); otherwise none left.
      return o.count === undefined ? left === 0 : m.held[i]! >= o.count || left === 0;
    }
    case 'have': {
      let n = 0;
      for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === 0 && e.kind[s] === KIND.structure && world.rules.structures[e.type[s]!]!.role === o.role) n++;
      return n >= o.count;
    }
    case 'harvest':
      return world.players[0]!.harvested >= o.amount;
    case 'survive':
      return world.tick >= o.ticks;
    case 'reach': {
      if (o.tag) {
        const s = e.resolve(m.tags.get(o.tag) ?? -1);
        return s >= 0 && inArea(e.x[s]!, e.y[s]!, o.area);
      }
      for (let s = 0; s < e.high; s++) if (e.alive[s] === 1 && e.owner[s] === 0 && e.kind[s] === KIND.unit && inArea(e.x[s]!, e.y[s]!, o.area)) return true;
      return false;
    }
    case 'protect':
      return false;
    case 'kill':
      return world.players[o.player]!.stats.unitsLost >= o.count;
    case 'hold': {
      let mine = false;
      let theirs = false;
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.kind[s] !== KIND.unit || !inArea(e.x[s]!, e.y[s]!, o.area)) continue;
        if (world.players[e.owner[s]!]!.team === world.players[0]!.team) mine = true;
        else theirs = true;
      }
      if (mine && !theirs) m.held[i]! += STEP;
      return m.held[i]! >= o.ticks;
    }
  }
}

/** Track destroyed structures for counted 'destroy' objectives. */
export function missionDestroyed(world: World, owner: number, role: string): void {
  const m = world.mission;
  if (!m) return;
  m.rules.objectives.forEach((o, i) => {
    if (o.kind === 'destroy' && o.count !== undefined && o.player === owner && (!o.role || o.role === role)) m.held[i]! += 1;
  });
}

export function missionSystem(world: World): void {
  const m = world.mission;
  if (!m || world.ended || world.tick % STEP !== 0) return;
  const e = world.entities;
  // Objectives.
  m.rules.objectives.forEach((o, i) => {
    if (m.status[i] !== 0) return;
    if (o.kind === 'protect') {
      const h = m.tags.get(o.tag);
      if (h !== undefined && e.resolve(h) < 0) m.status[i] = 2;
      return;
    }
    if (done(world, m, o, i)) m.status[i] = 1;
  });
  if (m.status.some((s) => s === 2)) return end(world, false);
  // Triggers.
  m.rules.triggers.forEach((t, i) => {
    const next = m.next[i]!;
    if (next < 0 || world.tick < next) return;
    if (t.objective !== undefined && m.status[t.objective] !== 1) return;
    if (t.enter) {
      let inside = false;
      for (let s = 0; s < e.high && !inside; s++) if (e.alive[s] === 1 && e.owner[s] === 0 && e.kind[s] === KIND.unit && inArea(e.x[s]!, e.y[s]!, t.enter)) inside = true;
      if (!inside) return;
    }
    t.actions.forEach((a, k) => act(world, m, a, i * 16 + k));
    m.next[i] = t.every && (t.until === undefined || world.tick + t.every <= t.until) ? world.tick + t.every : -1;
  });
  // Every objective that isn't a 'protect' done: won.
  if (m.rules.objectives.length > 0 && m.rules.objectives.every((o, i) => o.kind === 'protect' || m.status[i] === 1)) end(world, true);
}
