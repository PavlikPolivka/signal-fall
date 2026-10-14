import { randomBytes } from 'node:crypto';
import type { Difficulty } from '@signal-fall/ai';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
import { createSim, sampleStats, type AgentSeat, type MapExtras, type Replay, type ScenarioSpec, type StatPoint } from '@signal-fall/scenario';
import { KIND, type Command, type ScheduledCommand, type Sim } from '@signal-fall/sim';

/** Who plays a seat: an agent over this API, or the built-in AI. */
export type Seat = { kind: 'agent'; agent: AgentSeat } | { kind: 'ai'; difficulty: Difficulty };

export interface MatchOptions {
  factions: number[];
  seats: Seat[];
  /** Team per seat; default everyone alone. */
  teams?: number[];
  seed?: number;
  map?: Partial<{ size: MapSize; biome: Biome; resources: Resources; terrain: TerrainStyle }>;
  /** Game ticks per turn (20 ticks = 1 s). */
  turnTicks?: number;
  /** An agent seat that has not ended its turn after this long is skipped (ms). */
  turnTimeoutMs?: number;
}

/** A structure an agent's side has seen, remembered after it goes back into the fog. */
export interface Sighting {
  id: number;
  owner: number;
  type: number;
  x: number;
  y: number;
  tick: number;
}

const DEFAULT_TURN_TICKS = 100;
/** Longest match, in ticks (60 minutes); it ends as a draw after that. */
export const MAX_TICKS = 60 * 60 * 20;

/**
 * One match driven by agents. Time moves in turns: every agent seat queues
 * commands with `act`, then calls `endTurn`; once every agent has ended its
 * turn (or the timeout passes), their commands apply and the sim runs
 * `turnTicks` ticks. Built-in AI seats think on their own inside the sim, as in
 * any skirmish. Everything that happens is a command log: the match is a
 * replay the browser can play back.
 */
export class AgentMatch {
  readonly id = randomBytes(4).toString('hex');
  /** Code another agent uses to take an open agent seat. */
  readonly joinCode = randomBytes(3).toString('hex').toUpperCase();
  readonly scenario: Extract<ScenarioSpec, { kind: 'skirmish' }>;
  readonly sim: Sim;
  readonly extras: MapExtras;
  readonly turnTicks: number;
  readonly createdAt = Date.now();
  private readonly turnTimeoutMs: number;
  /** Seat tokens: who may act for which seat. */
  private readonly tokens = new Map<string, number>();
  /** Agent seats nobody has taken yet. */
  private readonly unclaimed = new Set<number>();
  private readonly log: ScheduledCommand[] = [];
  private pending = new Map<number, Command[]>();
  private ended = new Map<number, () => void>();
  /** Agents waiting for the open seats to be taken before the first turn. */
  private waitingForJoin: (() => void)[] = [];
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  readonly memory: Map<number, Sighting>[];
  /** Spectators: called after every turn with the commands it applied and the tick reached. */
  private readonly watchers = new Set<(turn: { commands: ScheduledCommand[]; until: number; over: boolean; hash?: number }) => void>();
  /** Ticks at which each seat last observed (for "what changed" summaries). */
  readonly lastObserved: number[];
  /** Every player's statistics once a game minute (for the match report). */
  readonly samples: { tick: number; players: StatPoint[] }[] = [];
  /** What each seat saw at its last observation (for "since last turn" events). */
  readonly seen: ({ units: Map<number, string>; structures: Map<number, string>; enemyTypes: Set<string> } | null)[];

  constructor(readonly options: MatchOptions) {
    const n = options.factions.length;
    if (options.seats.length !== n) throw new Error('one seat per faction');
    this.scenario = {
      kind: 'skirmish',
      seed: options.seed ?? Math.floor(Math.random() * 1_000_000),
      factions: options.factions,
      ai: options.seats.map((s) => (s.kind === 'ai' ? s.difficulty : null)),
      humans: [],
      teams: options.teams,
      agents: options.seats.map((s) => (s.kind === 'agent' ? s.agent : null)),
      // Unset options keep their defaults.
      map: { size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal', ...Object.fromEntries(Object.entries(options.map ?? {}).filter(([, v]) => v !== undefined)) },
    };
    const { sim, extras } = createSim(this.scenario);
    this.sim = sim;
    this.extras = extras;
    this.turnTicks = options.turnTicks ?? DEFAULT_TURN_TICKS;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 120_000;
    options.seats.forEach((s, k) => s.kind === 'agent' && this.unclaimed.add(k));
    this.memory = options.seats.map(() => new Map());
    this.lastObserved = options.seats.map(() => 0);
    this.seen = options.seats.map(() => null);
    this.samples.push({ tick: 0, players: sampleStats(this.sim.world) });
  }

  get agentSeats(): number[] {
    return this.options.seats.flatMap((s, k) => (s.kind === 'agent' ? [k] : []));
  }

  get over(): boolean {
    return this.sim.world.ended || this.sim.tick >= MAX_TICKS;
  }

  /** Take an open agent seat (the first, or a given one); returns its token. */
  claim(seat?: number, agent?: AgentSeat): { seat: number; token: string } {
    const k = seat ?? [...this.unclaimed][0];
    if (k === undefined || !this.unclaimed.has(k)) throw new Error('no open agent seat in this match');
    this.unclaimed.delete(k);
    if (agent) {
      const s = this.options.seats[k]!;
      if (s.kind === 'agent') {
        // The autopilot was decided when the match was made (it is part of the scenario).
        s.agent = { ...agent, autopilot: s.agent.autopilot };
        this.scenario.agents![k] = s.agent;
      }
    }
    const token = randomBytes(12).toString('base64url');
    this.tokens.set(token, k);
    if (this.unclaimed.size === 0) for (const r of this.waitingForJoin.splice(0)) r();
    return { seat: k, token };
  }

  get openSeats(): number[] {
    return [...this.unclaimed];
  }

  seatOf(token: string): number {
    const k = this.tokens.get(token);
    if (k === undefined) throw new Error('unknown seat token for this match');
    return k;
  }

  /** Queue validated commands for the next turn. */
  queue(seat: number, cmds: Command[]): void {
    const list = this.pending.get(seat) ?? [];
    list.push(...cmds);
    this.pending.set(seat, list);
  }

  /**
   * End this seat's turn. Resolves once the turn has been played (every agent
   * ended theirs, or the timeout skipped the stragglers).
   */
  endTurn(seat: number): Promise<void> {
    if (this.over) return Promise.resolve();
    // The game does not start before every agent seat is taken: wait for that (or the timeout), without playing.
    if (this.unclaimed.size)
      return new Promise((resolve) => {
        this.waitingForJoin.push(resolve);
        setTimeout(resolve, this.turnTimeoutMs);
      });
    return new Promise((resolve) => {
      this.ended.get(seat)?.(); // a second call replaces the first
      this.ended.set(seat, resolve);
      const waitingFor = this.agentSeats.filter((k) => !this.ended.has(k) && !this.sim.world.players[k]!.defeated);
      if (waitingFor.length === 0) this.play();
      else this.turnTimer ??= setTimeout(() => this.play(), this.turnTimeoutMs);
    });
  }

  private play(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    const tick = this.sim.tick;
    const applied = this.log.length;
    for (const [player, cmds] of [...this.pending].sort((a, b) => a[0] - b[0])) {
      for (const cmd of cmds) {
        const c: ScheduledCommand = { tick, player, cmd };
        this.sim.schedule(c);
        this.log.push(c);
      }
    }
    this.pending = new Map();
    const end = Math.min(MAX_TICKS, tick + this.turnTicks);
    while (this.sim.tick < end && !this.sim.world.ended) {
      this.sim.step();
      if (this.sim.tick % 1200 === 0 || this.sim.world.ended) this.samples.push({ tick: this.sim.tick, players: sampleStats(this.sim.world) });
    }
    this.remember();
    const turn = { commands: this.log.slice(applied), until: this.sim.tick, over: this.over, ...(this.over ? { hash: this.sim.hash() } : {}) };
    for (const w of this.watchers) w(turn);
    const done = [...this.ended.values()];
    this.ended = new Map();
    for (const r of done) r();
  }

  /** Each agent side remembers enemy structures it can see now. */
  private remember(): void {
    const w = this.sim.world;
    const e = w.entities;
    for (const k of this.agentSeats) {
      const mem = this.memory[k]!;
      const team = w.players[k]!.team;
      // Forget what was seen destroyed (a visible tile without the structure).
      for (const [h, s] of mem) {
        const slot = h & 0xffff;
        const alive = e.alive[slot] === 1 && e.handle(slot) === h;
        const tile = (s.y | 0) * w.map.width + (s.x | 0);
        if (!alive && (w.fog[k]![tile]! & 1) === 1) mem.delete(h);
      }
      for (let s = 0; s < e.high; s++) {
        if (e.alive[s] !== 1 || e.kind[s] !== KIND.structure) continue;
        const owner = e.owner[s]!;
        if (w.players[owner]!.team === team) continue;
        const rule = w.rules.structures[e.type[s]!]!;
        const tx = e.tileX[s]!;
        const ty = e.tileY[s]!;
        if ((w.fog[k]![ty * w.map.width + tx]! & 1) !== 1) continue;
        const h = e.handle(s);
        mem.set(h, { id: h, owner, type: e.type[s]!, x: tx + rule.footprintW / 2, y: ty + rule.footprintH / 2, tick: this.sim.tick });
      }
    }
  }

  /** Follow the match turn by turn (live spectating); returns an unsubscribe function. */
  watch(fn: (turn: { commands: ScheduledCommand[]; until: number; over: boolean; hash?: number }) => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  /** Everything so far, for a spectator who joins now. */
  get commandsSoFar(): ScheduledCommand[] {
    return [...this.log];
  }

  /** The match so far as a replay file (watch it in the browser: main menu → Watch a replay). */
  replay(localPlayer = 0): Replay {
    return {
      format: 'signal-fall-replay',
      version: 1,
      scenario: this.scenario,
      localPlayer,
      commands: [...this.log],
      endTick: this.sim.tick,
      hash: this.sim.hash(),
    };
  }

  /** Has this seat's base or a harvester been hit in the last turn? (Ends a multi-turn wait.) */
  attacked(seat: number): boolean {
    const e = this.sim.world.entities;
    const rules = this.sim.world.rules;
    const harvester = rules.factions[this.sim.world.players[seat]!.faction]!.harvester;
    for (let s = 0; s < e.high; s++) {
      if (e.alive[s] !== 1 || e.owner[s] !== seat || this.sim.tick - e.lastHitTick[s]! > this.turnTicks || e.lastHitTick[s]! < 0) continue;
      if (e.kind[s] === KIND.structure || (e.kind[s] === KIND.unit && e.type[s] === harvester)) return true;
    }
    return false;
  }

  /** Result for a seat: playing, won, lost or draw. */
  result(seat: number): 'playing' | 'won' | 'lost' | 'draw' {
    const w = this.sim.world;
    if (!this.over) return w.players[seat]!.defeated ? 'lost' : 'playing';
    if (!w.ended || w.winnerTeam < 0) return 'draw';
    return w.winnerTeam === w.players[seat]!.team ? 'won' : 'lost';
  }
}
