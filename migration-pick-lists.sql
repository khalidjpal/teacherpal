-- ============================================================================
-- Migration: saved pick lists for the Name Wheel — named rotations per period
-- ("Board work", "Cold call", "Read aloud"), each with its own picked /
-- remaining state that lasts until the list is reset (across days, sessions
-- and devices).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- New tables:
--   pick_lists
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     name        text        1–40 chars; UNIQUE (period_id, lower(name))
--     sort_order  integer
--     created_at  timestamptz
--
--   pick_list_picks             (one row per student picked on a list;
--                                no row = still to go. Reset = delete the rows)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     list_id     uuid        -> pick_lists.id (cascade delete)
--     student_id  uuid        -> students.id (cascade delete)
--     picked_at   timestamptz when they were called (or marked by hand)
--     manual      boolean     true = marked picked by hand, not by the wheel
--     UNIQUE (list_id, student_id)
--
-- One row per pick (rather than a jsonb map on the list) so two devices
-- marking different students at once can never overwrite each other.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.pick_lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists pick_lists_owner_idx  on public.pick_lists (owner_id);
create index if not exists pick_lists_period_idx on public.pick_lists (period_id);
-- names are unique within a period, ignoring case
create unique index if not exists pick_lists_period_name_uidx
  on public.pick_lists (period_id, lower(name));

create table if not exists public.pick_list_picks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id     uuid not null references public.pick_lists(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  picked_at   timestamptz not null default now(),
  manual      boolean not null default false
);
create index if not exists pick_list_picks_owner_idx on public.pick_list_picks (owner_id);
-- a student is picked at most once per list; also the upsert target
create unique index if not exists pick_list_picks_list_student_uidx
  on public.pick_list_picks (list_id, student_id);
create index if not exists pick_list_picks_student_idx on public.pick_list_picks (student_id);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies on each
-- ---------------------------------------------------------------------------
alter table public.pick_lists      enable row level security;
alter table public.pick_list_picks enable row level security;

do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array['pick_lists', 'pick_list_picks'] loop
    policy_name := format('%s owner select', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', policy_name, t);
    end if;
    policy_name := format('%s owner insert', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', policy_name, t);
    end if;
    policy_name := format('%s owner update', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', policy_name, t);
    end if;
    policy_name := format('%s owner delete', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', policy_name, t);
    end if;
  end loop;
end $$;

-- let PostgREST see the new tables straight away
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. Check: both tables with RLS on and four policies each
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('pick_lists', 'pick_list_picks')
order by c.relname;
