-- ============================================================================
-- migration-admin.sql — admin user-management for TeacherPal.
--
-- Adds:
--   • profiles.is_admin boolean (default false)
--   • public.admin_create_user(email, password, username) → uuid
--   • public.admin_reset_password(user_id, password)
--   • public.admin_list_users() → table (user_id, email, username, is_admin, created_at, last_sign_in_at)
--
-- All three functions are SECURITY DEFINER (run as the table owner, not the
-- caller) with an in-function `is_admin` guard. Callers must be an
-- authenticated user whose profiles.is_admin is true; anyone else gets
-- 'not authorized'. Granted EXECUTE to `authenticated` so admins can call
-- them via PostgREST RPC.
--
-- ⚠️  Fragility trade-off: creating auth users from SQL means inserting
--     into `auth.users` + `auth.identities` — Supabase-internal tables whose
--     column layout can change between versions. If a future Supabase
--     release adds a required column, admin_create_user will fail and the
--     insert here will need a matching field. The alternative (an Edge
--     Function using service_role + supabase.auth.admin.createUser) is more
--     future-proof but requires the Supabase CLI + a Deno function deploy,
--     which conflicts with TeacherPal's "plain HTML, no build step" rule.
--
-- Idempotent. Run after migration-usernames.sql (which created profiles).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. is_admin flag on profiles + seed Khalid.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

update public.profiles set is_admin = true where lower(username) = 'khalid';

-- ---------------------------------------------------------------------------
-- 2. admin_create_user — creates the auth user and the profiles row together.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_email    text,
  p_password text,
  p_username text
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_user_id  uuid;
  norm_email   text;
  norm_username text;
begin
  -- Only admins may call this.
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'email required' using errcode = '22023';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'password must be at least 6 characters' using errcode = '22023';
  end if;
  if p_username is null or btrim(p_username) = '' then
    raise exception 'username required' using errcode = '22023';
  end if;

  norm_email    := lower(btrim(p_email));
  norm_username := btrim(p_username);

  if exists (select 1 from auth.users where lower(email) = norm_email) then
    raise exception 'email already in use' using errcode = '23505';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(norm_username)) then
    raise exception 'username already in use' using errcode = '23505';
  end if;

  new_user_id := gen_random_uuid();

  -- Insert the auth user with a bcrypt-hashed password and email already
  -- confirmed (admin-created accounts don't need the confirmation flow).
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    norm_email, crypt(p_password, gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(), now(),
    '', '', '', ''
  );

  -- Matching identity row so email/password sign-in works.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    new_user_id::text, new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', norm_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  -- Matching profiles row so username sign-in works.
  insert into public.profiles (user_id, username, email, is_admin)
  values (new_user_id, norm_username, norm_email, false);

  return new_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. admin_reset_password — updates an existing auth user's password.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_password(
  p_user_id  uuid,
  p_password text
) returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'password must be at least 6 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found' using errcode = '02000';
  end if;

  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf', 10)),
         updated_at         = now()
   where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_list_users — joins profiles with auth.users for the admin table.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  user_id          uuid,
  email            text,
  username         text,
  is_admin         boolean,
  created_at       timestamptz,
  last_sign_in_at  timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select p.user_id, p.email, p.username, p.is_admin, p.created_at, u.last_sign_in_at
    from public.profiles p
    left join auth.users u on u.id = p.user_id
    order by lower(p.username);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants. authenticated may CALL the functions; the in-body admin check
--    is what actually enforces authorization.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_create_user(text, text, text) from public;
revoke all on function public.admin_reset_password(uuid, text) from public;
revoke all on function public.admin_list_users() from public;

grant execute on function public.admin_create_user(text, text, text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text)    to authenticated;
grant execute on function public.admin_list_users()                  to authenticated;

notify pgrst, 'reload schema';
