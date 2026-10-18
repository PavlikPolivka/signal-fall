-- Co-op survival rooms can be listed too.
alter table public.rooms drop constraint if exists rooms_mode_check;
alter table public.rooms add constraint rooms_mode_check check (mode in ('1v1', '2v2', 'ffa3', 'ffa4', 'coop'));
