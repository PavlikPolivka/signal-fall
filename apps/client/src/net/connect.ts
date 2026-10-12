import { BroadcastSignaling, type Signaling } from './signaling';
import { backend, createRoom, iceServers, roomOpen, setRoomStatus, signIn, SupabaseSignaling } from './backend';
import { DEFAULT_ICE } from './webrtc';

export interface RoomConnection {
  code: string;
  signaling: Signaling;
  iceServers: RTCIceServer[];
  /** Mark the room as playing (host) so nobody else joins. */
  started: () => void;
  close: () => void;
}

/**
 * Open (host) or join a room. With a Supabase backend: anonymous sign-in, a
 * rooms row, Realtime signaling and TURN credentials. Without one: rooms only
 * work between tabs of this browser.
 */
export async function openRoom(host: boolean, code: string, makeCode: () => string): Promise<RoomConnection> {
  const sb = backend();
  if (!sb) return { code, signaling: new BroadcastSignaling(code), iceServers: DEFAULT_ICE, started: () => undefined, close: () => undefined };
  await signIn(sb);
  const room = host ? await createRoom(sb, makeCode) : code;
  if (!host && !(await roomOpen(sb, room))) throw new Error('No open room with that code');
  const ice = await iceServers(sb);
  return {
    code: room,
    signaling: new SupabaseSignaling(sb, room),
    iceServers: ice,
    started: () => void setRoomStatus(sb, room, 'playing'),
    close: () => {
      if (host) void setRoomStatus(sb, room, 'closed');
    },
  };
}

export function signalingKind(): string {
  return backend() ? 'online' : 'this browser only (no backend configured)';
}
