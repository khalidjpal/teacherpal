-- ============================================================================
-- Migration: attendance — run once in the Supabase SQL editor.
--
-- One row per (period, date). Present students are not stored; `marks`
-- only holds absences and tardies:
--   { "<student uuid>": { "status": "absent" | "tardy", "at": "<ISO timestamp>" } }
-- Written by the hub's attendance chart and by Create Groups' Edit Roster.
-- Safe to re-run.
-- ============================================================================

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.periods(id) on delete cascade,
  date        date not null,
  marks       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (period_id, date)
);

create index if not exists attendance_date_idx on public.attendance (date);

alter table public.attendance enable row level security;

-- TEMPORARY POLICY — no login yet. Replace with per-user policies when auth
-- is added:  drop policy "TEMP anon full access" on public.attendance;
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

-- Tell PostgREST about the new table right away.
notify pgrst, 'reload schema';
