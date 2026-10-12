import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { randomId, type SignalMessage, type Signaling } from './signaling';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

/** The Supabase client, or null when the build has no backend configured (local play, tests). */
export function backend(): SupabaseClient | null {
  if (!URL || !KEY) return null;
  client ??= createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

/** Every player is an anonymous user; the session is kept in local storage. */
export async function signIn(sb: SupabaseClient): Promise<string> {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.user) throw new Error(`could not sign in: ${error?.message ?? 'unknown'}`);
  return signed.user.id;
}

/** Register a new room; retries with a fresh code if one is taken. */
export async function createRoom(sb: SupabaseClient, makeCode: () => string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    const { error } = await sb.from('rooms').insert({ code });
    if (!error) return code;
    if (error.code !== '23505') throw new Error(error.message);
  }
  throw new Error('could not find a free room code');
}

export async function roomOpen(sb: SupabaseClient, code: string): Promise<boolean> {
  const { data } = await sb.from('rooms').select('status').eq('code', code).maybeSingle();
  return data?.status === 'open';
}

export async function setRoomStatus(sb: SupabaseClient, code: string, status: 'playing' | 'closed'): Promise<void> {
  await sb.from('rooms').update({ status, updated_at: new Date().toISOString() }).eq('code', code);
}

/** STUN plus short-lived TURN relay servers from the Edge Function (STUN only if it is unavailable). */
export async function iceServers(sb: SupabaseClient): Promise<RTCIceServer[]> {
  const { data, error } = await sb.functions.invoke<{ iceServers: RTCIceServer[] }>('turn-credentials', { method: 'POST' });
  if (error || !data) return [{ urls: 'stun:stun.l.google.com:19302' }];
  return data.iceServers;
}

export async function fileDesyncReport(sb: SupabaseClient, room: string | null, tick: number, local: number, remote: number, report: string): Promise<boolean> {
  const { error } = await sb.from('desync_reports').insert({
    room_code: room,
    tick,
    local_hash: local,
    remote_hash: remote,
    report: JSON.parse(report),
    client_version: import.meta.env.VITE_VERSION ?? 'dev',
  });
  return !error;
}

/** Room signaling over a Supabase Realtime broadcast channel. Messages sent before the channel is up are queued. */
export class SupabaseSignaling implements Signaling {
  readonly id = randomId();
  private readonly channel: RealtimeChannel;
  private handlers = new Set<(m: SignalMessage) => void>();
  private queue: SignalMessage[] = [];
  private subscribed = false;

  constructor(sb: SupabaseClient, room: string) {
    this.channel = sb.channel(`room:${room}`, { config: { broadcast: { self: false } } });
    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const m = payload as SignalMessage;
      if (m.from === this.id || (m.to && m.to !== this.id)) return;
      for (const h of this.handlers) h(m);
    });
    this.channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      this.subscribed = true;
      for (const m of this.queue) void this.channel.send({ type: 'broadcast', event: 'signal', payload: m });
      this.queue = [];
    });
  }

  send(type: string, data?: unknown, to?: string): void {
    const m: SignalMessage = { from: this.id, to, type, data };
    if (!this.subscribed) this.queue.push(m);
    else void this.channel.send({ type: 'broadcast', event: 'signal', payload: m });
  }

  onMessage(handler: (m: SignalMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    void this.channel.unsubscribe();
    this.handlers.clear();
  }
}
