-- ============================================================================
-- Migration: lesson plans + bathroom tracker — run once in the Supabase SQL editor.
-- Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- lesson_plans — one row per (period, date)
--   agenda: [{ id, text, minutes|null, done }] in order
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_plans (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  date        date not null,
  objective   text not null default '',
  agenda      jsonb not null default '[]'::jsonb,
  materials   text not null default '',
  homework    text not null default '',
  notes       text not null default '',
  updated_at  timestamptz not null default now(),
  unique (period_id, date)
);
create index if not exists lesson_plans_date_idx on public.lesson_plans (date);

-- ---------------------------------------------------------------------------
-- bathroom_log — one row per trip; in_at is null while the student is out
-- ---------------------------------------------------------------------------
create table if not exists public.bathroom_log (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  date        date not null,
  out_at      timestamptz not null default now(),
  in_at       timestamptz,                          -- null while the student is out
  manual      boolean not null default false,       -- tally from the paper tracker, not a timed trip
  quarter     text check (quarter in ('Q1', 'Q2', 'Q3', 'Q4')),   -- set on manual rows
  count       integer not null default 1 check (count >= 0),     -- passes used (manual rows)
  created_at  timestamptz not null default now()
);
create index if not exists bathroom_log_period_date_idx on public.bathroom_log (period_id, date);
create index if not exists bathroom_log_student_idx on public.bathroom_log (student_id);
-- if the table already existed without the tally columns
alter table public.bathroom_log add column if not exists manual  boolean not null default false;
alter table public.bathroom_log add column if not exists quarter text check (quarter in ('Q1', 'Q2', 'Q3', 'Q4'));
alter table public.bathroom_log add column if not exists count   integer not null default 1 check (count >= 0);
create unique index if not exists bathroom_log_manual_uidx on public.bathroom_log (student_id, quarter) where manual;

alter table public.lesson_plans  enable row level security;
alter table public.bathroom_log  enable row level security;

-- TEMPORARY POLICIES — no login yet. Replace with per-user policies when auth
-- is added:
--   drop policy "TEMP anon full access" on public.lesson_plans;
--   drop policy "TEMP anon full access" on public.bathroom_log;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lesson_plans'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.lesson_plans
      for all to anon using (true) with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bathroom_log'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.bathroom_log
      for all to anon using (true) with check (true);
  end if;
end $$;

-- Tell PostgREST about the new tables right away.
notify pgrst, 'reload schema';
