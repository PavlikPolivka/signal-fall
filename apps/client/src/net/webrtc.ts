import type { Datagram } from '@signal-fall/net';
import type { Signaling } from './signaling';

/** STUN by default; TURN servers (with credentials) are added for networks that need a relay. */
export const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface RtcSignal {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/**
 * A WebRTC connection to one peer with an unordered, unreliable data channel
 * (lockstep adds its own resends on top, so a lost packet never stalls the
 * ones behind it). The lobby host initiates.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private readonly unsubscribe: () => void;
  /** Resolves with the open channel as a Datagram. */
  readonly ready: Promise<Datagram>;
  private resolveReady!: (d: Datagram) => void;
  onFailed: () => void = () => undefined;

  constructor(
    private readonly signaling: Signaling,
    private readonly remote: string,
    initiator: boolean,
    o: { iceServers?: RTCIceServer[]; relayOnly?: boolean } = {},
  ) {
    this.ready = new Promise((r) => (this.resolveReady = r));
    this.pc = new RTCPeerConnection({ iceServers: o.iceServers ?? DEFAULT_ICE, iceTransportPolicy: o.relayOnly ? 'relay' : 'all' });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal({ candidate: ev.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.onFailed();
    };
    this.pc.ondatachannel = (ev) => this.useChannel(ev.channel);
    this.unsubscribe = signaling.onMessage((m) => {
      if (m.type === 'rtc' && m.from === this.remote) void this.handle(m.data as RtcSignal);
    });
    if (initiator) {
      this.useChannel(this.pc.createDataChannel('lockstep', { ordered: false, maxRetransmits: 0 }));
      void this.offer();
    }
  }

  private signal(s: RtcSignal): void {
    this.signaling.send('rtc', s, this.remote);
  }

  private async offer(): Promise<void> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.signal({ sdp: this.pc.localDescription!.toJSON() });
  }

  private async handle(s: RtcSignal): Promise<void> {
    if (s.sdp) {
      await this.pc.setRemoteDescription(s.sdp);
      for (const c of this.pendingCandidates) await this.pc.addIceCandidate(c);
      this.pendingCandidates = [];
      if (s.sdp.type === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.signal({ sdp: this.pc.localDescription!.toJSON() });
      }
    } else if (s.candidate) {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(s.candidate);
      else this.pendingCandidates.push(s.candidate);
    }
  }

  private useChannel(ch: RTCDataChannel): void {
    this.channel = ch;
    const handlers: ((d: string) => void)[] = [];
    ch.onmessage = (ev) => {
      for (const h of handlers) h(ev.data as string);
    };
    const dgram: Datagram = {
      send: (d) => {
        if (ch.readyState === 'open') ch.send(d);
      },
      onMessage: (h) => void handlers.push(h),
      close: () => this.close(),
    };
    if (ch.readyState === 'open') this.resolveReady(dgram);
    else ch.onopen = () => this.resolveReady(dgram);
  }

  close(): void {
    this.unsubscribe();
    this.channel?.close();
    this.pc.close();
  }
}
