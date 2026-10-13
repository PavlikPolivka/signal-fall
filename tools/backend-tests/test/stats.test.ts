// Match history, rating confirmation and the leaderboard against a running Supabase stack.
// Skipped unless SUPABASE_URL and SUPABASE_ANON_KEY are set.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function player(): Promise<{ sb: SupabaseClient; id: string }> {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('no user');
  return { sb, id: data.user.id };
}

const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');
const base = { ticks: 6000, seed: 7, map: { size: 'M', biome: 'wasteland' } };

function mp(me: string, them: string, room: string, result: 'win' | 'loss' | 'draw', hash = 1234) {
  return { ...base, kind: 'multiplayer', player: me, opponent: them, room_code: room, faction: 0, opponent_faction: 1, result, final_hash: hash };
}

const rating = async (sb: SupabaseClient, id: string) => (await sb.from('ratings').select('rating, wins, losses').eq('id', id).maybeSingle()).data;

describe.skipIf(!URL || !ANON)('match history and ratings', () => {
  it('a skirmish result is personal history, never rated', async () => {
    const a = await player();
    const row = { ...base, kind: 'skirmish', faction: 2, opponent_faction: 0, ai_difficulty: 'hard', result: 'win', final_hash: 99 };
    const ins = await a.sb.from('matches').insert(row).select('rated').single();
    expect(ins.error).toBeNull();
    expect(ins.data?.rated).toBe(false);
    const rec = await a.sb.from('my_records').select('*').eq('kind', 'skirmish');
    expect(rec.data).toEqual([expect.objectContaining({ faction: 2, opponent_faction: 0, ai_difficulty: 'hard', wins: 1, losses: 0 })]);
    // Someone else sees none of it.
    const b = await player();
    expect((await b.sb.from('matches').select('id')).data).toHaveLength(0);
    expect((await b.sb.from('my_records').select('*')).data).toHaveLength(0);
  });

  it('bad rows are refused: someone else as player, skirmish without difficulty, changing rows', async () => {
    const a = await player();
    const b = await player();
    expect((await a.sb.from('matches').insert(mp(b.id, a.id, code(), 'win'))).error).not.toBeNull();
    expect((await a.sb.from('matches').insert({ ...base, kind: 'skirmish', faction: 0, opponent_faction: 1, result: 'win', final_hash: 1 })).error).not.toBeNull();
    const ok = await a.sb.from('matches').insert({ ...base, kind: 'skirmish', faction: 0, opponent_faction: 1, ai_difficulty: 'easy', result: 'loss', final_hash: 1 }).select('id').single();
    await a.sb.from('matches').update({ result: 'win' }).eq('id', ok.data!.id);
    expect((await a.sb.from('matches').select('result').eq('id', ok.data!.id).single()).data?.result).toBe('loss');
  });

  it('a multiplayer match is rated once both players report the same outcome', async () => {
    const a = await player();
    const b = await player();
    const room = code();
    const first = await a.sb.from('matches').insert(mp(a.id, b.id, room, 'win')).select('rated').single();
    expect(first.data?.rated).toBe(false);
    expect(await rating(a.sb, a.id)).toBeNull();
    const second = await b.sb.from('matches').insert(mp(b.id, a.id, room, 'loss')).select('rated').single();
    expect(second.error).toBeNull();
    expect(second.data?.rated).toBe(true);
    expect(await rating(a.sb, a.id)).toEqual({ rating: 1216, wins: 1, losses: 0 });
    expect(await rating(a.sb, b.id)).toEqual({ rating: 1184, wins: 0, losses: 1 });
    // Reporting the same match again is refused, so it cannot be counted twice.
    expect((await b.sb.from('matches').insert(mp(b.id, a.id, room, 'loss'))).error).not.toBeNull();
  });

  it('disagreeing reports are never rated (both claim the win, or different final states)', async () => {
    const a = await player();
    const b = await player();
    const room = code();
    await a.sb.from('matches').insert(mp(a.id, b.id, room, 'win'));
    expect((await b.sb.from('matches').insert(mp(b.id, a.id, room, 'win')).select('rated').single()).data?.rated).toBe(false);
    const room2 = code();
    await a.sb.from('matches').insert(mp(a.id, b.id, room2, 'win', 1));
    expect((await b.sb.from('matches').insert(mp(b.id, a.id, room2, 'loss', 2)).select('rated').single()).data?.rated).toBe(false);
    expect(await rating(a.sb, a.id)).toBeNull();
  });

  it.skipIf(!SERVICE)('the leaderboard lists permanent accounts only', async () => {
    const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
    const a = await player();
    const b = await player();
    const room = code();
    await a.sb.from('matches').insert(mp(a.id, b.id, room, 'win'));
    await b.sb.from('matches').insert(mp(b.id, a.id, room, 'loss'));
    const board = async () => (await a.sb.from('leaderboard').select('id, rating')).data!.map((r) => r.id as string);
    expect(await board()).not.toContain(a.id);
    await admin.auth.admin.updateUserById(a.id, { email: `lb${Math.floor(Math.random() * 1e9)}@example.com`, email_confirm: true });
    const ids = await board();
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });
});
