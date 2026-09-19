-- ============================================================================
-- Migration: seating "formula" rules for the room builder
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- New table:
--   seating_rules   period_id, rules, use_formula, updated_at   (one row per period)
--     rules: [{ "id", "type": "apart"|"close"|"together"|"front"|"back",
--               "a": "<student uuid>", "b": "<student uuid>" (pair types only) }]
--     use_formula: whether Randomize follows the rules for this period
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.seating_rules (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null unique references public.periods(id) on delete cascade,
  rules        jsonb not null default '[]'::jsonb,
  use_formula  boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.seating_rules enable row level security;

-- ===========================================================================
-- TEMPORARY POLICY — no login yet. Same as the other tables: the anon role
-- gets full select/insert/update/delete. REPLACE when authentication is added.
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seating_rules'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.seating_rules
      for all to anon using (true) with check (true);
  end if;
end $$;
