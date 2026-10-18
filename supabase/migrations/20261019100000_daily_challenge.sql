-- Daily challenge: everyone plays the same skirmish each day; the fastest wins make the board.
create table public.daily_scores (
  day date not null,
  player uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Match length of the win, in sim ticks (20 a second).
  ticks integer not null check (ticks > 0 and ticks < 20 * 60 * 120),
  -- Final state hash of the match (a replay of it must reach this).
  final_hash bigint,
  created_at timestamptz not null default now(),
  primary key (day, player)
);

alter table public.daily_scores enable row level security;

create policy "daily scores are readable by signed-in players" on public.daily_scores
  for select to authenticated using (true);

/** Record a win in today's (UTC) challenge, keeping the player's fastest. */
create or replace function public.submit_daily(win_ticks integer, hash bigint) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  best integer;
begin
  if me is null then return null; end if;
  insert into public.daily_scores (day, player, ticks, final_hash) values (today, me, win_ticks, hash)
    on conflict (day, player) do update set ticks = least(public.daily_scores.ticks, excluded.ticks),
      final_hash = case when excluded.ticks < public.daily_scores.ticks then excluded.final_hash else public.daily_scores.final_hash end,
      created_at = case when excluded.ticks < public.daily_scores.ticks then now() else public.daily_scores.created_at end;
  select d.ticks into best from public.daily_scores d where d.day = today and d.player = me;
  return best;
end;
$$;

revoke all on function public.submit_daily(integer, bigint) from public, anon;
grant execute on function public.submit_daily(integer, bigint) to authenticated;

/** Today's board: the fastest wins with display names. */
create or replace view public.daily_board with (security_invoker = true) as
  select d.day, d.player, d.ticks, coalesce(p.display_name, 'Guest') as name,
         rank() over (partition by d.day order by d.ticks) as rank
  from public.daily_scores d left join public.profiles p on p.id = d.player;

grant select on public.daily_board to authenticated;
