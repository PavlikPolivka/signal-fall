-- Public rooms: a host can list their room so anyone can find and join it.
alter table public.rooms
  add column public boolean not null default false,
  add column title text check (char_length(title) <= 40),
  add column mode text not null default '1v1' check (mode in ('1v1', '2v2')),
  add column open_seats smallint not null default 1 check (open_seats between 0 and 3);

-- The browser lists open public rooms the host has touched in the last minute (it heartbeats).
create index rooms_public_open on public.rooms (updated_at desc) where public and status = 'open';
