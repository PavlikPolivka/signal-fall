-- Accounts: every user (anonymous guests included) has a profile with a display name.
-- A guest becomes a permanent account by confirming an email address (same user id,
-- so name and history carry over); `guest` mirrors auth.users.is_anonymous.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,18}[A-Za-z0-9._-]$'),
  guest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Names are unique regardless of case, so the leaderboard is unambiguous.
create unique index profiles_display_name_key on public.profiles (lower(display_name));

alter table public.profiles enable row level security;

create policy "profiles are readable by signed-in players" on public.profiles
  for select to authenticated using (true);
create policy "players rename themselves" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Players may change their name and nothing else; rows are created by the trigger below.
revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

create function public.touch_profile() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_profile();

-- New user: a profile named "Commander" plus the start of the user id (unique enough; renamable).
create function public.create_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, guest)
  values (new.id, 'Commander ' || substr(replace(new.id::text, '-', ''), 1, 6), coalesce(new.is_anonymous, false));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile();

-- A guest who confirms an email is no longer a guest.
create function public.sync_profile_guest() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set guest = coalesce(new.is_anonymous, false) where id = new.id;
  return new;
end $$;

create trigger on_auth_user_updated after update of is_anonymous on auth.users
  for each row when (old.is_anonymous is distinct from new.is_anonymous)
  execute function public.sync_profile_guest();

-- Users who signed up before this migration.
insert into public.profiles (id, display_name, guest)
select id, 'Commander ' || substr(replace(id::text, '-', ''), 1, 6), coalesce(is_anonymous, false) from auth.users
on conflict do nothing;
