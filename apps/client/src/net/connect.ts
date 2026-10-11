import { BroadcastSignaling, type Signaling } from './signaling';

/**
 * Signaling for a room. Until the Supabase project is configured (M8), rooms
 * only work between tabs of the same browser.
 */
export function makeSignaling(room: string): Signaling {
  return new BroadcastSignaling(room);
}

export function signalingKind(): string {
  return 'this browser only (online signaling not configured yet)';
}
