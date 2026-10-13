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

export interface Account {
  id: string;
  name: string;
  /** Anonymous: lives only in this browser until an email is confirmed. */
  guest: boolean;
  email: string | null;
  /** An email waiting for confirmation (guest saving their account). */
  pendingEmail: string | null;
}

/** Where email links return to: this page, without query or hash. */
const returnUrl = () => `${location.origin}${location.pathname}`;

/** The signed-in player's account (signing in as a guest first if needed). */
export async function account(sb: SupabaseClient): Promise<Account> {
  const id = await signIn(sb);
  const [{ data: user }, { data: profile }] = await Promise.all([sb.auth.getUser(), sb.from('profiles').select('display_name, guest').eq('id', id).maybeSingle()]);
  const u = user.user;
  return {
    id,
    name: (profile?.display_name as string | undefined) ?? 'Commander',
    guest: u?.is_anonymous ?? (profile?.guest as boolean | undefined) ?? true,
    email: u?.email || null,
    pendingEmail: (u?.new_email as string | undefined) || null,
  };
}

/** Readable messages for the errors players can cause. */
function friendly(message: string): string {
  if (/duplicate key|profiles_display_name_key/i.test(message)) return 'That name is taken.';
  if (/check constraint/i.test(message)) return 'Names are 3–20 letters, digits, spaces, dots, dashes or underscores.';
  if (/already been registered|already registered|email_exists/i.test(message)) return 'That email already has an account. Use “Sign in” instead.';
  if (/rate limit/i.test(message)) return 'Too many emails for now. Try again in a while.';
  return message;
}

export async function rename(sb: SupabaseClient, name: string): Promise<void> {
  const id = await signIn(sb);
  const { error } = await sb.from('profiles').update({ display_name: name.trim() }).eq('id', id);
  if (error) throw new Error(friendly(error.message));
}

/**
 * Guest → permanent: confirm an email address. Same user, so name and history stay.
 * Returns true when a confirmation email is on its way, false if the change applied
 * at once (a backend without email confirmation).
 */
export async function saveAccount(sb: SupabaseClient, email: string): Promise<boolean> {
  await signIn(sb);
  const { data, error } = await sb.auth.updateUser({ email: email.trim() }, { emailRedirectTo: returnUrl() });
  if (error) throw new Error(friendly(error.message));
  return !!data.user?.new_email;
}

/** Sign in to an existing account with an email link (replaces the guest in this browser). */
export async function signInWithEmail(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: returnUrl() } });
  if (error) throw new Error(/signups not allowed|not found/i.test(error.message) ? 'No account with that email. Save your guest account first.' : friendly(error.message));
}

/** Sign out; the next online action starts a fresh guest. */
export async function signOut(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut();
}

/**
 * Coming back from an email link: let the client take the session from the URL,
 * then clean the address bar. Returns what happened, for a one-line notice.
 */
export async function finishEmailLink(sb: SupabaseClient): Promise<string | null> {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const error = hash.get('error_description') ?? query.get('error_description');
  const message = hash.get('message');
  const type = hash.get('type');
  if (!error && !message && !hash.has('access_token') && !query.has('code')) return null;
  await sb.auth.getSession();
  history.replaceState(null, '', returnUrl());
  if (error) return `Sign-in link failed: ${error}`;
  if (message) return message; // e.g. "confirm the link sent to the other email" during a change
  return type === 'email_change' || type === 'signup' ? 'Account saved. You can now sign in with your email on any device.' : 'Signed in.';
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
