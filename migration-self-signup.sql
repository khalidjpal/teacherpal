-- ============================================================================
-- migration-self-signup.sql — self-service sign-up, gated by an admin switch.
--
--   • app_settings (one row): signup_open. Read through signup_status()
--     (anon may call it, so the login page knows whether to show the link);
--     written only through admin_set_signup_open() (admins only).
--   • A BEFORE INSERT trigger on auth.users rejects self sign-ups while
--     sign-up is closed, so closing it holds even against someone calling
--     /auth/v1/signup directly. Users created in the Supabase dashboard with
--     "Auto Confirm User" ticked, or invited from it, still go through.
--   • handle_new_user() now reads username / display_name from the sign-up
--     metadata (validated here, not just in the browser), with is_admin
--     false and theme 'default'.
--   • profiles.setup_done — false for new accounts until they finish (or
--     skip) the setup wizard; every existing account is marked done.
--   • username_available(text) and email_for_username(text) for the login
--     page, replacing the old "profiles public read" policy, which let
--     anyone without a login read every profile row (emails included).
--     Profiles are now readable only by their owner.
--   • admin_list_users() lists every auth user (profile or not) with
--     username, display name, email, created and last sign-in.
--
-- Sign-up starts CLOSED. Open it on the Admin page.
--
-- Also needed in the Supabase dashboard (not SQL):
--   Authentication → Sign In / Providers → Email: "Allow new users to sign
--     up" ON and "Confirm email" ON.
--   Authentication → URL Configuration: add your app's login page to
--     Redirect URLs, e.g. https://<your-app>.vercel.app/login.html and
--     http://127.0.0.1:8080/login.html for local testing.
--
-- Run after migration-theme-rename.sql. Safe to re-run; ends with a check.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. app_settings — one row. RLS on with no policies: only the SECURITY
--    DEFINER functions below can read or write it.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id           boolean primary key default true check (id),
  signup_open  boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
alter table public.app_settings enable row level security;

create or replace function public.signup_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select signup_open from public.app_settings where id), false);
$$;

create or replace function public.admin_set_signup_open(p_open boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.app_settings
     set signup_open = coalesce(p_open, false), updated_at = now(), updated_by = auth.uid()
   where id;
  return public.signup_status();
end;
$$;

revoke all on function public.signup_status() from public;
revoke all on function public.admin_set_signup_open(boolean) from public;
grant execute on function public.signup_status() to anon, authenticated;
grant execute on function public.admin_set_signup_open(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. profiles.setup_done
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'setup_done'
  ) then
    alter table public.profiles add column setup_done boolean not null default false;
    update public.profiles set setup_done = true;   -- everyone here already set up
  end if;
end $$;

create or replace function public.set_my_setup_done(p_done boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set setup_done = coalesce(p_done, true) where user_id = auth.uid();
$$;
revoke all on function public.set_my_setup_done(boolean) from public;
grant execute on function public.set_my_setup_done(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Usernames: one rule, used by the trigger and the availability check.
--    3–30 characters: letters, digits, dot, underscore, hyphen. Unique
--    case-insensitively (profiles_username_lower_uidx, from
--    migration-usernames.sql — recreated here in case it's missing).
-- ---------------------------------------------------------------------------
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

-- Dashboard-created users carry no username, so it must be optional
-- (migration-simplify-auth.sql did this too; harmless if already done).
alter table public.profiles alter column username drop not null;

create or replace function public.username_is_valid(p_username text)
returns boolean
language sql
immutable
as $$
  select p_username is not null and p_username ~ '^[A-Za-z0-9._-]{3,30}$';
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.username_is_valid(trim(p_username))
     and not exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)));
$$;

-- Username sign-in: the one lookup the login page needs, instead of letting
-- anon read the whole profiles table.
create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
$$;

revoke all on function public.username_available(text) from public;
revoke all on function public.email_for_username(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. profiles: owner-only reads (drops the anon-readable policy).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles public read" on public.profiles;
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles owner read'
  ) then
    create policy "profiles owner read" on public.profiles
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Gate: reject self sign-ups while sign-up is closed.
--    A self sign-up arrives unconfirmed (email_confirmed_at null) and not
--    invited. Dashboard-created users with "Auto Confirm User" ticked, and
--    dashboard invites, pass. The error text reaches the client only as
--    "Database error saving new user"; the login page re-checks
--    signup_status() to explain it.
-- ---------------------------------------------------------------------------
create or replace function public.gate_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is null
     and new.invited_at is null
     and not public.signup_status() then
    raise exception 'Sign-up is closed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists before_auth_user_created on auth.users;
create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.gate_new_auth_user();

-- ---------------------------------------------------------------------------
-- 6. handle_new_user(): the profiles row, now with the sign-up's username and
--    display name. Dashboard-created users carry no metadata and get NULLs,
--    as before. A taken or malformed username fails the whole sign-up (the
--    page checks first, so this only bites a race or a hand-made request).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  v_display  text := nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 60), '');
begin
  if v_username is not null and not public.username_is_valid(v_username) then
    raise exception 'invalid username' using errcode = '22023';
  end if;

  -- theme / teaches_periods come from their column defaults ('default',
  -- all eight periods) when those columns exist, so this works whether or
  -- not migration-teaches-periods.sql has been run.
  insert into public.profiles (user_id, email, username, display_name, is_admin, setup_done)
  values (
    new.id,
    new.email,
    v_username,
    v_display,
    false,
    false
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
-- 7. admin_list_users(): every auth user, newest first.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns setof json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not exists (select 1 from public.profiles where user_id = auth.uid() and is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select json_build_object(
      'user_id',         u.id,
      'email',           u.email,
      'username',        p.username,
      'display_name',    p.display_name,
      'is_admin',        coalesce(p.is_admin, false),
      'confirmed',       u.email_confirmed_at is not null,
      'created_at',      u.created_at,
      'last_sign_in_at', u.last_sign_in_at
    )
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

notify pgrst, 'reload schema';

-- Check: sign-up state, and the policies left on profiles.
select public.signup_status() as signup_open;
select policyname, roles, cmd from pg_policies where schemaname = 'public' and tablename = 'profiles';
