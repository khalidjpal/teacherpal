-- ============================================================================
-- Migration: Jeopardy — each teacher's saved boards (one per unit, say).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- New table:
--   quiz_boards
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     name        text        1–80 chars ("Macbeth", "Grammar review")
--     categories  jsonb       up to 6 categories, each with 5 clues in value order:
--                             [{ "name": "Characters",
--                                "clues": [{ "q": "He kills Duncan.", "a": "Who is Macbeth?",
--                                            "double": false }, ... x5] }, ...]
--                             (the values come from the position: 100–500, x2 in round 2)
--     sort_order  integer     order in the board list
--     created_at  timestamptz
--     updated_at  timestamptz
--
-- The game itself (scores, teams, which clues are used) is not stored here:
-- it lives in the teacher's browser.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.quiz_boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  categories  jsonb not null default '[]'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists quiz_boards_owner_idx on public.quiz_boards (owner_id, sort_order);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_boards_categories_shape') then
    alter table public.quiz_boards
      add constraint quiz_boards_categories_shape
      check (jsonb_typeof(categories) = 'array' and jsonb_array_length(categories) <= 6);
  end if;
  -- a generous cap so one row can't grow without limit (30 clues of text)
  if not exists (select 1 from pg_constraint where conname = 'quiz_boards_categories_size') then
    alter table public.quiz_boards
      add constraint quiz_boards_categories_size
      check (pg_column_size(categories) <= 200000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies
-- ---------------------------------------------------------------------------
alter table public.quiz_boards enable row level security;

do $$
declare
  t text := 'quiz_boards';
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
-- 3. Check: RLS on and four policies
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'quiz_boards';
