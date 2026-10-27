import type { SupabaseClient } from '@supabase/supabase-js';

/** The signed-in account's id; null for guests and without a session (their progress stays in the browser). */
async function session(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user.id : null;
}

/** Missions the account has won, and whether every mission is open to it. Null for guests. */
export async function accountProgress(sb: SupabaseClient): Promise<{ won: string[]; allMissions: boolean } | null> {
  const me = await session(sb);
  if (!me) return null;
  const [progress, profile] = await Promise.all([
    sb.from('campaign_progress').select('mission').eq('player', me),
    sb.from('profiles').select('all_missions').eq('id', me).maybeSingle(),
  ]);
  if (progress.error) throw new Error(progress.error.message);
  return { won: progress.data.map((r) => r.mission as string), allMissions: (profile.data?.all_missions as boolean | undefined) ?? false };
}

/** Add won missions to the account (already recorded ones are left as they are). */
export async function recordWins(sb: SupabaseClient, missions: string[], difficulty: string): Promise<void> {
  const me = await session(sb);
  if (!me || !missions.length) return;
  const { error } = await sb
    .from('campaign_progress')
    .upsert(missions.map((mission) => ({ player: me, mission, difficulty })), { onConflict: 'player,mission', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
