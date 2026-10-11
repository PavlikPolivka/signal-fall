import type { NetMessage, Transport } from './transport';

/**
 * An unreliable, unordered datagram link to one peer (an RTCDataChannel with
 * ordered: false and maxRetransmits: 0, or a lossy test link).
 */
export interface Datagram {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  close(): void;
}

/** Wire frame: data packets carry a sequence number; every frame carries the receiver's cumulative ack. */
interface Frame {
  /** Sequence number of the payload, absent for pure acks. */
  s?: number;
  /** Highest sequence number received in order from the other side (-1 none). */
  a: number;
  m?: NetMessage;
}

interface Outstanding {
  seq: number;
  data: string;
  sentAt: number;
  tries: number;
}

export interface ReliableOptions {
  now: () => number;
  /** Retransmit an unacknowledged packet after this long (ms); grows with retries. */
  resendMs?: number;
}

/**
 * Reliable, ordered delivery over one Datagram link: sequence numbers,
 * cumulative acks, timed retransmission and an in-order receive buffer.
 * `tick()` must be called regularly (resends and standalone acks).
 */
export class ReliableLink {
  private nextSeq = 0;
  private outstanding: Outstanding[] = [];
  /** Next sequence number we expect from the peer. */
  private expected = 0;
  private buffered = new Map<number, NetMessage>();
  private handlers: ((m: NetMessage) => void)[] = [];
  private ackDue = false;
  private readonly resendMs: number;
  /** When we last heard anything from the peer. */
  lastHeard: number;

  constructor(
    private readonly dgram: Datagram,
    private readonly o: ReliableOptions,
  ) {
    this.resendMs = o.resendMs ?? 120;
    this.lastHeard = o.now();
    dgram.onMessage((d) => this.receive(d));
  }

  send(m: NetMessage): void {
    const seq = this.nextSeq++;
    const data = JSON.stringify({ s: seq, a: this.expected - 1, m } satisfies Frame);
    this.outstanding.push({ seq, data, sentAt: this.o.now(), tries: 1 });
    this.dgram.send(data);
    this.ackDue = false;
  }

  onMessage(h: (m: NetMessage) => void): void {
    this.handlers.push(h);
  }

  /** Retransmit what timed out, send a standalone ack if one is owed. */
  tick(): void {
    const now = this.o.now();
    for (const p of this.outstanding) {
      // Exponential backoff, capped, so a dead link does not flood.
      const wait = Math.min(2000, this.resendMs * 2 ** (p.tries - 1));
      if (now - p.sentAt < wait) continue;
      p.sentAt = now;
      p.tries++;
      this.dgram.send(p.data);
    }
    if (this.ackDue) {
      this.ackDue = false;
      this.dgram.send(JSON.stringify({ a: this.expected - 1 } satisfies Frame));
    }
  }

  /** Packets sent but not yet acknowledged. */
  get unacked(): number {
    return this.outstanding.length;
  }

  close(): void {
    this.dgram.close();
  }

  private receive(data: string): void {
    let f: Frame;
    try {
      f = JSON.parse(data) as Frame;
    } catch {
      return;
    }
    this.lastHeard = this.o.now();
    // Their ack releases our outstanding packets.
    if (typeof f.a === 'number') this.outstanding = this.outstanding.filter((p) => p.seq > f.a);
    if (f.s === undefined || f.m === undefined) return;
    this.ackDue = true;
    if (f.s < this.expected || this.buffered.has(f.s)) return; // duplicate
    this.buffered.set(f.s, f.m);
    while (this.buffered.has(this.expected)) {
      const m = this.buffered.get(this.expected)!;
      this.buffered.delete(this.expected);
      this.expected++;
      for (const h of this.handlers) h(m);
    }
  }
}

/** A Transport to every peer, each over its own ReliableLink. */
export class ReliableTransport implements Transport {
  private handlers: ((m: NetMessage) => void)[] = [];

  constructor(readonly links: ReliableLink[]) {
    for (const l of links) l.onMessage((m) => this.handlers.forEach((h) => h(m)));
  }

  send(msg: NetMessage): void {
    for (const l of this.links) l.send(msg);
  }

  onMessage(handler: (msg: NetMessage) => void): void {
    this.handlers.push(handler);
  }

  tick(): void {
    for (const l of this.links) l.tick();
  }

  /** Milliseconds since we last heard from the quietest peer. */
  silenceMs(now: number): number {
    return Math.max(0, ...this.links.map((l) => now - l.lastHeard));
  }

  close(): void {
    for (const l of this.links) l.close();
  }
}

/**
 * Test link pair over a scheduler: one-way delay with jitter, random loss and
 * reordering, like the public internet on a bad day.
 */
export function lossyPair(o: {
  schedule: (delayMs: number, fn: () => void) => void;
  latencyMs: number;
  jitterMs: number;
  lossPct: number;
  random: () => number;
}): [Datagram, Datagram] {
  const make = () => {
    const handlers: ((d: string) => void)[] = [];
    let closed = false;
    let peer: { deliver: (d: string) => void } | null = null;
    const end = {
      deliver: (d: string) => {
        if (!closed) handlers.forEach((h) => h(d));
      },
      dgram: {
        send: (d: string) => {
          if (closed || !peer || o.random() * 100 < o.lossPct) return;
          const target = peer;
          o.schedule(o.latencyMs + (o.random() * 2 - 1) * o.jitterMs, () => target.deliver(d));
        },
        onMessage: (h: (d: string) => void) => void handlers.push(h),
        close: () => void (closed = true),
      } satisfies Datagram,
      connect: (p: { deliver: (d: string) => void }) => void (peer = p),
    };
    return end;
  };
  const a = make();
  const b = make();
  a.connect(b);
  b.connect(a);
  return [a.dgram, b.dgram];
}
