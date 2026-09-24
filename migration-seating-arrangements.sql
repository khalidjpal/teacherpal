-- ============================================================================
-- Migration: saved seating arrangements — several named charts per period.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- New table:
--   seating_arrangements
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     name        text        "Q1", "Q2 draft", …; UNIQUE (period_id, lower(name))
--     assignments jsonb       { "<pieceId>:<seatIndex>": "<student uuid>", ... }
--     layout      jsonb       the desk layout this arrangement was saved on
--                             (same shape as room_layouts.layout) — used to warn
--                             when the room has changed since; null = unknown
--     is_active   boolean     at most ONE active per period (partial unique index).
--                             The active one is what Attendance shows.
--     created_at  timestamptz
--     updated_at  timestamptz
--
-- New RPC:
--   set_active_seating_arrangement(p_id uuid) — flips is_active to p_id and
--   off for the rest of that period in one transaction (SECURITY INVOKER, so
--   RLS still limits it to the caller's own rows).
--
-- Backfill: every existing seat_assignments row becomes an ACTIVE arrangement
-- called "Current seating" for its period, stamped with the owner's current
-- room layout. seat_assignments is left in place (no longer written by the
-- app) — see the optional drop at the bottom.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.seating_arrangements (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id    uuid not null references public.periods(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  assignments  jsonb not null default '{}'::jsonb,
  layout       jsonb,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists seating_arrangements_owner_idx
  on public.seating_arrangements (owner_id);
create index if not exists seating_arrangements_period_idx
  on public.seating_arrangements (period_id);
-- names are unique within a period, ignoring case
create unique index if not exists seating_arrangements_period_name_uidx
  on public.seating_arrangements (period_id, lower(name));
-- exactly zero or one active arrangement per period
create unique index if not exists seating_arrangements_one_active_uidx
  on public.seating_arrangements (period_id) where is_active;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies
-- ---------------------------------------------------------------------------
alter table public.seating_arrangements enable row level security;

do $$
declare
  t text := 'seating_arrangements';
  policy_name text;
begin
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
end $$;

-- ---------------------------------------------------------------------------
-- 3. Make-active RPC. Two statements in one function = one transaction, so
--    the one-active index never sees two actives. SECURITY INVOKER: RLS
--    applies, a caller can only ever touch their own rows.
-- ---------------------------------------------------------------------------
create or replace function public.set_active_seating_arrangement(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period uuid;
begin
  select period_id into v_period from public.seating_arrangements where id = p_id;
  if v_period is null then
    raise exception 'arrangement not found' using errcode = 'P0002';
  end if;
  update public.seating_arrangements
     set is_active = false
   where period_id = v_period and is_active and id <> p_id;
  update public.seating_arrangements
     set is_active = true
   where id = p_id;
end;
$$;

revoke all on function public.set_active_seating_arrangement(uuid) from public;
grant execute on function public.set_active_seating_arrangement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: today's chart for each period becomes its active arrangement.
--    Skips any period that already has arrangements, so re-running is a no-op.
--    owner_id is set explicitly (auth.uid() is null in the SQL editor).
-- ---------------------------------------------------------------------------
insert into public.seating_arrangements
  (owner_id, period_id, name, assignments, layout, is_active, created_at, updated_at)
select
  sa.owner_id,
  sa.period_id,
  'Current seating',
  sa.assignments,
  (select rl.layout from public.room_layouts rl
    where rl.owner_id = sa.owner_id and rl.key = 'default' limit 1),
  true,
  sa.updated_at,
  sa.updated_at
from public.seat_assignments sa
where not exists (
  select 1 from public.seating_arrangements x where x.period_id = sa.period_id
);

-- Tell PostgREST about the new table + function right away.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- OPTIONAL, later: once you're happy everything moved over, the old table
-- can go. The app only falls back to it if seating_arrangements is missing.
-- ---------------------------------------------------------------------------
-- drop table if exists public.seat_assignments;
