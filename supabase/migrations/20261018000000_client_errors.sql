-- Anonymous crash reports from the game client: what broke and where, nothing about the player.
create table public.client_errors (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null check (char_length(message) <= 2000),
  stack text check (char_length(stack) <= 8000),
  -- Page path and game state at the time ("skirmish", "replay", "multiplayer", "menu").
  path text check (char_length(path) <= 200),
  context text check (char_length(context) <= 200),
  client_version text check (char_length(client_version) <= 64),
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

-- Write-only for players: they file reports, only the project owner (service role) reads them.
create policy "players file crash reports" on public.client_errors
  for insert to authenticated with check (reporter = auth.uid());

-- Keep a month of reports.
select cron.schedule('cleanup-client-errors', '43 3 * * *', $$delete from public.client_errors where created_at < now() - interval '30 days'$$);
