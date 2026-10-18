import { ReliableLink, ReliableTransport, lossyPair, type ChatMessage, type Datagram, type NetMessage } from '@signal-fall/net';

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

  constructor(
    dgrams: Datagram[],
    private readonly toWorker: (msg: NetMessage) => void,
  ) {
    this.transport = new ReliableTransport(dgrams.map((d) => new ReliableLink(d, { now: () => performance.now() })));
    this.transport.onMessage((m) => (m.kind === 'chat' ? this.onChat(m) : this.toWorker(m)));
    this.timer = window.setInterval(() => {
      this.transport.tick();
      if (!this.lost && this.transport.silenceMs(performance.now()) > PEER_TIMEOUT_MS) {
        this.lost = true;
        this.onPeerLost();
      }
    }, 20);
  }

  /** A lockstep message from our worker for the other peers. */
  send(msg: NetMessage): void {
    this.transport.send(msg);
  }

  close(): void {
    window.clearInterval(this.timer);
    this.transport.close();
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
