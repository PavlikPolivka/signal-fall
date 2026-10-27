// Campaign progress on saved accounts against a running Supabase stack.
// Skipped unless SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = () => createClient(URL!, ANON!, { auth: { persistSession: false } });

async function guest(): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = client();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('no user');
  return { sb, id: data.user.id };
}

/** A saved (email) account, signed in. */
async function saved(): Promise<{ sb: SupabaseClient; id: string }> {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const email = `progress${Math.floor(Math.random() * 1e9)}@example.com`;
  const password = 'campaign-progress-1';
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sb = client();
  const { data, error: signInError } = await sb.auth.signInWithPassword({ email, password });
  if (signInError || !data.user) throw signInError ?? new Error('no user');
  return { sb, id: data.user.id };
}

const won = async (sb: SupabaseClient, id: string) =>
  ((await sb.from('campaign_progress').select('mission').eq('player', id).order('mission')).data ?? []).map((r) => r.mission as string);

describe.skipIf(!URL || !ANON || !SERVICE)('campaign progress', () => {
  it('a saved account keeps its wins; adding one twice is harmless', async () => {
    const a = await saved();
    const ins = await a.sb.from('campaign_progress').insert([{ player: a.id, mission: 'm1', difficulty: 'normal' }, { player: a.id, mission: 'm2' }]);
    expect(ins.error).toBeNull();
    const again = await a.sb.from('campaign_progress').upsert([{ player: a.id, mission: 'm1' }], { onConflict: 'player,mission', ignoreDuplicates: true });
    expect(again.error).toBeNull();
    expect(await won(a.sb, a.id)).toEqual(['m1', 'm2']);
  });

  it('nobody reads or writes someone else\'s progress, or deletes their own', async () => {
    const a = await saved();
    const b = await saved();
    await a.sb.from('campaign_progress').insert({ player: a.id, mission: 'm1' });
    expect(await won(b.sb, a.id)).toEqual([]);
    expect((await b.sb.from('campaign_progress').insert({ player: a.id, mission: 'm9' })).error).not.toBeNull();
    await a.sb.from('campaign_progress').delete().eq('player', a.id);
    expect(await won(a.sb, a.id)).toEqual(['m1']);
  });

  it('guests keep their progress in the browser only', async () => {
    const g = await guest();
    expect((await g.sb.from('campaign_progress').insert({ player: g.id, mission: 'm1' })).error).not.toBeNull();
  });

  it('players cannot open every mission for themselves', async () => {
    const a = await saved();
    await a.sb.from('profiles').update({ all_missions: true }).eq('id', a.id);
    const p = await a.sb.from('profiles').select('all_missions').eq('id', a.id).single();
    expect(p.data).toEqual({ all_missions: false });
  });
});
