-- ============================================================================
-- Migration: the Leaderboard as a standalone scorekeeper — each teacher's
-- saved scoreboards (a game, a competition, anything in the room).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- New table:
--   scoreboards
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     name        text        1–80 chars ("Spelling bee", "Unit 4 review week")
--     kind        text        'teams' | 'students'
--     entries     jsonb       up to 200, in entry order:
--                             [{ "id": "k3f9a", "name": "Owls", "score": 12,
--                                "members": [{ "id": "<student uuid>", "name": "Ava Brown" }] }]
--                             (members: the students on a team, or [] ; a student
--                              entry pulled from a roster carries "sid": "<student uuid>")
--                             score: any integer, negative allowed
--     sort_mode   text        'score' (highest first) | 'order' (entry order)
--     buttons     jsonb       the quick-add buttons on each row, e.g. [1, 5, 10, -1]
--                             (1–6 non-zero whole numbers)
--     start_score integer     every entry's score at the start, and after Reset
--     period_id   uuid        -> periods.id (set null): the class it was set up
--                             from, if any
--     created_at  timestamptz
--     updated_at  timestamptz set on every save; the list is newest first
--
-- Nothing here reads Family Feud or Jeopardy: the scores are typed in.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.scoreboards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  kind        text not null default 'teams' check (kind in ('teams', 'students')),
  entries     jsonb not null default '[]'::jsonb,
  sort_mode   text not null default 'score' check (sort_mode in ('score', 'order')),
  period_id   uuid references public.periods(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scoreboards_owner_idx on public.scoreboards (owner_id, updated_at desc);

-- added after the first version: run the whole file again to get them
alter table public.scoreboards add column if not exists buttons jsonb not null default '[1, 5, 10, -1]'::jsonb;
alter table public.scoreboards add column if not exists start_score integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scoreboards_entries_shape') then
    alter table public.scoreboards
      add constraint scoreboards_entries_shape
      check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) <= 200);
  end if;
  -- a generous cap so one row can't grow without limit
  if not exists (select 1 from pg_constraint where conname = 'scoreboards_entries_size') then
    alter table public.scoreboards
      add constraint scoreboards_entries_size
      check (pg_column_size(entries) <= 200000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scoreboards_buttons_shape') then
    alter table public.scoreboards
      add constraint scoreboards_buttons_shape
      check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) between 1 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scoreboards_start_score_range') then
    alter table public.scoreboards
      add constraint scoreboards_start_score_range
      check (start_score between -1000000 and 1000000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies
-- ---------------------------------------------------------------------------
alter table public.scoreboards enable row level security;

do $$
declare
  t text := 'scoreboards';
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

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. The previous Leaderboard's tables are no longer used.
--    If you ran migration-leaderboard.sql, drop them once you're sure you
--    don't want what's in them (uncomment the three lines and run them):
-- ---------------------------------------------------------------------------
-- drop table if exists public.game_results;
-- drop table if exists public.leaderboard_adjustments;
-- drop table if exists public.leaderboard_settings;

-- ---------------------------------------------------------------------------
-- 4. Check: RLS on and four policies
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from information_schema.columns k
         where k.table_schema = 'public' and k.table_name = c.relname
           and k.column_name in ('buttons', 'start_score')) as new_columns,  -- 2
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'scoreboards';
