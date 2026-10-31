-- ============================================================================
-- migration-theme-rename.sql — per-user theme on the profile, with the
-- renamed theme ids. Run this one file from scratch; safe to re-run.
--
-- Before this, profiles had no theme column and set_my_theme() didn't exist
-- (migration-themes.sql was never run), so a teacher's theme lived only in
-- their browser's localStorage. This file:
--
--   1. adds profiles.theme. Existing rows start NULL ("not chosen on the
--      server yet"): the next time that teacher opens the app, shared.js
--      saves the theme their browser already uses, so nobody's choice is
--      lost. New rows default to 'default'.
--   2. renames old ids, if any rows have them: jarvis → default,
--      marwa → pink, earthy (removed) → default. A no-op on a fresh column.
--   3. adds a format check (lower-case id, ≤ 40 chars).
--   4. creates set_my_theme(text): a signed-in teacher updates their own
--      row's theme and nothing else (profiles has no client update policy).
--
-- The app reads profiles.theme on every page load and writes it through
-- set_my_theme when the gear menu (or the setup wizard) changes it, so the
-- theme follows the teacher across devices.
-- ============================================================================

-- 1. The column. Added without a default first so existing rows stay NULL,
--    then the default is set for rows created from now on.
alter table public.profiles add column if not exists theme text;
alter table public.profiles alter column theme drop not null;
alter table public.profiles alter column theme set default 'default';

-- 2. Old ids → new ids (touches only rows that have one).
update public.profiles
   set theme = case theme
                 when 'jarvis' then 'default'
                 when 'marwa'  then 'pink'
                 when 'earthy' then 'default'
               end
 where theme in ('jarvis', 'marwa', 'earthy');

-- 3. Format check. Unknown-but-well-formed ids are allowed: the client falls
--    back to 'default' for anything it doesn't know.
alter table public.profiles drop constraint if exists profiles_theme_format;
alter table public.profiles
  add constraint profiles_theme_format
  check (theme is null or theme ~ '^[a-z0-9_-]{1,40}$');

-- 4. The write path.
create or replace function public.set_my_theme(p_theme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_theme is null or p_theme !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'invalid theme name' using errcode = '22023';
  end if;
  update public.profiles set theme = p_theme where user_id = auth.uid();
end;
$$;

revoke all on function public.set_my_theme(text) from public;
grant execute on function public.set_my_theme(text) to authenticated;

notify pgrst, 'reload schema';

-- Check: every row is NULL (picks up its browser's theme on next visit),
-- default, pink, halloween or thanksgiving.
select coalesce(theme, '(not chosen yet)') as theme, count(*) as users
  from public.profiles
 group by 1
 order by 1;
