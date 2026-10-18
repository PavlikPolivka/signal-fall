import { ReliableLink, type CatchupMessage, type Datagram, type NetMessage } from '@signal-fall/net';
import type { Command, ScheduledCommand } from '@signal-fall/sim';
import type { ScenarioSpec } from '../protocol';
import { PeerLink } from './webrtc';
import type { Signaling } from './signaling';

/** A multiplayer match in progress in this tab, kept so a reload can rejoin it. */
export interface InMatch {
  code: string;
  slot: number;
  scenario: ScenarioSpec;
  names: (string | null)[];
  humans: number[];
}

const KEY = 'signalfall.inmatch';

export function rememberMatch(m: InMatch): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // No rejoin after a reload then.
  }
}

export function forgetMatch(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

export function matchToRejoin(): InMatch | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as InMatch) : null;
  } catch {
    return null;
  }
}

/** What we hold of the match, for a player catching up. */
export interface CatchupData {
  log: ScheduledCommand[];
  taken: number;
  inputs: [number, number, Command[]][];
}

/** Commands per catch-up message (keeps each well under data channel limits). */
const PART = 1500;

function sendCatchup(link: ReliableLink, player: number, data: CatchupData): void {
  const parts = Math.max(1, Math.ceil(data.log.length / PART));
  for (let i = 0; i < parts; i++) {
    const last = i === parts - 1;
    link.send({ kind: 'catchup', player, taken: data.taken, log: data.log.slice(i * PART, (i + 1) * PART), inputs: last ? data.inputs : [], last });
  }
}

/**
 * A player still in the match: answers someone coming back on the room channel, opens a new link
 * to them, sends them the match so far, and hands the link over (it replaces the dead one).
 */
export class RejoinHost {
  private readonly links = new Map<string, PeerLink>();
  private readonly early = new Map<string, unknown[]>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly signaling: Signaling,
    private readonly ice: RTCIceServer[],
    private readonly me: number,
    humans: number[],
    catchup: () => Promise<CatchupData>,
    onLink: (slot: number, link: ReliableLink, snapshotTaken: number) => void,
  ) {
    this.unsubscribe = signaling.onMessage((m) => {
      if (m.type === 'rtc') {
        if (!this.links.has(m.from)) this.early.set(m.from, [...(this.early.get(m.from) ?? []), m.data]);
        return;
      }
      if (m.type !== 'rejoin') return;
      const slot = (m.data as { slot: number }).slot;
      if (!humans.includes(slot) || slot === me) return;
      signaling.send('welcome', { slot: me }, m.from);
      if (this.links.has(m.from)) return;
      const early = this.early.get(m.from) ?? [];
      this.early.delete(m.from);
      const link = new PeerLink(signaling, m.from, signaling.id < m.from, { iceServers: ice }, early);
      this.links.set(m.from, link);
      void link.ready.then(async (dgram) => {
        const rl = new ReliableLink(dgram, { now: () => performance.now() });
        const data = await catchup();
        sendCatchup(rl, me, data);
        onLink(slot, rl, data.taken);
      });
    });
  }

  close(): void {
    this.unsubscribe();
    for (const l of this.links.values()) l.close();
    this.signaling.close();
  }
}

/** The merged catch-up a returning player starts from. */
export interface Rejoined {
  /** New links to the other players, by slot. */
  links: Map<number, ReliableLink>;
  log: ScheduledCommand[];
  taken: number;
  inputs: [number, number, Command[]][];
  ownNext: number;
  /**
   * Hand over what arrived on the links after the catch-up (turns sent meanwhile). Call right after
   * the session takes the links over, in the same task, so nothing is delivered twice or lost.
   */
  release: (deliver: (m: NetMessage) => void) => void;
}

/**
 * Coming back after a reload: ask the room for the others, link up with each, and take the most
 * advanced player's log plus everyone's held inputs. Fails after `timeoutMs`.
 */
export function rejoin(signaling: Signaling, ice: RTCIceServer[], m: InMatch, timeoutMs = 30_000): Promise<Rejoined> {
  const others = m.humans.filter((p) => p !== m.slot);
  const links = new Map<number, ReliableLink>();
  const peers = new Map<string, PeerLink>();
  const early = new Map<string, unknown[]>();
  const got = new Map<number, { log: ScheduledCommand[]; taken: number; inputs: [number, number, Command[]][] }>();
  const done = new Set<number>();
  // Everything else that arrives before the session takes over is kept, not dropped.
  let held: NetMessage[] | null = [];
  const release = (deliver: (m: NetMessage) => void) => {
    const list = held ?? [];
    held = null;
    for (const m of list) deliver(m);
  };
  return new Promise<Rejoined>((resolve, reject) => {
    const ask = () => signaling.send('rejoin', { slot: m.slot });
    ask();
    const timer = setInterval(ask, 2000);
    const fail = setTimeout(() => {
      finish();
      reject(new Error('The match could not be rejoined'));
    }, timeoutMs);
    const finish = () => {
      clearInterval(timer);
      clearTimeout(fail);
      unsubscribe();
    };
    const unsubscribe = signaling.onMessage((msg) => {
      if (msg.type === 'rtc') {
        if (!peers.has(msg.from)) early.set(msg.from, [...(early.get(msg.from) ?? []), msg.data]);
        return;
      }
      if (msg.type !== 'welcome' || peers.has(msg.from)) return;
      const slot = (msg.data as { slot: number }).slot;
      const link = new PeerLink(signaling, msg.from, signaling.id < msg.from, { iceServers: ice }, early.get(msg.from) ?? []);
      early.delete(msg.from);
      peers.set(msg.from, link);
      void link.ready.then((dgram: Datagram) => {
        const rl = new ReliableLink(dgram, { now: () => performance.now() });
        links.set(slot, rl);
        rl.onMessage((nm) => {
          if (nm.kind !== 'catchup') {
            held?.push(nm);
            return;
          }
          if (done.has(slot)) return;
          const c = nm as CatchupMessage;
          const g = got.get(slot) ?? { log: [], taken: c.taken, inputs: [] };
          g.log.push(...c.log);
          g.inputs.push(...c.inputs);
          got.set(slot, g);
          if (!c.last) return;
          done.add(slot);
          if (!others.every((p) => done.has(p))) return;
          finish();
          // The furthest player's log; everyone's inputs for the turns after it.
          const best = [...got.values()].reduce((a, b) => (b.taken > a.taken ? b : a));
          const inputs = [...got.values()].flatMap((x) => x.inputs).filter(([turn]) => turn > best.taken);
          const own = inputs.filter(([, p]) => p === m.slot).map(([turn]) => turn + 1);
          resolve({ links, log: best.log, taken: best.taken, inputs, ownNext: Math.max(best.taken + 1, ...own), release });
        });
      });
    });
  });
}
