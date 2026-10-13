// Profiles and guest → permanent accounts against a running Supabase stack.
// Skipped unless SUPABASE_URL and SUPABASE_ANON_KEY are set.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function player(): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('no user');
  return { sb, id: data.user.id };
}

const profile = (sb: SupabaseClient, id: string) => sb.from('profiles').select('display_name, guest').eq('id', id).single();
const unique = (base: string) => `${base}${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!URL || !ANON)('accounts', () => {
  let a: { sb: SupabaseClient; id: string };
  let b: { sb: SupabaseClient; id: string };
  beforeAll(async () => {
    a = await player();
    b = await player();
  });

  it('every new guest gets a profile', async () => {
    const p = await profile(a.sb, a.id);
    expect(p.data?.display_name).toMatch(/^Commander [0-9a-f]{6}$/);
    expect(p.data?.guest).toBe(true);
    // Others can read it (lobby names, leaderboard).
    expect((await profile(b.sb, a.id)).data?.display_name).toBe(p.data?.display_name);
  });

  it('players rename themselves, not others; names are valid and unique', async () => {
    const name = unique('Ace');
    expect((await a.sb.from('profiles').update({ display_name: name }).eq('id', a.id)).error).toBeNull();
    expect((await profile(a.sb, a.id)).data?.display_name).toBe(name);
    // Someone else's row: silently untouched under RLS.
    await b.sb.from('profiles').update({ display_name: unique('Pwned') }).eq('id', a.id);
    expect((await profile(a.sb, a.id)).data?.display_name).toBe(name);
    // Taken (case-insensitive), too short, bad characters.
    expect((await b.sb.from('profiles').update({ display_name: name.toUpperCase() }).eq('id', b.id)).error).not.toBeNull();
    expect((await b.sb.from('profiles').update({ display_name: 'x' }).eq('id', b.id)).error).not.toBeNull();
    expect((await b.sb.from('profiles').update({ display_name: '<script>' }).eq('id', b.id)).error).not.toBeNull();
  });

  it('players cannot make themselves non-guests or create profiles', async () => {
    expect((await a.sb.from('profiles').update({ guest: false }).eq('id', a.id)).error).not.toBeNull();
    expect((await a.sb.from('profiles').insert({ id: crypto.randomUUID(), display_name: unique('Ghost') })).error).not.toBeNull();
  });

  it.skipIf(!SERVICE)('confirming an email turns the guest into a permanent account, same id and name', async () => {
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const c = await player();
    const name = unique('Keeper');
    await c.sb.from('profiles').update({ display_name: name }).eq('id', c.id);
    const { error } = await admin.auth.admin.updateUserById(c.id, { email: `${name.toLowerCase()}@example.com`, email_confirm: true });
    expect(error).toBeNull();
    const p = await profile(c.sb, c.id);
    expect(p.data).toEqual({ display_name: name, guest: false });
  });
});
