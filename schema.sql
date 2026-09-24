-- ============================================================================
-- TeacherPal schema — run this in the Supabase SQL editor.
--
-- **Multi-tenant.** Every table has owner_id (uuid → auth.users.id, default
-- auth.uid()), and RLS restricts each authenticated user to their own rows.
-- The anon role has no access to any table in this file. Login flow lives
-- in shared.js (Supabase Auth email/password); accounts are created in the
-- Supabase dashboard (no public sign-up).
--
-- Any NEW table added later MUST:
--   1. include  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade
--   2. enable RLS
--   3. add the four per-owner policies (see the DO block at the bottom)
--   4. include owner_id in any per-user uniqueness constraint
--
-- Tables and columns:
--
--   periods
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     name        text        e.g. "Period 3", "Block B"
--     sort_order  integer     display order on selectors
--     created_at  timestamptz
--
--   students
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     name        text
--     sort_order  integer     display order within the period
--     created_at  timestamptz
--
--   room_layouts                (one shared room per OWNER; key = 'default'
--                                per (key, owner_id) — teachers don't share)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     key         text        default 'default'; UNIQUE (key, owner_id)
--     layout      jsonb       { version, grid, front: {x,y,w,h,rotation?}, pieces: [{ id, type, x, y, rotation }] }
--     updated_at  timestamptz
--
--   seat_assignments            (LEGACY — one row per period. No longer written;
--                                read only as a fallback before
--                                seating_arrangements exists)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete), UNIQUE
--     assignments jsonb       { "<pieceId>:<seatIndex>": "<student uuid>", ... }
--     updated_at  timestamptz
--
--   seating_arrangements        (named seating charts, several per period;
--                                at most one active = what Attendance shows)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     name        text        UNIQUE (period_id, lower(name))
--     assignments jsonb       { "<pieceId>:<seatIndex>": "<student uuid>", ... }
--     layout      jsonb       the desk layout it was saved on (room_layouts shape); null = unknown
--     is_active   boolean     UNIQUE (period_id) WHERE is_active
--     created_at  timestamptz
--     updated_at  timestamptz
--     RPC set_active_seating_arrangement(p_id uuid) swaps the active one
--
--   seating_rules               (one row per period AND scope — seating rules and
--                                grouping rules are separate data sets)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
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
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     date        date        UNIQUE (period_id, date)
--     marks       jsonb       { "<student uuid>": { status: 'absent'|'tardy', at: ISO } }
--     updated_at  timestamptz
--
--   lesson_plans                (one row per period AND date)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
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
--     owner_id    uuid        -> auth.users.id (cascade delete)
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
--   schedule_overrides          (one row per date PER OWNER that doesn't
--                                follow the weekday default bell schedule)
--     id           uuid        primary key
--     owner_id     uuid        -> auth.users.id (cascade delete)
--     date         date        UNIQUE (date, owner_id)
--     schedule     text        early_release | regular | minimum | double_second |
--                              homecoming | finals | no_school
--     finals_pair  text        '1-2' | '3-4' | '5-6' — required iff schedule = finals
--     note         text
--     created_at   timestamptz
--
-- Safe to re-run: uses IF NOT EXISTS for tables, indexes, and DO blocks for
-- policies. This file is the canonical *current* state. If you already have
-- a project running the old anon-only schema, use migration-auth.sql to
-- upgrade in place rather than dropping tables.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.periods (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists periods_owner_idx on public.periods(owner_id);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists students_period_id_idx on public.students(period_id);
create index if not exists students_owner_idx on public.students(owner_id);

create table if not exists public.room_layouts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key         text not null default 'default',
  layout      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create unique index if not exists room_layouts_key_owner_uidx on public.room_layouts (key, owner_id);
create index if not exists room_layouts_owner_idx on public.room_layouts(owner_id);

create table if not exists public.seat_assignments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id    uuid not null unique references public.periods(id) on delete cascade,
  assignments  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);
create index if not exists seat_assignments_owner_idx on public.seat_assignments(owner_id);

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
create index if not exists seating_arrangements_owner_idx on public.seating_arrangements (owner_id);
create index if not exists seating_arrangements_period_idx on public.seating_arrangements (period_id);
create unique index if not exists seating_arrangements_period_name_uidx on public.seating_arrangements (period_id, lower(name));
create unique index if not exists seating_arrangements_one_active_uidx on public.seating_arrangements (period_id) where is_active;

-- Make one arrangement active and the rest of its period not, in one
-- transaction. SECURITY INVOKER: RLS limits it to the caller's own rows.
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
  update public.seating_arrangements set is_active = false where period_id = v_period and is_active and id <> p_id;
  update public.seating_arrangements set is_active = true where id = p_id;
end;
$$;
revoke all on function public.set_active_seating_arrangement(uuid) from public;
grant execute on function public.set_active_seating_arrangement(uuid) to authenticated;

create table if not exists public.seating_rules (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id    uuid not null references public.periods(id) on delete cascade,
  scope        text not null default 'seating' check (scope in ('seating', 'grouping')),
  rules        jsonb not null default '[]'::jsonb,
  use_formula  boolean not null default false,
  updated_at   timestamptz not null default now(),
  unique (period_id, scope)
);
create index if not exists seating_rules_owner_idx on public.seating_rules(owner_id);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  date        date not null,
  marks       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (period_id, date)
);
create index if not exists attendance_date_idx  on public.attendance (date);
create index if not exists attendance_owner_idx on public.attendance (owner_id);

create table if not exists public.lesson_plans (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
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
create index if not exists lesson_plans_date_idx  on public.lesson_plans (date);
create index if not exists lesson_plans_owner_idx on public.lesson_plans (owner_id);

create table if not exists public.bathroom_log (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  date        date not null,
  out_at      timestamptz not null default now(),
  in_at       timestamptz,
  manual      boolean not null default false,
  quarter     text check (quarter in ('Q1', 'Q2', 'Q3', 'Q4')),
  count       integer not null default 1 check (count >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists bathroom_log_period_date_idx on public.bathroom_log (period_id, date);
create index if not exists bathroom_log_student_idx on public.bathroom_log (student_id);
create index if not exists bathroom_log_owner_idx   on public.bathroom_log (owner_id);
create unique index if not exists bathroom_log_manual_owner_uidx
  on public.bathroom_log (owner_id, student_id, quarter) where manual;

create table if not exists public.schedule_overrides (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date         date not null,
  schedule     text not null check (schedule in (
                 'early_release', 'regular', 'minimum', 'double_second',
                 'homecoming', 'finals', 'no_school')),
  finals_pair  text check (finals_pair in ('1-2', '3-4', '5-6')),
  note         text,
  created_at   timestamptz not null default now(),
  check ((schedule = 'finals') = (finals_pair is not null))
);
create unique index if not exists schedule_overrides_date_owner_uidx on public.schedule_overrides (date, owner_id);
create index if not exists schedule_overrides_owner_idx on public.schedule_overrides (owner_id);

-- ---------------------------------------------------------------------------
-- Row Level Security. Every table locks down to authenticated users, filtered
-- by owner_id = auth.uid(). No anon access anywhere in this file — the
-- if any future student-facing pages need tables, they'd live outside this
-- schema and get their own narrow anon policies (never grant anon access
-- to any of the teacher-owned tables above).
-- ---------------------------------------------------------------------------

alter table public.periods            enable row level security;
alter table public.students           enable row level security;
alter table public.room_layouts       enable row level security;
alter table public.seat_assignments   enable row level security;
alter table public.seating_arrangements enable row level security;
alter table public.seating_rules      enable row level security;
alter table public.attendance         enable row level security;
alter table public.lesson_plans       enable row level security;
alter table public.bathroom_log       enable row level security;
alter table public.schedule_overrides enable row level security;

do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array[
    'periods','students','room_layouts','seat_assignments','seating_arrangements','seating_rules',
    'attendance','lesson_plans','bathroom_log','schedule_overrides'
  ] loop
    policy_name := format('%s owner select', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    policy_name := format('%s owner insert', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    policy_name := format('%s owner update', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    policy_name := format('%s owner delete', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
  end loop;
end $$;
