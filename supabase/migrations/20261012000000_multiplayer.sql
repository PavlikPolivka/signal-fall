-- Multiplayer: lobby rooms, match results and desync reports.
-- Every client signs in anonymously; row level security keeps each player to their own rows.

create table public.rooms (
  code text primary key check (code ~ '^[A-Z]{4}$'),
  host uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'playing', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Anyone signed in may look a room up by its code (to join it).
create policy "rooms are readable by signed-in players" on public.rooms
  for select to authenticated using (true);

-- Only the host creates, updates or deletes their room.
create policy "hosts create their rooms" on public.rooms
  for insert to authenticated with check (host = auth.uid());
create policy "hosts update their rooms" on public.rooms
  for update to authenticated using (host = auth.uid()) with check (host = auth.uid());
create policy "hosts delete their rooms" on public.rooms
  for delete to authenticated using (host = auth.uid());

create table public.match_results (
  id bigint generated always as identity primary key,
  room_code text not null,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  players uuid[] not null check (cardinality(players) between 2 and 8),
  factions smallint[] not null,
  winner_slot smallint check (winner_slot >= 0),
  seed integer not null,
  map jsonb not null,
  ticks integer not null check (ticks >= 0),
  final_hash bigint,
  created_at timestamptz not null default now(),
  check (reporter = any (players))
);

alter table public.match_results enable row level security;

create policy "players record results of their own matches" on public.match_results
  for insert to authenticated with check (reporter = auth.uid() and auth.uid() = any (players));
create policy "players read their own results" on public.match_results
  for select to authenticated using (auth.uid() = any (players));

create table public.desync_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  room_code text,
  tick integer not null,
  local_hash bigint not null,
  remote_hash bigint not null,
  -- Replay (scenario + command log) as produced by the client; capped at 1 MB.
  report jsonb not null check (octet_length(report::text) < 1048576),
  client_version text,
  created_at timestamptz not null default now()
);

alter table public.desync_reports enable row level security;

-- Write-only for players: they file reports, only the project owner (service role) reads them.
create policy "players file desync reports" on public.desync_reports
  for insert to authenticated with check (reporter = auth.uid());

-- Housekeeping: rooms older than a day are gone.
create extension if not exists pg_cron with schema extensions;
select cron.schedule('cleanup-rooms', '17 * * * *', $$delete from public.rooms where created_at < now() - interval '1 day'$$);
