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

  it('a host lists a room publicly; others see it but cannot change it', async () => {
    const c = code();
    expect((await a.sb.from('rooms').insert({ code: c })).error).toBeNull();
    await a.sb.from('rooms').update({ public: true, title: 'Test game', open_seats: 1, updated_at: new Date().toISOString() }).eq('code', c);
    const seen = await b.sb.from('rooms').select('code, title').eq('public', true).eq('code', c);
    expect(seen.data).toEqual([{ code: c, title: 'Test game' }]);
    await b.sb.from('rooms').update({ public: false }).eq('code', c);
    expect((await b.sb.from('rooms').select('public').eq('code', c).single()).data?.public).toBe(true);
  });

  it('the ranked queue pairs two waiting players into one fresh room', async () => {
    const c = await player();
    const d = await player();
    expect((await c.sb.from('queue').insert({})).error).toBeNull();
    // Alone in the queue: no match yet. (Other test players may be waiting too: only look at our pair.)
    expect((await d.sb.from('queue').insert({})).error).toBeNull();
    const first = await c.sb.rpc('find_match');
    expect(first.error).toBeNull();
    const mine = (first.data as { code: string; host: boolean }[])[0]!;
    expect(mine.host).toBe(true);
    const theirs = (await d.sb.rpc('find_match')).data as { code: string; host: boolean }[];
    expect(theirs[0]).toEqual({ code: mine.code, host: false });
    expect((await d.sb.from('rooms').select('status').eq('code', mine.code).single()).data?.status).toBe('open');
    // Nobody can see or change someone else's place in the queue.
    expect((await c.sb.from('queue').select('player').eq('player', d.id)).data).toHaveLength(0);
    expect((await c.sb.from('queue').insert({ player: d.id })).error).not.toBeNull();
    await c.sb.from('queue').delete().eq('player', c.id);
    await d.sb.from('queue').delete().eq('player', d.id);
  });

  it('daily challenge keeps each player's fastest win and ranks them', async () => {
    const c = await player();
    expect((await c.sb.rpc('submit_daily', { win_ticks: 20000, hash: 1 })).data).toBe(20000);
    expect((await c.sb.rpc('submit_daily', { win_ticks: 25000, hash: 2 })).data).toBe(20000);
    expect((await c.sb.rpc('submit_daily', { win_ticks: 15000, hash: 3 })).data).toBe(15000);
    const day = new Date().toISOString().slice(0, 10);
    const mine = await c.sb.from('daily_board').select('ticks').eq('day', day).eq('player', c.id).single();
    expect(mine.data?.ticks).toBe(15000);
    // Nobody writes scores directly.
    expect((await c.sb.from('daily_scores').insert({ day, ticks: 1 })).error).not.toBeNull();
  });

  it('crash reports are write-only for players and size-capped', async () => {
    const r = await a.sb.from('client_errors').insert({ message: 'boom', stack: 'at x', path: '/play/', context: 'menu', client_version: 'test' });
    expect(r.error).toBeNull();
    expect((await a.sb.from('client_errors').select('id')).data).toHaveLength(0);
    expect((await a.sb.from('client_errors').insert({ message: 'x'.repeat(3000) })).error).not.toBeNull();
    // Nobody files a report in someone else's name.
    expect((await a.sb.from('client_errors').insert({ message: 'spoof', reporter: b.id })).error).not.toBeNull();
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
