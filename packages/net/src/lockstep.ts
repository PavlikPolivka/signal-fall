import type { Command, ScheduledCommand } from '@signal-fall/sim';
import type { NetMessage, Transport } from './transport';

export const TICKS_PER_TURN = 2;
export const MIN_DELAY_TURNS = 1;
export const MAX_DELAY_TURNS = 6;

export interface LockstepOptions {
  /** This peer's player index. */
  localPlayer: number;
  /** Player indices of every human peer in the match (including local). */
  peers: number[];
  transport: Transport;
  /** Initial input delay in turns. */
  delayTurns: number;
  /** Called when a remote state hash disagrees with ours. */
  onDesync?: (tick: number, local: number, remote: number, player: number) => void;
  /** Clock for RTT measurement (ms). */
  now?: () => number;
  /** First turn to play (a resumed match starts mid-way). */
  startTurn?: number;
}

/**
 * Deterministic lockstep. Turn N covers ticks [N*2, N*2+1]; its commands
 * apply at tick N*2. At the start of each turn T a peer sends its commands for
 * turn T + delay. The sim may advance into a turn only once every peer's input
 * for it has arrived. Delay can change at any time: each peer still sends
 * exactly one message per turn, in order.
 */
export class LockstepScheduler {
  readonly localPlayer: number;
  /** People whose input every turn needs (shrinks when someone is dropped). */
  peers: number[];
  private readonly transport: Transport;
  private delay: number;
  private readonly inputs = new Map<number, Map<number, Command[]>>();
  private pending: Command[] = [];
  /** Next turn this peer has not yet sent input for. */
  private nextSendTurn: number;
  private lastFlushedTurn = -1;
  private readonly localHashes = new Map<number, number>();
  private readonly remoteHashes = new Map<number, Map<number, number>>();
  private readonly onDesync: LockstepOptions['onDesync'];
  private readonly now: () => number;
  /** Smoothed round-trip time in ms, or -1 before the first pong. */
  rtt = -1;
  /** Each person's recent turns (kept to help others fill gaps when someone drops). */
  private readonly recent = new Map<number, Map<number, Command[]>>();
  /** Drop votes: lost player -> reporter -> last turn held. */
  private readonly votes = new Map<number, Map<number, number>>();
  /** Dropped players and the first turn played without them. */
  private readonly dropped = new Map<number, number>();
  /** Highest turn already handed to the sim. */
  private taken = -1;
  /** Everyone agreed: `player` plays no more from `turn` (the AI takes their seat). */
  onDropped: (player: number, turn: number) => void = () => undefined;

  constructor(o: LockstepOptions) {
    this.localPlayer = o.localPlayer;
    this.peers = [...o.peers].sort((a, b) => a - b);
    this.transport = o.transport;
    this.delay = clampDelay(o.delayTurns);
    this.onDesync = o.onDesync;
    this.now = o.now ?? (() => Date.now());
    // Turns before the first possible input are empty for everyone.
    const start = o.startTurn ?? 0;
    for (let t = start; t < start + this.delay; t++) for (const p of this.peers) this.record(t, p, []);
    this.nextSendTurn = start + this.delay;
    this.lastFlushedTurn = start - 1;
    this.transport.onMessage((m) => this.receive(m));
  }

  get delayTurns(): number {
    return this.delay;
  }

  setDelay(turns: number): void {
    this.delay = clampDelay(turns);
  }

  /** Queue a local command for the next turn we send. */
  submit(cmd: Command): void {
    this.pending.push(cmd);
  }

  /**
   * True if the sim may run `tick`. At a turn boundary this first flushes our
   * own input for turn + delay (once per turn), then requires every peer's input.
   */
  ready(tick: number): boolean {
    if (tick % TICKS_PER_TURN !== 0) return true;
    const turn = tick / TICKS_PER_TURN;
    if (turn > this.lastFlushedTurn) {
      this.lastFlushedTurn = turn;
      this.flush(turn + this.delay);
    }
    const got = this.inputs.get(turn);
    return got !== undefined && this.needed(turn).every((p) => got.has(p));
  }

  /** Whose input a turn needs: today's peers, plus anyone dropped after it. */
  private needed(turn: number): number[] {
    const out = [...this.peers];
    for (const [p, from] of this.dropped) if (turn < from) out.push(p);
    return out.sort((a, b) => a - b);
  }

  /** The last turn we hold from a player, or -1. */
  private lastTurn(player: number): number {
    let last = -1;
    for (const t of this.recent.get(player)?.keys() ?? []) last = Math.max(last, t);
    return last;
  }

  /**
   * Vote to drop a person who left (call on every remaining peer; peers also vote as soon as
   * they hear someone else's vote). When all remaining peers have voted, `onDropped` fires.
   */
  proposeDrop(lost: number): void {
    if (this.dropped.has(lost) || this.votes.get(lost)?.has(this.localPlayer) || lost === this.localPlayer) return;
    const turns = [...(this.recent.get(lost) ?? new Map<number, Command[]>())];
    const have = this.lastTurn(lost);
    this.transport.send({ kind: 'drop', player: this.localPlayer, lost, have, turns });
    this.vote(this.localPlayer, lost, have, turns);
  }

  private vote(from: number, lost: number, have: number, turns: [number, Command[]][]): void {
    if (this.dropped.has(lost)) return;
    // Fill in their turns we missed (not ones already played).
    for (const [turn, cmds] of turns) if (turn > this.taken && !this.inputs.get(turn)?.has(lost)) this.record(turn, lost, cmds);
    let v = this.votes.get(lost);
    if (!v) this.votes.set(lost, (v = new Map()));
    v.set(from, have);
    if (from !== this.localPlayer) this.proposeDrop(lost);
    // Our own vote may have just completed it.
    if (this.dropped.has(lost)) return;
    const voters = this.peers.filter((p) => p !== lost);
    if (!voters.every((p) => v.has(p))) return;
    const from_ = Math.max(...v.values()) + 1;
    this.dropped.set(lost, from_);
    this.peers = this.peers.filter((p) => p !== lost);
    for (const [turn, m] of this.inputs) if (turn >= from_) m.delete(lost);
    this.onDropped(lost, from_);
  }

  /** Commands to apply at `tick` (non-empty only at turn boundaries). Call after ready(). */
  take(tick: number): ScheduledCommand[] {
    if (tick % TICKS_PER_TURN !== 0) return [];
    const turn = tick / TICKS_PER_TURN;
    const got = this.inputs.get(turn);
    if (!got) throw new Error(`no inputs for turn ${turn}`);
    this.inputs.delete(turn);
    this.taken = turn;
    const out: ScheduledCommand[] = [];
    for (const p of this.needed(turn)) for (const cmd of got.get(p) ?? []) out.push({ tick, player: p, cmd });
    return out;
  }

  /** Which peers are we still waiting on for the turn containing `tick`? */
  waitingOn(tick: number): number[] {
    const turn = Math.floor(tick / TICKS_PER_TURN);
    const got = this.inputs.get(turn);
    return this.needed(turn).filter((p) => !got?.has(p));
  }

  private flush(target: number): void {
    // Delay grew: fill skipped turns with empty input. Delay shrank: wait (pending carries over).
    while (this.nextSendTurn < target) this.sendTurn(this.nextSendTurn, []);
    if (this.nextSendTurn === target) {
      const cmds = this.pending;
      this.pending = [];
      this.sendTurn(target, cmds);
    }
  }

  private sendTurn(turn: number, commands: Command[]): void {
    this.record(turn, this.localPlayer, commands);
    this.transport.send({ kind: 'turn', turn, player: this.localPlayer, commands });
    this.nextSendTurn = turn + 1;
  }

  private record(turn: number, player: number, commands: Command[]): void {
    // A dropped player's late turns no longer count.
    const gone = this.dropped.get(player);
    if (gone !== undefined && turn >= gone) return;
    let r = this.recent.get(player);
    if (!r) this.recent.set(player, (r = new Map()));
    r.set(turn, commands);
    if (r.size > 256) r.delete(r.keys().next().value!);
    let m = this.inputs.get(turn);
    if (!m) {
      m = new Map();
      this.inputs.set(turn, m);
    }
    m.set(player, commands);
  }

  /** Report our state hash at `tick` and compare with any peer hashes already received. */
  reportHash(tick: number, hash: number): void {
    this.localHashes.set(tick, hash);
    this.transport.send({ kind: 'hash', tick, player: this.localPlayer, hash });
    const remote = this.remoteHashes.get(tick);
    if (remote) for (const [p, h] of remote) this.compare(tick, p, h);
    // Keep memory bounded.
    for (const t of this.localHashes.keys()) if (t < tick - 2000) this.localHashes.delete(t);
  }

  ping(): void {
    this.transport.send({ kind: 'ping', player: this.localPlayer, t: this.now() });
  }

  private compare(tick: number, player: number, remote: number): void {
    const local = this.localHashes.get(tick);
    if (local !== undefined && local !== remote) this.onDesync?.(tick, local, remote, player);
  }

  private receive(m: NetMessage): void {
    switch (m.kind) {
      case 'turn':
        this.record(m.turn, m.player, m.commands);
        return;
      case 'hash': {
        let r = this.remoteHashes.get(m.tick);
        if (!r) {
          r = new Map();
          this.remoteHashes.set(m.tick, r);
        }
        r.set(m.player, m.hash);
        this.compare(m.tick, m.player, m.hash);
        return;
      }
      case 'ping':
        this.transport.send({ kind: 'pong', player: m.player, t: m.t });
        return;
      case 'drop':
        this.vote(m.player, m.lost, m.have, m.turns);
        return;
      case 'chat':
        return;
      case 'pong': {
        if (m.player !== this.localPlayer) return;
        const sample = this.now() - m.t;
        this.rtt = this.rtt < 0 ? sample : Math.round(this.rtt * 0.8 + sample * 0.2);
        return;
      }
    }
  }

  /** Delay (turns) suited to the measured RTT: one-way latency plus a turn of slack. */
  static delayForRtt(rttMs: number, turnMs = 100): number {
    return clampDelay(Math.ceil(rttMs / 2 / turnMs) + 1);
  }
}

function clampDelay(t: number): number {
  return Math.max(MIN_DELAY_TURNS, Math.min(MAX_DELAY_TURNS, Math.round(t)));
}
