-- ============================================================================
-- migration-onboarding.sql — the guided setup (setup.html)
--
-- Run once in the Supabase SQL editor, after migration-self-signup.sql.
-- Safe to re-run. Adds to profiles:
--
--   1. bell_schedule jsonb — whose bell times this teacher uses:
--        null                       never answered (every account from before
--                                   this migration: West High teachers)
--        { "source": "west_high" }  confirmed: West High (TUSD)
--        { "source": "custom", "school": "…",
--          "segments": [ { "kind": "period", "n": 1, "start": "08:00", "end": "08:55" },
--                        { "kind": "break", "label": "Lunch", "start": "…", "end": "…" }, … ] }
--                                   their own regular day (schedule.js uses it
--                                   for every school day instead of West High's)
--   2. setup_progress jsonb — where the wizard got to, so closing the tab
--      loses nothing: { "step": "students", "deferred": false,
--      "steps": { "periods": "done", "bells": "skipped", … } }
--   3. RPCs, each touching only the caller's own row (profiles has no
--      client update policy): set_my_bell_schedule(jsonb),
--      set_my_setup_progress(jsonb), set_my_display_name(text).
-- ============================================================================

alter table public.profiles add column if not exists bell_schedule jsonb;
alter table public.profiles add column if not exists setup_progress jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bell_schedule_shape') then
    alter table public.profiles add constraint profiles_bell_schedule_shape check (
      bell_schedule is null
      or (jsonb_typeof(bell_schedule) = 'object'
          and bell_schedule->>'source' in ('west_high', 'custom')
          and (bell_schedule->>'source' = 'west_high'
               or (jsonb_typeof(bell_schedule->'segments') = 'array'
                   and jsonb_array_length(bell_schedule->'segments') between 1 and 20)))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_setup_progress_shape') then
    alter table public.profiles add constraint profiles_setup_progress_shape check (
      setup_progress is null or (jsonb_typeof(setup_progress) = 'object' and length(setup_progress::text) <= 4000)
    );
  end if;
end $$;

-- Every segment: a period 0–7 or a labelled break, 'HH:MM' times, start < end.
create or replace function public.set_my_bell_schedule(p_bells jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seg jsonb;
begin
  if p_bells is not null and p_bells->>'source' = 'custom' then
    for seg in select * from jsonb_array_elements(coalesce(p_bells->'segments', '[]'::jsonb)) loop
      if seg->>'kind' not in ('period', 'break')
         or coalesce(seg->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(seg->>'end', '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or seg->>'start' >= seg->>'end'
         or (seg->>'kind' = 'period' and coalesce(seg->>'n', '') !~ '^[0-7]$')
         or (seg->>'kind' = 'break' and length(coalesce(seg->>'label', '')) not between 1 and 30) then
        raise exception 'bad bell schedule segment: %', seg;
      end if;
    end loop;
    if length(coalesce(p_bells->>'school', '')) > 80 then raise exception 'school name too long'; end if;
  end if;
  update public.profiles set bell_schedule = p_bells where user_id = auth.uid();
end $$;
revoke all on function public.set_my_bell_schedule(jsonb) from public;
grant execute on function public.set_my_bell_schedule(jsonb) to authenticated;

create or replace function public.set_my_setup_progress(p_progress jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set setup_progress = p_progress where user_id = auth.uid();
$$;
revoke all on function public.set_my_setup_progress(jsonb) from public;
grant execute on function public.set_my_setup_progress(jsonb) to authenticated;

-- The wizard's "You" step. Blank clears it (the app then falls back to the
-- username, then the email).
create or replace function public.set_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(coalesce(trim(p_name), '')) > 60 then raise exception 'display name too long'; end if;
  update public.profiles set display_name = nullif(trim(p_name), '') where user_id = auth.uid();
end $$;
revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.set_my_display_name(text) to authenticated;

notify pgrst, 'reload schema';

-- Check: one row per account, what it has.
select username, setup_done,
       coalesce(bell_schedule->>'source', '(not answered)') as bells,
       setup_progress->>'step' as setup_step
  from public.profiles
 order by username;
