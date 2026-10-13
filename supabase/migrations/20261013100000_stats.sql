-- Match history, ratings and the leaderboard.
--
-- Every player records their own row when a match ends. A multiplayer match is
-- confirmed when both players' rows agree (same room, same final state hash,
-- opposite results); the first confirmation updates both Elo ratings. Results
-- against the AI are personal history and records only, never rated.

drop table if exists public.match_results;

create table public.matches (
  id bigint generated always as identity primary key,
  player uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('skirmish', 'multiplayer')),
  room_code text check (room_code is null or room_code ~ '^[A-Z]{4}$'),
  faction smallint not null check (faction between 0 and 7),
  opponent uuid references auth.users (id) on delete set null,
  opponent_faction smallint not null check (opponent_faction between 0 and 7),
  ai_difficulty text check (ai_difficulty in ('easy', 'normal', 'hard', 'brutal')),
  result text not null check (result in ('win', 'loss', 'draw')),
  ticks integer not null check (ticks >= 0),
  seed integer not null,
  map jsonb not null check (octet_length(map::text) < 2048),
  final_hash bigint not null,
  -- End-of-match summary for this player (the post-game report's last sample).
  summary jsonb check (summary is null or octet_length(summary::text) < 4096),
  rated boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'skirmish') = (ai_difficulty is not null)),
  check (kind = 'skirmish' or (room_code is not null and opponent is not null))
);

-- One row per player per multiplayer match.
create unique index matches_one_per_room on public.matches (player, room_code, final_hash) where kind = 'multiplayer';
create index matches_player_created on public.matches (player, created_at desc);

alter table public.matches enable row level security;

create policy "players record their own matches" on public.matches
  for insert to authenticated with check (player = auth.uid() and opponent is distinct from auth.uid());
create policy "players read their own matches" on public.matches
  for select to authenticated using (player = auth.uid());

-- `rated` is set by the server only.
revoke update, delete on public.matches from authenticated, anon;

create table public.ratings (
  id uuid primary key references auth.users (id) on delete cascade,
  rating integer not null default 1200,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ratings enable row level security;

create policy "ratings are readable by signed-in players" on public.ratings
  for select to authenticated using (true);
revoke insert, update, delete on public.ratings from authenticated, anon;

-- Elo with K = 32. Score is 1 for a win, 0.5 for a draw.
create function public.elo_delta(own integer, other integer, score numeric) returns integer
  language sql immutable as $$
  select round(32 * (score - 1 / (1 + power(10, (other - own) / 400.0))))::integer
$$;

create function public.confirm_match() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  other public.matches%rowtype;
  ra integer;
  rb integer;
  sa numeric;
begin
  if new.kind <> 'multiplayer' then
    return new;
  end if;
  select * into other from public.matches m
  where m.kind = 'multiplayer'
    and m.room_code = new.room_code
    and m.final_hash = new.final_hash
    and m.player = new.opponent
    and m.opponent = new.player
    and not m.rated
    and (m.result, new.result) in (('win', 'loss'), ('loss', 'win'), ('draw', 'draw'))
  for update;
  if not found then
    return new;
  end if;

  insert into public.ratings (id) values (new.player), (new.opponent) on conflict do nothing;
  select rating into ra from public.ratings where id = new.player for update;
  select rating into rb from public.ratings where id = new.opponent for update;
  sa := case new.result when 'win' then 1 when 'loss' then 0 else 0.5 end;

  update public.ratings set
    rating = rating + public.elo_delta(ra, rb, sa),
    wins = wins + (new.result = 'win')::int,
    losses = losses + (new.result = 'loss')::int,
    draws = draws + (new.result = 'draw')::int,
    updated_at = now()
  where id = new.player;
  update public.ratings set
    rating = rating + public.elo_delta(rb, ra, 1 - sa),
    wins = wins + (other.result = 'win')::int,
    losses = losses + (other.result = 'loss')::int,
    draws = draws + (other.result = 'draw')::int,
    updated_at = now()
  where id = new.opponent;

  update public.matches set rated = true where id = other.id;
  new.rated := true;
  return new;
end $$;

-- BEFORE insert so the new row is stored already marked as rated.
create trigger matches_confirm before insert on public.matches
  for each row execute function public.confirm_match();

-- Leaderboard: permanent accounts with at least one rated match.
create view public.leaderboard with (security_invoker = true) as
  select p.display_name as name, r.rating, r.wins, r.losses, r.draws, r.id
  from public.ratings r
  join public.profiles p on p.id = r.id
  where not p.guest and r.wins + r.losses + r.draws > 0
  order by r.rating desc, r.wins desc;

grant select on public.leaderboard to authenticated;

-- Personal records: wins and losses per mode, own faction, opponent faction and difficulty.
create view public.my_records with (security_invoker = true) as
  select kind, faction, opponent_faction, ai_difficulty,
    count(*) filter (where result = 'win') as wins,
    count(*) filter (where result = 'loss') as losses,
    count(*) filter (where result = 'draw') as draws,
    sum(ticks) as ticks
  from public.matches
  where player = auth.uid()
  group by kind, faction, opponent_faction, ai_difficulty;

grant select on public.my_records to authenticated;
