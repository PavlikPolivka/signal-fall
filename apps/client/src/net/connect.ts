import { BroadcastSignaling, type Signaling } from './signaling';
import { advertiseRoom, backend, createRoom, iceServers, roomOpen, setRoomStatus, signIn, SupabaseSignaling } from './backend';
import { DEFAULT_ICE } from './webrtc';

export interface RoomConnection {
  code: string;
  signaling: Signaling;
  iceServers: RTCIceServer[];
  /** Mark the room as playing (host) so nobody else joins. */
  started: () => void;
  /** Host: list the room publicly (or not), refreshing its seats; no-op without a backend. */
  advertise: (info: { public: boolean; title: string; mode: '1v1' | '2v2' | 'ffa3' | 'ffa4'; openSeats: number }) => void;
  close: () => void;
}

/**
 * Open (host) or join a room. With a Supabase backend: anonymous sign-in, a
 * rooms row, Realtime signaling and TURN credentials. Without one: rooms only
 * work between tabs of this browser.
 */
export async function openRoom(host: boolean, code: string, makeCode: () => string, opts: { reopen?: boolean; waitMs?: number } = {}): Promise<RoomConnection> {
  const sb = backend();
  if (!sb) return { code, signaling: new BroadcastSignaling(code), iceServers: DEFAULT_ICE, started: () => undefined, advertise: () => undefined, close: () => undefined };
  await signIn(sb);
  // A rematch reopens the host's own room under the same code.
  if (host && opts.reopen) await setRoomStatus(sb, code, 'open');
  const room = host ? (opts.reopen ? code : await createRoom(sb, makeCode)) : code;
  // Rejoining a rematch: the host may take a moment to reopen the room.
  const until = Date.now() + (opts.waitMs ?? 0);
  while (!host && !(await roomOpen(sb, room))) {
    if (Date.now() > until) throw new Error('No open room with that code');
    await new Promise((r) => setTimeout(r, 1500));
  }
  const ice = await iceServers(sb);
  return {
    code: room,
    signaling: new SupabaseSignaling(sb, room),
    iceServers: ice,
    started: () => void setRoomStatus(sb, room, 'playing'),
    advertise: (info) => void advertiseRoom(sb, room, info),
    close: () => {
      if (host) void setRoomStatus(sb, room, 'closed');
    },
  };
}

/** The room's channel during a match (for players reconnecting), with ICE servers for new links. */
export async function matchChannel(code: string): Promise<{ signaling: Signaling; iceServers: RTCIceServer[] }> {
  const sb = backend();
  if (!sb) return { signaling: new BroadcastSignaling(code), iceServers: DEFAULT_ICE };
  await signIn(sb);
  return { signaling: new SupabaseSignaling(sb, code), iceServers: await iceServers(sb) };
}

export function signalingKind(): string {
  return backend() ? 'online' : 'this browser only (no backend configured)';
}
