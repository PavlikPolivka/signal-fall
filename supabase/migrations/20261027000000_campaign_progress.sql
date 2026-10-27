-- Campaign progress follows the account: every mission a player has won, so a new browser or
-- device picks up where they left off. The browser keeps its own copy and merges both ways.
-- Saved accounts only: a guest's progress stays in their browser until they confirm an email.

create table public.campaign_progress (
  player uuid not null references auth.users (id) on delete cascade,
  mission text not null check (length(mission) between 1 and 64),
  difficulty text check (difficulty in ('story', 'normal', 'hard')),
  won_at timestamptz not null default now(),
  primary key (player, mission)
);

alter table public.campaign_progress enable row level security;

create policy "players read their own progress" on public.campaign_progress
  for select to authenticated using (player = auth.uid());
create policy "players record their own wins" on public.campaign_progress
  for insert to authenticated
  with check (player = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

-- Wins are only ever added.
revoke update, delete on public.campaign_progress from authenticated, anon;

-- Every mission open regardless of progress (for testing missions); set by hand, never by players
-- (they may update only display_name).
alter table public.profiles add column all_missions boolean not null default false;
