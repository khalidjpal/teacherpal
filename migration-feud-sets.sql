-- ============================================================================
-- Migration: Family Feud — named question sets (one per unit, say).
-- Run once in the Supabase SQL editor, after migration-survey-showdown.sql.
-- Safe to re-run.
--
-- New table:
--   survey_sets
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     name        text        1–60 chars ("Unit 3: Macbeth", "Warm-ups")
--     questions   jsonb       up to 100, in game order:
--                             [{ "id": "a1b2c3d4", "question": "Name something…",
--                                "answers": [{ "text": "Pencil", "points": 30 }, … 1–8],
--                                "auto": true }]   (auto = points filled in by the app)
--     sort_order  integer     order in the set lists
--     created_at  timestamptz
--     updated_at  timestamptz
--
-- Each teacher's existing survey_questions become one set, "My questions"
-- (only for an account that has no sets yet). survey_questions itself is left
-- alone: the app only reads it when this table is missing.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.survey_sets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  questions   jsonb not null default '[]'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists survey_sets_owner_idx on public.survey_sets (owner_id, sort_order);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_sets_questions_shape') then
    alter table public.survey_sets
      add constraint survey_sets_questions_shape
      check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 100);
  end if;
  -- a generous cap so one row can't grow without limit
  if not exists (select 1 from pg_constraint where conname = 'survey_sets_questions_size') then
    alter table public.survey_sets
      add constraint survey_sets_questions_size
      check (pg_column_size(questions) <= 300000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies
-- ---------------------------------------------------------------------------
alter table public.survey_sets enable row level security;

do $$
declare
  t text := 'survey_sets';
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
-- 3. Each teacher's question bank becomes their first set
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.survey_questions') is not null then
    insert into public.survey_sets (owner_id, name, questions, sort_order)
    select q.owner_id, 'My questions',
           jsonb_agg(jsonb_build_object('id', left(q.id::text, 8), 'question', q.question, 'answers', q.answers)
                     order by q.sort_order, q.created_at),
           0
    from public.survey_questions q
    where not exists (select 1 from public.survey_sets s where s.owner_id = q.owner_id)
    group by q.owner_id;
  end if;
end $$;

-- let PostgREST see the new table straight away
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Check: RLS on, four policies, and the sets per account
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'survey_sets';

select p.username, s.name as set_name, jsonb_array_length(s.questions) as questions
from public.profiles p
join public.survey_sets s on s.owner_id = p.user_id
order by p.username, s.sort_order;
