-- ============================================================================
-- TeacherPal schema — run this in the Supabase SQL editor.
--
-- Tables and columns:
--
--   periods
--     id          uuid        primary key
--     name        text        e.g. "Period 3", "Block B"
--     sort_order  integer     display order on selectors
--     created_at  timestamptz
--
--   students
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete)
--     name        text
--     sort_order  integer     display order within the period
--     created_at  timestamptz
--
--   room_layouts                (one shared room; key = 'default')
--     id          uuid        primary key
--     key         text        UNIQUE, default 'default'
--     layout      jsonb       { version, grid, front: {x,y,w,h}, pieces: [{ id, type, x, y, rotation }] }
--     updated_at  timestamptz
--
--   seat_assignments            (one row per period)
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete), UNIQUE
--     assignments jsonb       { "<pieceId>:<seatIndex>": "<student uuid>", ... }
--     updated_at  timestamptz
--
--   seating_rules               (one row per period AND scope — seating rules and
--                                grouping rules are separate data sets)
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete)
--     scope       text        'seating' | 'grouping'; UNIQUE (period_id, scope)
--     rules       jsonb       [{ id, type, a, b?, hard }] in priority order
--                             seating types: apart|together|close|front|back
--                             grouping types: apart|together|close
--     use_formula boolean     this scope's "Formula on/off" toggle
--     updated_at  timestamptz
--
--   attendance                  (one row per period AND date; present students
--                                are not stored)
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete)
--     date        date        UNIQUE (period_id, date)
--     marks       jsonb       { "<student uuid>": { status: 'absent'|'tardy', at: ISO } }
--     updated_at  timestamptz
--
--   lesson_plans                (one row per period AND date)
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete)
--     date        date        UNIQUE (period_id, date)
--     objective   text
--     agenda      jsonb       [{ id, text, minutes|null, done }] in order
--     materials   text
--     homework    text
--     notes       text
--     updated_at  timestamptz
--
--   bathroom_log                (one row per trip; in_at null while out)
--     id          uuid        primary key
--     period_id   uuid        -> periods.id (cascade delete)
--     student_id  uuid        -> students.id (cascade delete)
--     date        date
--     out_at      timestamptz
--     in_at       timestamptz null
--     manual      boolean     true = a tally, not a timed trip (count passes, no time)
--     quarter     text        'Q1'..'Q4' on manual rows (trips derive it from date)
--     count       integer     passes used (manual rows); 1 for trips
--     created_at  timestamptz
--
--   schedule_overrides          (one row per date that does not follow the
--                                weekday default bell schedule; see schedule.js)
--     id          uuid        primary key
--     date        date        UNIQUE
--     schedule    text        early_release | regular | minimum | double_second |
--                             homecoming | finals | no_school
--     finals_pair text        '1-2' | '3-4' | '5-6' — required iff schedule = finals
--     note        text
--     created_at  timestamptz
--
-- Safe to re-run: uses IF NOT EXISTS for tables and DO blocks for policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.periods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists students_period_id_idx on public.students(period_id);

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

create table if not exists public.seating_rules (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references public.periods(id) on delete cascade,
  scope        text not null default 'seating' check (scope in ('seating', 'grouping')),
  rules        jsonb not null default '[]'::jsonb,
  use_formula  boolean not null default false,        -- this scope's "Formula on/off" toggle
  updated_at   timestamptz not null default now(),
  unique (period_id, scope)
);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  date        date not null,
  marks       jsonb not null default '{}'::jsonb,   -- only absences + tardies
  updated_at  timestamptz not null default now(),
  unique (period_id, date)
);
create index if not exists attendance_date_idx on public.attendance (date);

create table if not exists public.lesson_plans (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  date        date not null,
  objective   text not null default '',
  agenda      jsonb not null default '[]'::jsonb,   -- [{ id, text, minutes|null, done }]
  materials   text not null default '',
  homework    text not null default '',
  notes       text not null default '',
  updated_at  timestamptz not null default now(),
  unique (period_id, date)
);
create index if not exists lesson_plans_date_idx on public.lesson_plans (date);

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
create unique index if not exists bathroom_log_manual_uidx on public.bathroom_log (student_id, quarter) where manual;

create table if not exists public.schedule_overrides (
  id           uuid primary key default gen_random_uuid(),
  date         date not null unique,
  schedule     text not null check (schedule in (
                 'early_release', 'regular', 'minimum', 'double_second',
                 'homecoming', 'finals', 'no_school')),
  finals_pair  text check (finals_pair in ('1-2', '3-4', '5-6')),  -- only for finals
  note         text,
  created_at   timestamptz not null default now(),
  check ((schedule = 'finals') = (finals_pair is not null))
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- RLS is enabled on every table. Without a policy, the anon key can do nothing.
-- ---------------------------------------------------------------------------

alter table public.periods        enable row level security;
alter table public.students       enable row level security;
alter table public.room_layouts     enable row level security;
alter table public.seat_assignments enable row level security;
alter table public.seating_rules    enable row level security;
alter table public.attendance       enable row level security;
alter table public.lesson_plans     enable row level security;
alter table public.bathroom_log     enable row level security;
alter table public.schedule_overrides enable row level security;

-- ===========================================================================
-- TEMPORARY POLICIES — no login yet.
-- These give the anon role full select/insert/update/delete on every table.
-- REPLACE these with per-user policies (auth.uid() = owner_id, etc.) when
-- authentication is added. To remove:
--   drop policy "TEMP anon full access" on public.periods;
--   drop policy "TEMP anon full access" on public.students;
--   drop policy "TEMP anon full access" on public.room_layouts;
--   drop policy "TEMP anon full access" on public.seat_assignments;
--   drop policy "TEMP anon full access" on public.seating_rules;
--   drop policy "TEMP anon full access" on public.attendance;
--   drop policy "TEMP anon full access" on public.lesson_plans;
--   drop policy "TEMP anon full access" on public.bathroom_log;
--   drop policy "TEMP anon full access" on public.schedule_overrides;
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'periods'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.periods
      for all to anon using (true) with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'students'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.students
      for all to anon using (true) with check (true);
  end if;
end $$;

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

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attendance'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.attendance
      for all to anon using (true) with check (true);
  end if;
end $$;

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

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schedule_overrides'
      and policyname = 'TEMP anon full access'
  ) then
    create policy "TEMP anon full access" on public.schedule_overrides
      for all to anon using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed data: known finals dates (1/2, 3/4, 5/6 order each term)
-- ---------------------------------------------------------------------------

insert into public.schedule_overrides (date, schedule, finals_pair, note) values
  ('2026-12-16', 'finals', '1-2', 'Fall finals'),
  ('2026-12-17', 'finals', '3-4', 'Fall finals'),
  ('2026-12-18', 'finals', '5-6', 'Fall finals'),
  ('2027-05-25', 'finals', '1-2', 'Spring finals'),
  ('2027-05-26', 'finals', '3-4', 'Spring finals'),
  ('2027-05-27', 'finals', '5-6', 'Spring finals')
on conflict (date) do nothing;
