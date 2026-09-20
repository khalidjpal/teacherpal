-- ============================================================================
-- migration-admin.sql — admin user-management for TeacherPal.
--
-- Adds:
--   • profiles.is_admin boolean (default false)
--   • public.admin_create_user(email, password, username) → uuid
--   • public.admin_reset_password(user_id, password)
--   • public.admin_list_users() → setof json
--
-- All three functions are SECURITY DEFINER with an in-function `is_admin`
-- guard. Callers must be an authenticated user whose profiles.is_admin is
-- true; anyone else gets 'not authorized'.
--
-- Notes on the tricky bits:
--   • pgcrypto lives in the **extensions** schema on modern Supabase
--     projects, not in `public`. crypt() / gen_salt() must be schema-
--     qualified as `extensions.crypt(...)` (this is also the
--     search_path-injection-safe pattern Supabase recommends for
--     SECURITY DEFINER functions).
--   • admin_list_users returns SETOF json (built by json_build_object)
--     rather than RETURNS TABLE (...) so the OUT-parameter names in the
--     RETURNS TABLE signature can't collide with source columns —
--     PostgreSQL raises "column reference is ambiguous" otherwise. The
--     JSON shape is what the client sees.
--   • Directly inserting into auth.users / auth.identities couples us to
--     Supabase's internal auth schema. Verified against the current shape
--     (late 2025 / early 2026): `id` is required with no default, most
--     other columns nullable or defaulted. `is_anonymous` (NOT NULL, added
--     later) has a default of false so it fills itself. `confirmed_at` is
--     GENERATED — never insert into it. `auth.identities.id` now has its
--     own uuid default; `auth.identities.email` is GENERATED.
--
-- Idempotent. Run after migration-usernames.sql (which created profiles).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 0. Drop the existing admin functions before recreating them.
--    `create or replace function` refuses to change the return type of an
--    existing function (Postgres error 42P13), and admin_list_users moved
--    from RETURNS TABLE (...) to RETURNS SETOF json. Explicit drops with the
--    full argument signatures make this migration safely re-runnable on top
--    of any previous version.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_user(text, text, text);
drop function if exists public.admin_reset_password(uuid, text);
drop function if exists public.admin_list_users();

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
set search_path = public, auth, extensions
as $$
declare
  new_user_id   uuid;
  norm_email    text;
  norm_username text;
begin
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

  -- Insert the auth user. Schema-qualify crypt/gen_salt so this works no
  -- matter which schema pgcrypto lives in.
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
    norm_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(), now(),
    '', '', '', ''
  );

  -- Matching identity row so email/password sign-in works. auth.identities.id
  -- has a uuid default, so we don't send it; auth.identities.email is
  -- GENERATED, so we don't send that either.
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
set search_path = public, auth, extensions
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
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at         = now()
   where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_list_users — joins profiles with auth.users for the admin table.
--    Returns SETOF json (not RETURNS TABLE) so OUT-column names can't collide
--    with source columns. PostgREST wraps this into a top-level JSON array
--    of the shape [{user_id, email, username, is_admin, created_at,
--    last_sign_in_at}, ...] which is what the client reads.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns setof json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select json_build_object(
      'user_id',         p.user_id,
      'email',           p.email,
      'username',        p.username,
      'is_admin',        p.is_admin,
      'created_at',      p.created_at,
      'last_sign_in_at', u.last_sign_in_at
    )
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
