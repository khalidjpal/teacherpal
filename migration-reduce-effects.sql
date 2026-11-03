-- ============================================================================
-- migration-reduce-effects.sql — the "Reduce effects" setting, per teacher.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
--   1. profiles.reduce_effects boolean (default false): when true, the app
--      drops ambient motion, thins particles and skips glows / blur filters
--      on every device the teacher signs in on (shared.js puts
--      data-effects="reduced" on <html>; the rules are the "Reduce effects"
--      block at the end of style.css).
--   2. set_my_reduce_effects(boolean): the only way to write it, own row only
--      (profiles has no client update policy).
--
-- Before this runs, the gear menu's switch still works in this browser
-- (it is cached in localStorage); it just doesn't follow the teacher to
-- other computers.
-- ============================================================================

alter table public.profiles add column if not exists reduce_effects boolean not null default false;

create or replace function public.set_my_reduce_effects(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.profiles set reduce_effects = coalesce(p_on, false) where user_id = auth.uid();
end $$;
revoke all on function public.set_my_reduce_effects(boolean) from public;
grant execute on function public.set_my_reduce_effects(boolean) to authenticated;

notify pgrst, 'reload schema';

-- Check: the column exists and who has it on.
select username, display_name, reduce_effects
  from public.profiles
 order by username;
