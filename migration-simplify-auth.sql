-- ============================================================================
-- migration-simplify-auth.sql — drop the custom sign-in machinery and let
-- Supabase Auth do all password work.
--
-- Removes:
--   • admin_create_user(text,text,text)  — users are now created in the
--                                          Supabase dashboard directly.
--   • admin_reset_password(uuid,text)    — passwords are now reset in the
--                                          dashboard (or via Supabase's
--                                          own recovery flow).
--
-- Adds:
--   • public.handle_new_user() + trigger on auth.users AFTER INSERT — every
--     dashboard-created (or otherwise-inserted) auth user gets a matching
--     profiles row automatically, seeded with is_admin=false, theme='jarvis',
--     teaches_periods={0..7}. Anyone already in auth.users gets one too,
--     via the backfill INSERT below.
--   • public.handle_auth_user_email_change() + trigger on auth.users AFTER
--     UPDATE — if you edit a user's email in the dashboard, profiles.email
--     tracks it automatically.
--
-- Loosens:
--   • profiles.username → nullable. Dashboard-created accounts have no
--     username by default; the app displays profiles.username when set,
--     otherwise falls back to email.
--
-- Keeps (unchanged):
--   • owner_id + per-owner RLS on every teacher-owned table
--   • profiles.theme + set_my_theme
--   • profiles.teaches_periods + set_my_teaches_periods
--   • profiles.is_admin + admin_list_users (admin page is read-only now)
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the admin write RPCs (any signature variant).
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_user(text, text, text);
drop function if exists public.admin_reset_password(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. Make username optional.
-- ---------------------------------------------------------------------------
alter table public.profiles
  alter column username drop not null;

-- ---------------------------------------------------------------------------
-- 3. Auto-create a profiles row for any new auth.users insert (dashboard,
--    admin API, whatever).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, is_admin, theme, teaches_periods)
  values (
    new.id,
    new.email,
    false,
    'jarvis',
    '{0,1,2,3,4,5,6,7}'::integer[]
  )
  on conflict (user_id) do update
     set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. If you change a user's email in the dashboard, sync it to profiles.
-- ---------------------------------------------------------------------------
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set email = new.email
     where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- 5. Backfill: any auth.users without a profiles row gets one now.
--    (Existing users — khalid, marwa — already have rows; this is defensive
--    and idempotent.)
-- ---------------------------------------------------------------------------
insert into public.profiles (user_id, email, is_admin, theme, teaches_periods)
select
  u.id,
  u.email,
  false,
  'jarvis',
  '{0,1,2,3,4,5,6,7}'::integer[]
from auth.users u
where not exists (
  select 1 from public.profiles p where p.user_id = u.id
);

notify pgrst, 'reload schema';
