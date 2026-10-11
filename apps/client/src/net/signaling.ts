/** A message on a room's signaling channel. `to` addresses one peer; absent means everyone. */
export interface SignalMessage {
  from: string;
  to?: string;
  type: string;
  data?: unknown;
}

/**
 * Room-scoped signaling: lobby state and WebRTC offers/answers/candidates.
 * Implementations: BroadcastChannel (same browser: dev and tests) and Supabase
 * Realtime broadcast (across the internet).
 */
export interface Signaling {
  readonly id: string;
  send(type: string, data?: unknown, to?: string): void;
  /** Subscribe; returns an unsubscribe function. Own messages are never echoed back. */
  onMessage(handler: (m: SignalMessage) => void): () => void;
  close(): void;
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Signaling between tabs of the same browser (development and automated tests). */
export class BroadcastSignaling implements Signaling {
  readonly id = randomId();
  private readonly channel: BroadcastChannel;
  private handlers = new Set<(m: SignalMessage) => void>();

  constructor(room: string) {
    this.channel = new BroadcastChannel(`signal-fall:${room}`);
    this.channel.onmessage = (ev: MessageEvent<SignalMessage>) => {
      const m = ev.data;
      if (m.from === this.id || (m.to && m.to !== this.id)) return;
      for (const h of this.handlers) h(m);
    };
  }

  send(type: string, data?: unknown, to?: string): void {
    this.channel.postMessage({ from: this.id, to, type, data } satisfies SignalMessage);
  }

  onMessage(handler: (m: SignalMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.channel.close();
    this.handlers.clear();
  }
}
