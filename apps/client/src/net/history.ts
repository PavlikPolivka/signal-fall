import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScenarioSpec } from '../protocol';
import type { MatchStats } from '../game/scenario';
import { signIn } from './backend';

export interface MatchEnd {
  tick: number;
  hash: number;
  winnerTeam: number;
}

/** Multiplayer context: the room and each slot's account id. */
export interface NetMatch {
  room: string;
  uids: (string | null)[];
}

/**
 * Record a finished 1v1 for the local player: personal history and records, and,
 * for multiplayer, the report that rates the match once the opponent's agrees.
 * Returns the error message if the row was refused, null when recorded.
 */
export async function recordMatch(
  sb: SupabaseClient,
  scenario: Extract<ScenarioSpec, { kind: 'skirmish' }>,
  slot: number,
  end: MatchEnd,
  stats: MatchStats | null,
  net: NetMatch | null,
): Promise<string | null> {
  if (scenario.factions.length !== 2) return null; // Only 1v1 is recorded for now.
  const other = 1 - slot;
  const me = await signIn(sb);
  const opponent = net ? (net.uids[other] ?? null) : null;
  if (net && !opponent) return 'opponent has no account id';
  const last = stats?.samples[stats.samples.length - 1];
  const { error } = await sb.from('matches').insert({
    player: me,
    kind: net ? 'multiplayer' : 'skirmish',
    room_code: net?.room ?? null,
    faction: scenario.factions[slot],
    opponent,
    opponent_faction: scenario.factions[other],
    ai_difficulty: net ? null : scenario.ai[other],
    result: end.winnerTeam < 0 ? 'draw' : end.winnerTeam === slot ? 'win' : 'loss',
    ticks: end.tick,
    seed: scenario.seed,
    map: scenario.map,
    final_hash: end.hash >>> 0,
    summary: last ? { me: last.players[slot], opponent: last.players[other] } : null,
  });
  return error ? error.message : null;
}

export interface MatchRow {
  id: number;
  kind: 'skirmish' | 'multiplayer';
  faction: number;
  opponentFaction: number;
  opponentName: string | null;
  aiDifficulty: string | null;
  result: 'win' | 'loss' | 'draw';
  ticks: number;
  rated: boolean;
  createdAt: string;
}

/** The player's latest matches, newest first, with opponents' names. */
export async function myMatches(sb: SupabaseClient, limit = 50): Promise<MatchRow[]> {
  const me = await signIn(sb);
  const { data, error } = await sb
    .from('matches')
    .select('id, kind, faction, opponent, opponent_faction, ai_difficulty, result, ticks, rated, created_at')
    .eq('player', me)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const ids = [...new Set(data.map((r) => r.opponent as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await sb.from('profiles').select('id, display_name').in('id', ids);
    for (const p of profiles ?? []) names.set(p.id as string, p.display_name as string);
  }
  return data.map((r) => ({
    id: r.id as number,
    kind: r.kind as MatchRow['kind'],
    faction: r.faction as number,
    opponentFaction: r.opponent_faction as number,
    opponentName: r.opponent ? (names.get(r.opponent as string) ?? 'a former player') : null,
    aiDifficulty: r.ai_difficulty as string | null,
    result: r.result as MatchRow['result'],
    ticks: r.ticks as number,
    rated: r.rated as boolean,
    createdAt: r.created_at as string,
  }));
}

export interface RecordRow {
  kind: 'skirmish' | 'multiplayer';
  faction: number;
  opponentFaction: number;
  aiDifficulty: string | null;
  wins: number;
  losses: number;
  draws: number;
  ticks: number;
}

export async function myRecords(sb: SupabaseClient): Promise<RecordRow[]> {
  await signIn(sb);
  const { data, error } = await sb.from('my_records').select('*');
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    kind: r.kind as RecordRow['kind'],
    faction: r.faction as number,
    opponentFaction: r.opponent_faction as number,
    aiDifficulty: r.ai_difficulty as string | null,
    wins: Number(r.wins),
    losses: Number(r.losses),
    draws: Number(r.draws),
    ticks: Number(r.ticks),
  }));
}

export interface Standing {
  id: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

export async function leaderboard(sb: SupabaseClient, limit = 100): Promise<Standing[]> {
  await signIn(sb);
  const { data, error } = await sb.from('leaderboard').select('id, name, rating, wins, losses, draws').limit(limit);
  if (error) throw new Error(error.message);
  return data as Standing[];
}

/** The player's own rating, if they have played a rated match. */
export async function myRating(sb: SupabaseClient): Promise<Omit<Standing, 'name'> | null> {
  const me = await signIn(sb);
  const { data } = await sb.from('ratings').select('id, rating, wins, losses, draws').eq('id', me).maybeSingle();
  return (data as Omit<Standing, 'name'> | null) ?? null;
}
