// Row level security against a running Supabase stack (`supabase start`).
// Skipped unless SUPABASE_URL and SUPABASE_ANON_KEY are set (CI sets them from `supabase status`).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');

async function player(): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('no user');
  return { sb, id: data.user.id };
}

describe.skipIf(!URL || !ANON)('backend row level security', () => {
  let a: { sb: SupabaseClient; id: string };
  let b: { sb: SupabaseClient; id: string };
  beforeAll(async () => {
    a = await player();
    b = await player();
  });

  it('anonymous players can sign in', () => {
    expect(a.id).not.toBe(b.id);
  });

  it('a host creates a room that others can read but not change', async () => {
    const room = code();
    expect((await a.sb.from('rooms').insert({ code: room })).error).toBeNull();
    const seen = await b.sb.from('rooms').select('code, status').eq('code', room).single();
    expect(seen.data?.status).toBe('open');
    await b.sb.from('rooms').update({ status: 'closed' }).eq('code', room);
    expect((await a.sb.from('rooms').select('status').eq('code', room).single()).data?.status).toBe('open');
    await b.sb.from('rooms').delete().eq('code', room);
    expect((await a.sb.from('rooms').select('code').eq('code', room)).data).toHaveLength(1);
    expect((await a.sb.from('rooms').update({ status: 'playing' }).eq('code', room)).error).toBeNull();
    expect((await b.sb.from('rooms').select('status').eq('code', room).single()).data?.status).toBe('playing');
  });

  it("nobody can create a room in someone else's name, or with a bad code", async () => {
    expect((await b.sb.from('rooms').insert({ code: code(), host: a.id })).error).not.toBeNull();
    expect((await a.sb.from('rooms').insert({ code: 'abc' })).error).not.toBeNull();
  });

  it('desync reports are write-only for players', async () => {
    const r = await a.sb.from('desync_reports').insert({ tick: 100, local_hash: 1, remote_hash: 2, report: { commands: [] } });
    expect(r.error).toBeNull();
    expect((await a.sb.from('desync_reports').select('id')).data).toHaveLength(0);
    if (SERVICE) {
      const admin = createClient(URL!, SERVICE, { auth: { persistSession: false } });
      expect((await admin.from('desync_reports').select('id')).data!.length).toBeGreaterThan(0);
    }
  });

  it('realtime broadcast carries signaling between two players', async () => {
    const room = `room:${code()}`;
    const got = new Promise<unknown>((resolve) => {
      b.sb
        .channel(room, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'signal' }, ({ payload }) => resolve(payload))
        .subscribe();
    });
    const ch = a.sb.channel(room, { config: { broadcast: { self: false } } });
    await new Promise<void>((resolve) => ch.subscribe((s) => s === 'SUBSCRIBED' && resolve()));
    // Give the receiver a moment to finish joining.
    await new Promise((r) => setTimeout(r, 500));
    await ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'hello', from: 'x' } });
    expect(await got).toEqual({ type: 'hello', from: 'x' });
  });

  it('the TURN function needs a signed-in player and answers with ICE servers', async () => {
    const anonymous = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const denied = await anonymous.functions.invoke('turn-credentials', { method: 'POST' });
    expect(denied.error).not.toBeNull();
    const ok = await a.sb.functions.invoke<{ iceServers: unknown[] }>('turn-credentials', { method: 'POST' });
    expect(ok.error).toBeNull();
    expect(ok.data!.iceServers.length).toBeGreaterThan(0);
  });
});
