import type { Datagram } from '@signal-fall/net';
import type { Difficulty } from '@signal-fall/ai';
import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
import type { ScenarioSpec } from '../protocol';
import { PeerLink } from './webrtc';
import type { Signaling } from './signaling';

export type LobbyMode = '1v1' | '2v2';

export interface LobbyPlayer {
  /** Signaling id (this connection). */
  id: string;
  /** Account id (for the match record), when online. */
  uid?: string;
  name: string;
}

/** A seat in the match: a person, an AI, or still open for someone to join. */
export interface LobbySlot {
  team: number;
  kind: 'open' | 'human' | 'ai';
  faction: number;
  /** For AI seats. */
  difficulty: Difficulty;
  player?: LobbyPlayer;
}

export interface LobbyMap {
  size: MapSize;
  biome: Biome;
  resources: Resources;
  terrain: TerrainStyle;
}

export interface LobbyState {
  code: string;
  host: string;
  mode: LobbyMode;
  /** 1v1: slots 0 and 1 on teams 0 and 1. 2v2: slots 0, 1 (team 0) against 2, 3 (team 1). */
  slots: LobbySlot[];
  map: LobbyMap;
  seed: number;
  /** People whose connections to every other person are open. */
  ready: string[];
}

/** A connection to one other person; PeerLink in the browser, a fake in tests. */
export interface LinkLike {
  ready: Promise<Datagram>;
  onFailed: () => void;
  close(): void;
}

export type LinkFactory = (remote: string, initiator: boolean) => LinkLike;

/** Room codes avoid look-alike letters. */
export function roomCode(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

function emptySlots(mode: LobbyMode): LobbySlot[] {
  const teams = mode === '2v2' ? [0, 0, 1, 1] : [0, 1];
  return teams.map((team, k) => ({ team, kind: 'open', faction: k % 3, difficulty: 'normal' }));
}

/** The match a lobby describes: per slot faction, AI, team; people's slots are `humans`. */
export function scenarioOf(s: LobbyState): ScenarioSpec {
  return {
    kind: 'skirmish',
    seed: s.seed,
    factions: s.slots.map((x) => x.faction),
    ai: s.slots.map((x) => (x.kind === 'ai' ? x.difficulty : null)),
    humans: s.slots.flatMap((x, k) => (x.kind === 'human' ? [k] : [])),
    teams: s.slots.map((x) => x.team),
    map: s.map,
  };
}

/**
 * A multiplayer lobby over a signaling channel, for 1v1 or 2v2 with any mix of
 * people and AI. The host owns the room state and broadcasts it; others say
 * hello until they have a seat. Every pair of people opens its own WebRTC link
 * (a full mesh; the lower id offers). The host starts once every seat is taken
 * and everyone reports all their links open.
 */
export class Lobby {
  state: LobbyState | null = null;
  error: string | null = null;
  /** Links to the other people, by their signaling id. */
  readonly links = new Map<string, LinkLike>();
  private readonly open = new Set<string>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly unsubscribe: () => void;
  private readonly connect: LinkFactory;
  /** Called on every state change (UI refresh). */
  onChange: () => void = () => undefined;
  /** Called once when the match starts: scenario, our slot, links to the other people by slot, and the room. */
  onStart: (scenario: ScenarioSpec, slot: number, links: Map<number, LinkLike>, room: LobbyState) => void = () => undefined;

  constructor(
    readonly signaling: Signaling,
    readonly isHost: boolean,
    private me: { name: string; faction: number; uid?: string },
    code: string,
    rtc: { iceServers?: RTCIceServer[]; relayOnly?: boolean } | LinkFactory = {},
  ) {
    this.connect = typeof rtc === 'function' ? rtc : (remote, initiator) => new PeerLink(signaling, remote, initiator, rtc);
    this.unsubscribe = signaling.onMessage((m) => {
      if (this.isHost) {
        if (m.type === 'hello') this.admit(m.from, m.data as { name: string; faction: number; uid?: string });
        else if (m.type === 'choose') this.update(m.from, (slot) => (slot.faction = (m.data as { faction: number }).faction));
        else if (m.type === 'move') this.move(m.from, (m.data as { slot: number }).slot);
        else if (m.type === 'links') this.markReady(m.from, (m.data as { ready: boolean }).ready);
        else if (m.type === 'leave') this.drop(m.from);
      } else if (m.type === 'lobby') {
        this.state = m.data as LobbyState;
        this.syncLinks();
        this.onChange();
      } else if (m.type === 'start') {
        this.begin((m.data as { scenario: ScenarioSpec }).scenario);
      } else if (m.type === 'full') {
        this.error = 'That room is full';
        this.onChange();
      }
    });
    if (isHost) {
      const slots = emptySlots('1v1');
      slots[0] = { ...slots[0]!, kind: 'human', faction: me.faction, player: { id: signaling.id, uid: me.uid, name: me.name } };
      this.state = {
        code,
        host: signaling.id,
        mode: '1v1',
        slots,
        map: { size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal' },
        seed: Math.floor(Math.random() * 1_000_000),
        ready: [],
      };
      // Rebroadcast now and then, in case a message was missed.
      this.timers.push(setInterval(() => this.broadcast(), 2000));
    } else {
      const hello = () => {
        if (!this.seated()) signaling.send('hello', this.me);
      };
      hello();
      this.timers.push(setInterval(hello, 1000));
    }
  }

  get myId(): string {
    return this.signaling.id;
  }

  mySlot(): number {
    return this.state?.slots.findIndex((s) => s.player?.id === this.myId) ?? -1;
  }

  private seated(): boolean {
    return this.mySlot() >= 0;
  }

  /** Every link of ours is open (trivially true with nobody else seated). */
  get linksOpen(): boolean {
    return [...this.links.keys()].every((id) => this.open.has(id));
  }

  get canStart(): boolean {
    const s = this.state;
    if (!this.isHost || !s) return false;
    const people = s.slots.filter((x) => x.kind === 'human');
    return !s.slots.some((x) => x.kind === 'open') && people.length >= 2 && people.every((x) => s.ready.includes(x.player!.id));
  }

  // --- anyone ---

  setFaction(faction: number): void {
    this.me.faction = faction;
    if (this.isHost) this.update(this.myId, (slot) => (slot.faction = faction));
    else this.signaling.send('choose', { faction });
  }

  /** Take another open seat (e.g. switch teams). */
  moveTo(slot: number): void {
    if (this.isHost) this.move(this.myId, slot);
    else this.signaling.send('move', { slot });
  }

  // --- host ---

  setMode(mode: LobbyMode): void {
    const s = this.state;
    if (!this.isHost || !s || s.mode === mode) return;
    const people = s.slots.filter((x) => x.kind === 'human');
    const slots = emptySlots(mode);
    if (people.length > slots.length) return; // 2v2 → 1v1 with three people: not possible.
    // The host keeps seat 0; the others fill seats from the far team first, so 1v1 → 2v2 stays a fair split.
    const order = mode === '2v2' ? [0, 2, 1, 3] : [0, 1];
    people.forEach((p, i) => (slots[order[i]!] = { ...slots[order[i]!]!, kind: 'human', faction: p.faction, player: p.player }));
    s.mode = mode;
    s.slots = slots;
    this.broadcast();
  }

  /** Turn a free seat into an AI or back into an open seat. */
  setSeat(slot: number, kind: 'open' | 'ai'): void {
    const x = this.state?.slots[slot];
    if (!this.isHost || !x || x.kind === 'human') return;
    x.kind = kind;
    this.broadcast();
  }

  setAi(slot: number, patch: { faction?: number; difficulty?: Difficulty }): void {
    const x = this.state?.slots[slot];
    if (!this.isHost || !x || x.kind !== 'ai') return;
    Object.assign(x, patch);
    this.broadcast();
  }

  /** Host: change the map options or the seed; the others see them on the next broadcast. */
  setMap({ seed, ...map }: Partial<LobbyMap> & { seed?: number }): void {
    if (!this.isHost || !this.state) return;
    this.state.map = { ...this.state.map, ...map };
    if (seed !== undefined) this.state.seed = seed;
    this.broadcast();
  }

  /** Host: start the match for everyone. */
  start(): void {
    if (!this.canStart || !this.state) return;
    const scenario = scenarioOf(this.state);
    this.signaling.send('start', { scenario });
    this.begin(scenario);
  }

  close(): void {
    this.signaling.send('leave');
    for (const t of this.timers) clearInterval(t);
    // Once the match started, the links belong to it.
    if (!this.started) for (const l of this.links.values()) l.close();
    this.unsubscribe();
    this.signaling.close();
  }

  // --- internals ---

  private started = false;

  private begin(scenario: ScenarioSpec): void {
    const s = this.state;
    const me = this.mySlot();
    if (!s || me < 0 || this.started) return;
    this.started = true;
    const bySlot = new Map<number, LinkLike>();
    s.slots.forEach((x, k) => {
      const link = x.player && x.player.id !== this.myId ? this.links.get(x.player.id) : undefined;
      if (link) bySlot.set(k, link);
    });
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.onStart(scenario, me, bySlot, s);
  }

  private admit(id: string, who: { name: string; faction: number; uid?: string }): void {
    const s = this.state!;
    if (s.slots.some((x) => x.player?.id === id)) return this.broadcast();
    const free = s.slots.findIndex((x) => x.kind === 'open');
    if (free < 0) return this.signaling.send('full', undefined, id);
    s.slots[free] = { ...s.slots[free]!, kind: 'human', faction: who.faction, player: { id, uid: who.uid, name: who.name } };
    this.broadcast();
  }

  private update(id: string, change: (slot: LobbySlot) => void): void {
    const slot = this.state?.slots.find((x) => x.player?.id === id);
    if (!slot) return;
    change(slot);
    this.broadcast();
  }

  private move(id: string, to: number): void {
    const s = this.state;
    const from = s?.slots.findIndex((x) => x.player?.id === id) ?? -1;
    const target = s?.slots[to];
    if (!s || from < 0 || !target || target.kind !== 'open') return;
    const seat = s.slots[from]!;
    s.slots[to] = { ...target, kind: 'human', faction: seat.faction, player: seat.player };
    s.slots[from] = { ...seat, kind: 'open', player: undefined };
    this.broadcast();
  }

  private markReady(id: string, ready: boolean): void {
    const s = this.state;
    if (!s) return;
    s.ready = s.ready.filter((x) => x !== id);
    if (ready) s.ready.push(id);
    this.broadcast();
  }

  private drop(id: string): void {
    const s = this.state!;
    const k = s.slots.findIndex((x) => x.player?.id === id);
    if (k >= 0) s.slots[k] = { ...s.slots[k]!, kind: 'open', player: undefined };
    s.ready = s.ready.filter((x) => x !== id);
    this.broadcast();
  }

  /** Open links to every other seated person, close links to people who left; tell the host when all are up. */
  private syncLinks(): void {
    const s = this.state;
    if (!s || !this.seated()) return;
    const others = new Set(s.slots.flatMap((x) => (x.player && x.player.id !== this.myId ? [x.player.id] : [])));
    for (const [id, link] of this.links)
      if (!others.has(id)) {
        link.close();
        this.links.delete(id);
        this.open.delete(id);
      }
    for (const id of others) {
      if (this.links.has(id)) continue;
      const link = this.connect(id, this.myId < id);
      this.links.set(id, link);
      void link.ready.then(() => {
        if (this.links.get(id) !== link) return;
        this.open.add(id);
        this.reportReady();
        this.onChange();
      });
    }
    this.reportReady();
  }

  private reportReady(): void {
    const ready = this.linksOpen;
    if (this.isHost) {
      if (this.state && this.state.ready.includes(this.myId) !== ready) this.markReady(this.myId, ready);
      return;
    }
    // Tell the host whenever its view differs from ours (it may have missed a message).
    if (!this.state || this.state.ready.includes(this.myId) === ready) return;
    this.signaling.send('links', { ready });
  }

  private broadcast(): void {
    if (!this.state) return;
    this.syncLinks();
    this.signaling.send('lobby', this.state);
    this.onChange();
  }
}
