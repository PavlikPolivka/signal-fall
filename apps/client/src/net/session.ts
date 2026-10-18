import { ReliableLink, ReliableTransport, lossyPair, type ChatMessage, type Datagram, type NetMessage } from '@signal-fall/net';
import type { Command, ScheduledCommand } from '@signal-fall/sim';

/** No word from a peer for this long means they are gone. */
export const PEER_TIMEOUT_MS = 10_000;

/**
 * The main thread's side of a networked match: reliable lockstep messages over
 * each peer's datagram channel (one per other person), relayed to and from the
 * sim worker. Everything we send goes to every peer.
 */
export class NetSession {
  private readonly transport: ReliableTransport;
  private timer: number;
  private lost = false;
  /** Called when any peer goes silent for PEER_TIMEOUT_MS. */
  onPeerLost: () => void = () => undefined;
  /** Chat and pings from the other people (handled here, not by the sim). */
  onChat: (m: ChatMessage) => void = () => undefined;

  /** Links to spectators: they get every turn, and their silence never counts as a lost player. */
  private readonly watchers: ReliableTransport;

  constructor(
    dgrams: (Datagram | ReliableLink)[],
    private readonly toWorker: (msg: NetMessage) => void,
    watcherDgrams: Datagram[] = [],
    /** Player slot of each link, in order (for swapping one when that player reconnects). */
    private readonly slots: number[] = [],
  ) {
    this.transport = new ReliableTransport(dgrams.map((d) => (d instanceof ReliableLink ? d : new ReliableLink(d, { now: () => performance.now() }))));
    this.transport.onMessage((m) => (m.kind === 'chat' ? this.onChat(m) : this.toWorker(m)));
    this.watchers = new ReliableTransport(watcherDgrams.map((d) => new ReliableLink(d, { now: () => performance.now() })));
    this.watchers.onMessage(() => undefined);
    this.timer = window.setInterval(() => {
      this.transport.tick();
      this.watchers.tick();
      if (!this.lost && this.transport.silenceMs(performance.now()) > PEER_TIMEOUT_MS) {
        this.lost = true;
        this.onPeerLost();
      }
    }, 20);
  }

  /** Handle a message as if it had just arrived (messages held while rejoining). */
  deliver(m: NetMessage): void {
    if (m.kind === 'chat') this.onChat(m);
    else this.toWorker(m);
  }

  /** A player reconnected: their new link takes the dead one's place, and they count as present again. */
  replaceLink(slot: number, link: ReliableLink): void {
    const i = this.slots.indexOf(slot);
    if (i < 0) return;
    this.transport.replace(i, link);
    this.lost = false;
  }

  /** A lockstep message from our worker for the other peers. */
  send(msg: NetMessage): void {
    this.transport.send(msg);
    // Spectators need the turns and drops; chat stays between players.
    if (msg.kind === 'turn' || msg.kind === 'drop') this.watchers.send(msg);
  }

  close(): void {
    window.clearInterval(this.timer);
    this.transport.close();
    this.watchers.close();
  }
}

/**
 * Debug/test wrapper: one-way latency, jitter and packet loss on everything
 * this client sends (URL ?netsim=150,40,5). With both clients degraded, each
 * direction gets the impairment once.
 */
export function degrade(dgram: Datagram, spec: string): Datagram {
  const [latency = 0, jitter = 0, loss = 0] = spec.split(',').map(Number);
  const [near, far] = lossyPair({
    schedule: (d, fn) => window.setTimeout(fn, Math.max(0, d)),
    latencyMs: latency,
    jitterMs: jitter,
    lossPct: loss,
    random: Math.random,
  });
  far.onMessage((d) => dgram.send(d));
  return { send: (d) => near.send(d), onMessage: (h) => dgram.onMessage(h), close: () => dgram.close() };
}

/** Turns before the first input in a networked match (the lockstep's starting delay). */
export const MP_START_DELAY = 3;

/**
 * A spectator's side of a networked match: hears every player's turns over the peer links and
 * hands them on as a live replay, a turn at a time once every player's input for it is in, in
 * the order the players' own schedulers apply them. A player the others drop (the AI takes over)
 * is followed the same way they agree on it. Spectators send only keep-alive pings.
 */
export class SpectatorFeed {
  private readonly transport: ReliableTransport;
  private readonly timer: number;
  private readonly turns = new Map<number, Map<number, Command[]>>();
  private readonly votes = new Map<number, Map<number, number>>();
  private readonly dropped = new Map<number, number>();
  private cursor = MP_START_DELAY;
  /** Called with the commands of newly complete turns, and the first tick not yet playable. */
  onTurns: (commands: ScheduledCommand[], until: number) => void = () => undefined;

  constructor(
    dgrams: Datagram[],
    private readonly players: number[],
  ) {
    this.transport = new ReliableTransport(dgrams.map((d) => new ReliableLink(d, { now: () => performance.now() })));
    this.transport.onMessage((m) => this.receive(m));
    // Keep-alive: a ping a second, so the players don't take our silence for a dropped link.
    let n = 0;
    this.timer = window.setInterval(() => {
      this.transport.tick();
      if (++n % 50 === 0) this.transport.send({ kind: 'ping', player: -1, t: Date.now() });
    }, 20);
  }

  /** The first commands go out once the first turn is complete; until then nothing is playable. */
  start(): void {
    this.onTurns([], this.cursor * 2);
  }

  private receive(m: NetMessage): void {
    if (m.kind === 'turn') {
      const gone = this.dropped.get(m.player);
      if (gone !== undefined && m.turn >= gone) return;
      let t = this.turns.get(m.turn);
      if (!t) this.turns.set(m.turn, (t = new Map()));
      t.set(m.player, m.commands);
      this.advance();
    } else if (m.kind === 'drop') {
      if (this.dropped.has(m.lost)) return;
      for (const [turn, cmds] of m.turns) {
        let t = this.turns.get(turn);
        if (!t) this.turns.set(turn, (t = new Map()));
        if (!t.has(m.lost)) t.set(m.lost, cmds);
      }
      let v = this.votes.get(m.lost);
      if (!v) this.votes.set(m.lost, (v = new Map()));
      v.set(m.player, m.have);
      const voters = this.players.filter((p) => p !== m.lost && !this.dropped.has(p));
      if (voters.every((p) => v.has(p))) this.dropped.set(m.lost, Math.max(...v.values()) + 1);
      this.advance();
    }
  }

  /** Whose input a turn needs. */
  private needed(turn: number): number[] {
    return this.players.filter((p) => turn < (this.dropped.get(p) ?? Infinity));
  }

  private advance(): void {
    const out: ScheduledCommand[] = [];
    for (;;) {
      const got = this.turns.get(this.cursor);
      const need = this.needed(this.cursor);
      if (!got || !need.every((p) => got.has(p))) break;
      const tick = this.cursor * 2;
      // The AI takes over a dropped player at the first turn without them.
      for (const [p, from] of this.dropped) if (from === this.cursor) out.push({ tick, player: p, cmd: { type: 'takeover', difficulty: 'normal' } });
      for (const p of need) for (const cmd of got.get(p) ?? []) out.push({ tick, player: p, cmd });
      this.turns.delete(this.cursor);
      this.cursor++;
    }
    if (out.length > 0 || this.cursor * 2 > 0) this.onTurns(out, this.cursor * 2);
  }

  close(): void {
    window.clearInterval(this.timer);
    this.transport.close();
  }
}
