-- Ranked queue: players wait here and are paired with the closest rating; the pair gets a fresh room.
create table public.queue (
  player uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rating integer not null default 1200,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  -- Set when paired: the room to meet in, and whether this player hosts it.
  matched_code text,
  host boolean
);

alter table public.queue enable row level security;

-- Players see, join and leave only their own place in the queue; pairing happens in find_match().
create policy "players see their queue entry" on public.queue
  for select to authenticated using (player = auth.uid());
create policy "players join the queue" on public.queue
  for insert to authenticated with check (player = auth.uid() and matched_code is null and host is null);
create policy "players leave the queue" on public.queue
  for delete to authenticated using (player = auth.uid());

/**
 * Called by a waiting player every couple of seconds: if already paired, returns the room; otherwise
 * pairs them with the waiting player of the closest rating (rating from the ladder, not the client),
 * makes a room for the two and returns it. Null while nobody suitable is waiting.
 */
create or replace function public.find_match() returns table (code text, host boolean)
  language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mine public.queue;
  other public.queue;
  new_code text;
  letters text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
begin
  if me is null then return; end if;
  update public.queue q set seen_at = now(), rating = coalesce((select r.rating from public.ratings r where r.id = me), 1200)
    where q.player = me returning * into mine;
  if mine.player is null then return; end if;
  if mine.matched_code is not null then
    return query select mine.matched_code, mine.host;
    return;
  end if;
  -- Someone still waiting (seen in the last 15 s), closest rating first, then longest waiting.
  select * into other from public.queue q
    where q.player <> me and q.matched_code is null and q.seen_at > now() - interval '15 seconds'
    order by abs(q.rating - mine.rating), q.joined_at
    limit 1 for update skip locked;
  if other.player is null then return; end if;
  loop
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.code = new_code);
  end loop;
  insert into public.rooms (code, host, status) values (new_code, me, 'open');
  update public.queue q set matched_code = new_code, host = true where q.player = me;
  update public.queue q set matched_code = new_code, host = false where q.player = other.player;
  return query select new_code, true;
end;
$$;

revoke all on function public.find_match() from public, anon;
grant execute on function public.find_match() to authenticated;

-- Nobody waits forever: stale entries go.
select cron.schedule('cleanup-queue', '*/5 * * * *', $$delete from public.queue where seen_at < now() - interval '10 minutes'$$);
