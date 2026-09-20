-- ============================================================================
-- migration-teaches-periods.sql — per-user "which bell periods I teach".
--
-- Adds:
--   • profiles.teaches_periods integer[]  (which of the bell periods 0-7
--     this user actually teaches — the rest are their prep / break)
--   • set_my_teaches_periods(int[]) RPC (SECURITY DEFINER, updates own row
--     only; validates every value is 0-7, deduplicates, sorts)
--
-- The bell schedule itself still contains every period (real school times);
-- this setting only controls what shows up as "mine" vs "Prep" in the
-- schedule display, the hub status readout, and period-selector dropdowns.
--
-- Seeds:
--   khalid → {1,2,3,5,6}  (4th period is prep; no 0 or 7)
--   marwa  → {2,3,4,5,6}  (1st period is prep; no 0 or 7)
--
-- Idempotent. Run after migration-themes.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists teaches_periods integer[] not null
  default '{0,1,2,3,4,5,6,7}'::integer[];

-- Range check: every value 0-7 inclusive. Uses an IMMUTABLE lookup so it can
-- live in a CHECK constraint.
alter table public.profiles
  drop constraint if exists profiles_teaches_periods_range;
alter table public.profiles
  add constraint profiles_teaches_periods_range
  check (
    teaches_periods is null
    or teaches_periods <@ '{0,1,2,3,4,5,6,7}'::integer[]
  );

-- ---------------------------------------------------------------------------
-- 2. set_my_teaches_periods RPC
-- ---------------------------------------------------------------------------
drop function if exists public.set_my_teaches_periods(integer[]);

create or replace function public.set_my_teaches_periods(p_periods integer[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean integer[];
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_periods is null then
    raise exception 'periods required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_periods) as p where p < 0 or p > 7) then
    raise exception 'each period must be 0-7' using errcode = '22023';
  end if;

  -- dedupe + sort so the stored array is canonical
  select coalesce(array_agg(p order by p), '{}'::integer[])
    into clean
    from (select distinct unnest(p_periods) as p) s;

  update public.profiles
     set teaches_periods = clean
   where user_id = auth.uid();
end;
$$;

revoke all on function public.set_my_teaches_periods(integer[]) from public;
grant execute on function public.set_my_teaches_periods(integer[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed the two known accounts. Safe to re-run — only updates if the row
--    exists; a missing user is a no-op.
-- ---------------------------------------------------------------------------
update public.profiles
   set teaches_periods = '{1,2,3,5,6}'::integer[]
 where lower(username) = 'khalid';

update public.profiles
   set teaches_periods = '{2,3,4,5,6}'::integer[]
 where lower(username) = 'marwa';

notify pgrst, 'reload schema';
