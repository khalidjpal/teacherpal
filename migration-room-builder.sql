-- ============================================================================
-- Migration: freeform room builder (replaces the rows × cols seating grid)
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- New tables:
--   room_layouts       key, layout, updated_at        (one shared room)
--   seat_assignments   period_id, assignments, updated_at   (one row per period)
--
-- The old seating_charts table is no longer used. Its grid data cannot be
-- mapped onto freeform desks, so it is NOT dropped automatically — see the
-- optional block at the bottom.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.room_layouts (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique default 'default',
  layout      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists public.seat_assignments (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null unique references public.periods(id) on delete cascade,
  assignments  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.room_layouts     enable row level security;
alter table public.seat_assignments enable row level security;

-- ===========================================================================
-- TEMPORARY POLICIES — no login yet. Same as the other tables: the anon role
-- gets full select/insert/update/delete. REPLACE when authentication is added.
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'room_layouts'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.room_layouts
      for all to anon using (true) with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seat_assignments'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.seat_assignments
      for all to anon using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- OPTIONAL: remove the old grid-based seating charts. This deletes that data.
-- Uncomment and run only when you no longer need the old charts.
-- ---------------------------------------------------------------------------
-- drop table if exists public.seating_charts;
