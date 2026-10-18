import type { Command } from '@signal-fall/sim';

/** One peer's commands for one turn. Every peer sends exactly one per turn, empty or not. */
export interface TurnMessage {
  kind: 'turn';
  turn: number;
  player: number;
  commands: Command[];
}

export interface HashMessage {
  kind: 'hash';
  tick: number;
  player: number;
  hash: number;
}

export interface PingMessage {
  kind: 'ping' | 'pong';
  player: number;
  /** Sender's clock, echoed back in the pong. */
  t: number;
}

/** Chat and map pings between people: never reaches the sim, so it can't desync anything. */
export interface ChatMessage {
  kind: 'chat';
  player: number;
  /** Only for the sender's team (2v2), or for everyone. */
  team: boolean;
  text: string;
  /** A map ping (sim position, Q10) instead of, or with, text. */
  at?: { x: number; y: number };
}

/**
 * Dropping a person who left: each remaining peer reports the last turn it holds from them,
 * with their recent turns (so everyone can fill gaps). Once every remaining peer has reported,
 * all agree: the dropped player's input ends after the highest turn anyone holds.
 */
export interface DropMessage {
  kind: 'drop';
  player: number;
  lost: number;
  have: number;
  turns: [number, Command[]][];
}

export type NetMessage = TurnMessage | HashMessage | PingMessage | ChatMessage | DropMessage;

/**
 * A reliable, ordered message channel to all other peers. Implementations:
 * loopback (tests, local play), WebRTC data channel and Supabase broadcast (M8).
 */
export interface Transport {
  send(msg: NetMessage): void;
  onMessage(handler: (msg: NetMessage) => void): void;
  close(): void;
}

/** Transport for a match with a single human: nothing to send to. */
export class NullTransport implements Transport {
  send(): void {}
  onMessage(): void {}
  close(): void {}
}

/**
 * In-memory transport between peers. Delivery is delegated to `schedule`, so
 * tests can drive a virtual clock with latency and jitter; messages from one
 * sender always arrive in order (like a reliable ordered data channel).
 */
export class LoopbackTransport implements Transport {
  private handlers: ((msg: NetMessage) => void)[] = [];
  private peers: LoopbackTransport[] = [];
  private closed = false;
  /** Earliest delivery time per destination, to keep per-link ordering under jitter. */
  private lastDelivery = new Map<LoopbackTransport, number>();

  constructor(private readonly link: LinkModel = immediateLink) {}

  /** Connect n transports in a full mesh. */
  static mesh(n: number, link: LinkModel = immediateLink): LoopbackTransport[] {
    const ts = Array.from({ length: n }, () => new LoopbackTransport(link));
    for (const t of ts) t.peers = ts.filter((o) => o !== t);
    return ts;
  }

  send(msg: NetMessage): void {
    if (this.closed) return;
    const copy = structuredClone(msg);
    for (const p of this.peers) {
      const delay = this.link.delay();
      const at = Math.max(this.link.now() + delay, this.lastDelivery.get(p) ?? 0);
      this.lastDelivery.set(p, at);
      this.link.schedule(at, () => p.deliver(copy));
    }
  }

  private deliver(msg: NetMessage): void {
    if (this.closed) return;
    for (const h of this.handlers) h(msg);
  }

  onMessage(handler: (msg: NetMessage) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.closed = true;
  }
}

export interface LinkModel {
  now(): number;
  /** One-way delay for the next message, ms. */
  delay(): number;
  schedule(at: number, fn: () => void): void;
}

const immediateLink: LinkModel = {
  now: () => 0,
  delay: () => 0,
  schedule: (_at, fn) => queueMicrotask(fn),
};

/**
 * Discrete-event clock for tests: messages fire when `advance` passes their
 * time. Ties fire in scheduling order.
 */
export class VirtualClock {
  time = 0;
  private queue: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;

  link(delay: () => number): LinkModel {
    return { now: () => this.time, delay, schedule: (at, fn) => this.at(at, fn) };
  }

  at(at: number, fn: () => void): void {
    this.queue.push({ at, seq: this.seq++, fn });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  advance(ms: number): void {
    const end = this.time + ms;
    while (this.queue.length > 0 && this.queue[0]!.at <= end) {
      const ev = this.queue.shift()!;
      this.time = ev.at;
      ev.fn();
    }
    this.time = end;
  }
}
