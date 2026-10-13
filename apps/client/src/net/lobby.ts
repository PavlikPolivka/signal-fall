import type { Biome, MapSize, Resources, TerrainStyle } from '@signal-fall/mapgen';
import type { ScenarioSpec } from '../protocol';
import { PeerLink } from './webrtc';
import type { Signaling } from './signaling';

export interface LobbyPlayer {
  id: string;
  name: string;
  faction: number;
  slot: number;
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
  players: LobbyPlayer[];
  map: LobbyMap;
  seed: number;
}

export const ROOM_SIZE = 2;

/** Room codes avoid look-alike letters. */
export function roomCode(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

/**
 * A 1v1 lobby over a signaling channel. The host owns the room state and
 * broadcasts it; the guest says hello until it appears in the state. Both
 * open a WebRTC link as soon as there are two players; the host starts.
 */
export class Lobby {
  state: LobbyState | null = null;
  link: PeerLink | null = null;
  error: string | null = null;
  private timers: number[] = [];
  private readonly unsubscribe: () => void;
  /** Called on every state change (UI refresh). */
  onChange: () => void = () => undefined;
  /** Called once when the match starts, with our slot and the connected link. */
  onStart: (scenario: ScenarioSpec, slot: number, link: PeerLink) => void = () => undefined;

  constructor(
    readonly signaling: Signaling,
    readonly isHost: boolean,
    private me: { name: string; faction: number },
    code: string,
    private readonly rtc: { iceServers?: RTCIceServer[]; relayOnly?: boolean } = {},
  ) {
    this.unsubscribe = signaling.onMessage((m) => {
      if (this.isHost) {
        if (m.type === 'hello') this.admit(m.from, m.data as { name: string; faction: number });
        else if (m.type === 'choose') this.updatePlayer(m.from, m.data as { faction: number });
        else if (m.type === 'leave') this.drop(m.from);
      } else if (m.type === 'lobby') {
        this.state = m.data as LobbyState;
        if (!this.link && this.state.players.some((p) => p.id === this.signaling.id)) this.connect(this.state.host, false);
        this.onChange();
      } else if (m.type === 'start' && this.link) {
        this.onStart((m.data as { scenario: ScenarioSpec }).scenario, this.mySlot(), this.link);
      } else if (m.type === 'full') {
        this.error = 'That room is full';
        this.onChange();
      }
    });
    if (isHost) {
      this.state = {
        code,
        host: signaling.id,
        players: [{ id: signaling.id, name: me.name, faction: me.faction, slot: 0 }],
        map: { size: 'M', biome: 'wasteland', resources: 'normal', terrain: 'normal' },
        seed: Math.floor(Math.random() * 1_000_000),
      };
      // Rebroadcast now and then, in case a message was missed.
      this.timers.push(window.setInterval(() => this.broadcast(), 2000));
    } else {
      const hello = () => {
        if (!this.state?.players.some((p) => p.id === signaling.id)) signaling.send('hello', this.me);
      };
      hello();
      this.timers.push(window.setInterval(hello, 1000));
    }
  }

  mySlot(): number {
    return this.state?.players.find((p) => p.id === this.signaling.id)?.slot ?? 0;
  }

  get canStart(): boolean {
    return this.isHost && (this.state?.players.length ?? 0) === ROOM_SIZE && this.linkOpen;
  }

  linkOpen = false;

  setFaction(faction: number): void {
    this.me.faction = faction;
    if (this.isHost) this.updatePlayer(this.signaling.id, { faction });
    else this.signaling.send('choose', { faction });
  }

  /** Host: change the map options or the seed; the guest sees them on the next broadcast. */
  setMap({ seed, ...map }: Partial<LobbyMap> & { seed?: number }): void {
    if (!this.isHost || !this.state) return;
    this.state.map = { ...this.state.map, ...map };
    if (seed !== undefined) this.state.seed = seed;
    this.broadcast();
  }

  /** Host: start the match for both. */
  start(): void {
    if (!this.canStart || !this.state || !this.link) return;
    const s = this.state;
    const bySlot = [...s.players].sort((a, b) => a.slot - b.slot);
    const scenario: ScenarioSpec = {
      kind: 'skirmish',
      seed: s.seed,
      factions: bySlot.map((p) => p.faction),
      ai: bySlot.map(() => null),
      humans: bySlot.map((p) => p.slot),
      map: s.map,
    };
    this.signaling.send('start', { scenario });
    this.onStart(scenario, 0, this.link);
  }

  close(): void {
    this.signaling.send('leave');
    for (const t of this.timers) window.clearInterval(t);
    this.unsubscribe();
    this.signaling.close();
  }

  private admit(id: string, who: { name: string; faction: number }): void {
    const s = this.state!;
    if (s.players.some((p) => p.id === id)) return this.broadcast();
    if (s.players.length >= ROOM_SIZE) return this.signaling.send('full', undefined, id);
    s.players.push({ id, name: who.name, faction: who.faction, slot: 1 });
    this.connect(id, true);
    this.broadcast();
  }

  private updatePlayer(id: string, change: { faction: number }): void {
    const p = this.state?.players.find((x) => x.id === id);
    if (!p) return;
    p.faction = change.faction;
    this.broadcast();
  }

  private drop(id: string): void {
    const s = this.state!;
    s.players = s.players.filter((p) => p.id !== id);
    this.link?.close();
    this.link = null;
    this.linkOpen = false;
    this.broadcast();
  }

  private connect(remote: string, initiator: boolean): void {
    this.link = new PeerLink(this.signaling, remote, initiator, this.rtc);
    void this.link.ready.then(() => {
      this.linkOpen = true;
      this.onChange();
    });
  }

  private broadcast(): void {
    if (!this.state) return;
    this.signaling.send('lobby', this.state);
    this.onChange();
  }
}
