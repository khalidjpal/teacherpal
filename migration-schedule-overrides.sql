-- ============================================================================
-- Migration: bell-schedule overrides — run once in the Supabase SQL editor.
--
-- Adds schedule_overrides: one row per calendar date that does NOT follow the
-- weekday default (Monday = Early Release, Tue–Fri = regular). The bell
-- schedules themselves are data in schedule.js; this table only says which
-- schedule a given date uses. Safe to re-run.
-- ============================================================================

create table if not exists public.schedule_overrides (
  id           uuid primary key default gen_random_uuid(),
  date         date not null unique,
  schedule     text not null check (schedule in (
                 'early_release', 'regular', 'minimum', 'double_second',
                 'homecoming', 'finals', 'no_school')),
  finals_pair  text check (finals_pair in ('1-2', '3-4', '5-6')),  -- only for finals
  note         text,
  created_at   timestamptz not null default now(),
  -- finals rows must say which pair; every other schedule must not
  check ((schedule = 'finals') = (finals_pair is not null))
);

alter table public.schedule_overrides enable row level security;

-- TEMPORARY POLICY — no login yet. Replace with per-user policies when auth
-- is added:  drop policy "TEMP anon full access" on public.schedule_overrides;
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

-- Pre-seed the known finals dates (1/2, 3/4, 5/6 order each term).
insert into public.schedule_overrides (date, schedule, finals_pair, note) values
  ('2026-12-16', 'finals', '1-2', 'Fall finals'),
  ('2026-12-17', 'finals', '3-4', 'Fall finals'),
  ('2026-12-18', 'finals', '5-6', 'Fall finals'),
  ('2027-05-25', 'finals', '1-2', 'Spring finals'),
  ('2027-05-26', 'finals', '3-4', 'Spring finals'),
  ('2027-05-27', 'finals', '5-6', 'Spring finals')
on conflict (date) do nothing;

-- Tell PostgREST about the new table right away.
notify pgrst, 'reload schema';
