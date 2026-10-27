-- ============================================================================
-- migration-roster-numbers.sql — a hand-set roster number per student.
--
-- Adds:
--   • students.roster_number integer (1–999, nullable). Normally empty: the
--     app numbers each period itself, alphabetically by last name from 1.
--     Set from the Rosters page (Edit roster → click the number) only when a
--     student's number in Aeries differs; the alphabetical numbering then
--     skips the numbers set by hand.
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

alter table public.students
  add column if not exists roster_number integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'students_roster_number_check') then
    alter table public.students
      add constraint students_roster_number_check check (roster_number between 1 and 999);
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check: every student with a number set by hand.
select p.name as period, s.name as student, s.roster_number
  from public.students s join public.periods p on p.id = s.period_id
 where s.roster_number is not null
 order by p.sort_order, s.roster_number;
