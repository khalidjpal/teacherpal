-- ============================================================================
-- migration-winter-picker.sql — which picker the winter Name Wheel shows,
-- and how the sled race runs, per teacher.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
--   1. profiles.winter_picker text: 'sleigh' (Santa's sleigh and the present
--      pile) or 'race' (the sled race); null = never chosen (the app shows
--      the sleigh, or adopts what this browser chose and saves it).
--   2. set_my_winter_picker(text): the only way to write it, own row only
--      (profiles has no client update policy).
--   3. profiles.sled_race jsonb: { "length": "short" | "long",
--      "picks": 1..6 }; null = never chosen (a short race, one winner).
--   4. set_my_sled_race(jsonb): validates it, own row only.
--
-- Before this runs, the selectors on the Name Wheel still work in this
-- browser (it is cached in localStorage); it just doesn't follow the
-- teacher to other computers.
-- ============================================================================

alter table public.profiles add column if not exists winter_picker text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_winter_picker_check') then
    alter table public.profiles
      add constraint profiles_winter_picker_check
      check (winter_picker is null or winter_picker in ('sleigh', 'race'));
  end if;
end $$;

create or replace function public.set_my_winter_picker(p_pick text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_pick is not null and p_pick not in ('sleigh', 'race') then
    raise exception 'unknown winter picker %', p_pick;
  end if;
  update public.profiles set winter_picker = p_pick where user_id = auth.uid();
end $$;
revoke all on function public.set_my_winter_picker(text) from public;
grant execute on function public.set_my_winter_picker(text) to authenticated;

alter table public.profiles add column if not exists sled_race jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_sled_race_check') then
    alter table public.profiles
      add constraint profiles_sled_race_check
      check (sled_race is null or (jsonb_typeof(sled_race) = 'object' and pg_column_size(sled_race) < 400));
  end if;
end $$;

create or replace function public.set_my_sled_race(p_race jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_len text := p_race ->> 'length';
  v_picks int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_race is null then
    update public.profiles set sled_race = null where user_id = auth.uid();
    return;
  end if;
  if jsonb_typeof(p_race) <> 'object' then raise exception 'sled race must be an object'; end if;
  if v_len is null or v_len not in ('short', 'long') then raise exception 'unknown race length %', v_len; end if;
  begin
    v_picks := (p_race ->> 'picks')::int;
  exception when others then
    raise exception 'picks must be a whole number';
  end;
  if v_picks is null or v_picks < 1 or v_picks > 6 then raise exception 'picks must be 1 to 6'; end if;
  update public.profiles
     set sled_race = jsonb_build_object('length', v_len, 'picks', v_picks)
   where user_id = auth.uid();
end $$;
revoke all on function public.set_my_sled_race(jsonb) from public;
grant execute on function public.set_my_sled_race(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- Check: the columns exist and what each teacher chose.
select username, display_name, winter_picker, sled_race
  from public.profiles
 order by username;
