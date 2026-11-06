-- ============================================================================
-- Migration: Family Feud — each teacher's own question bank.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- New table:
--   survey_questions
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     question    text        1–300 chars ("Name something you keep in your backpack.")
--     answers     jsonb       [{ "text": "Pencil", "points": 30 }, ...], 1–8 of them,
--                             highest points first (the app sorts them on save)
--     sort_order  integer     order in the game and the editor
--     created_at  timestamptz
--     updated_at  timestamptz
--
-- Then it gives the accounts 'khalid' and 'marwa' the eight starter questions
-- (only if that account has no questions yet, so re-running never doubles them).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.survey_questions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question    text not null check (length(btrim(question)) between 1 and 300),
  answers     jsonb not null default '[]'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists survey_questions_owner_idx on public.survey_questions (owner_id, sort_order);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_questions_answers_shape') then
    alter table public.survey_questions
      add constraint survey_questions_answers_shape
      check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) between 1 and 8);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies
-- ---------------------------------------------------------------------------
alter table public.survey_questions enable row level security;

do $$
declare
  t text := 'survey_questions';
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
-- 3. Seed the starter set for khalid and marwa (skipped if they have any)
-- ---------------------------------------------------------------------------
with starter(n, question, answers) as (values
  (1, 'Name something you keep in your backpack.',
      '[{"text":"Pencil","points":30},{"text":"Notebook","points":22},{"text":"Phone","points":18},{"text":"Water bottle","points":14},{"text":"Snack","points":9},{"text":"Charger","points":7}]'::jsonb),
  (2, 'Name something you find in a kitchen.',
      '[{"text":"Fridge","points":28},{"text":"Stove","points":24},{"text":"Sink","points":18},{"text":"Table","points":12},{"text":"Microwave","points":10},{"text":"Dishes","points":8}]'::jsonb),
  (3, 'Name something students do after school.',
      '[{"text":"Homework","points":26},{"text":"Sleep","points":20},{"text":"Play video games","points":18},{"text":"Sports","points":14},{"text":"Eat","points":12},{"text":"Work","points":10}]'::jsonb),
  (4, 'Name a food people eat for breakfast.',
      '[{"text":"Eggs","points":30},{"text":"Cereal","points":22},{"text":"Toast","points":18},{"text":"Fruit","points":12},{"text":"Pancakes","points":10},{"text":"Coffee","points":8}]'::jsonb),
  (5, 'Name something you see in a classroom.',
      '[{"text":"Desk","points":28},{"text":"Whiteboard","points":24},{"text":"Chairs","points":18},{"text":"Books","points":14},{"text":"Clock","points":9},{"text":"Backpack","points":7}]'::jsonb),
  (6, 'Name something people do on their phone.',
      '[{"text":"Text","points":30},{"text":"Watch videos","points":24},{"text":"Listen to music","points":16},{"text":"Games","points":14},{"text":"Take photos","points":10},{"text":"Call someone","points":6}]'::jsonb),
  (7, 'Name a place people go on the weekend.',
      '[{"text":"Mall","points":26},{"text":"Park","points":22},{"text":"Movies","points":18},{"text":"Friend''s house","points":14},{"text":"Beach","points":12},{"text":"Restaurant","points":8}]'::jsonb),
  (8, 'Name something in your mom''s purse.',
      '[{"text":"Keys","points":28},{"text":"Phone","points":22},{"text":"Wallet","points":18},{"text":"Lipstick","points":14},{"text":"Gum","points":10},{"text":"Tissues","points":8}]'::jsonb)
),
who as (
  select p.user_id
  from public.profiles p
  where lower(p.username) in ('khalid', 'marwa')
    and not exists (select 1 from public.survey_questions q where q.owner_id = p.user_id)
)
insert into public.survey_questions (owner_id, question, answers, sort_order)
select who.user_id, s.question, s.answers, s.n
from who cross join starter s;

-- let PostgREST see the new table straight away
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Check: RLS on, four policies, and the questions per account
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'survey_questions';

select p.username, count(q.id) as questions
from public.profiles p
left join public.survey_questions q on q.owner_id = p.user_id
group by p.username
order by p.username;
