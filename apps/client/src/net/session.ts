import { ReliableLink, ReliableTransport, lossyPair, type Datagram, type NetMessage } from '@signal-fall/net';

/** No word from the opponent for this long means they are gone. */
export const PEER_TIMEOUT_MS = 10_000;

/**
 * The main thread's side of a networked match: reliable lockstep messages over
 * the peer's datagram channel, relayed to and from the sim worker.
 */
export class NetSession {
  private readonly transport: ReliableTransport;
  private timer: number;
  private lost = false;
  /** Called when the opponent goes silent for PEER_TIMEOUT_MS. */
  onPeerLost: () => void = () => undefined;

  constructor(
    dgram: Datagram,
    private readonly toWorker: (msg: NetMessage) => void,
  ) {
    this.transport = new ReliableTransport([new ReliableLink(dgram, { now: () => performance.now() })]);
    this.transport.onMessage((m) => this.toWorker(m));
    this.timer = window.setInterval(() => {
      this.transport.tick();
      if (!this.lost && this.transport.silenceMs(performance.now()) > PEER_TIMEOUT_MS) {
        this.lost = true;
        this.onPeerLost();
      }
    }, 20);
  }

  /** A lockstep message from our worker for the opponent. */
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
