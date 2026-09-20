-- ============================================================================
-- migration-auth-repair.sql — repair sign-in for both existing users, harden
-- admin_create_user so future users work out of the gate.
--
-- What we know:
--   • khalid was created in the Supabase dashboard, password reset via SQL
--     `extensions.crypt(..., extensions.gen_salt('bf'))`
--   • marwa was created via admin_create_user (also SQL crypt())
--   • Both fail sign-in with 400 invalid_grant "Invalid login credentials"
--
-- What's actually verified below:
--   1. That pgcrypto's crypt() round-trips (rules out hash-format weirdness).
--      Any $2a$-prefix bcrypt hash produced by pgcrypto is valid input for
--      Go's bcrypt (GoTrue) — they follow the same spec.
--   2. That both users have a matching row in auth.identities with
--      provider='email' and a well-formed identity_data. GoTrue's password
--      grant expects one; users inserted with raw SQL that skipped it will
--      fail even with a correct hash.
--   3. That every auth.users field GoTrue reads (aud, role, meta_data,
--      email_confirmed_at, is_anonymous) is populated correctly.
--
-- ⚠️  Before running Step 4 (password reset), edit the two placeholder
--    passwords near the bottom. Both stay bcrypt-hashed at rest.
--
-- Idempotent. Safe to run repeatedly. Nothing deletes an auth user.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 · Diagnostic. Run first, inspect the two result sets, then run
--          the rest of the file. Read-only.
-- ---------------------------------------------------------------------------

-- 1a. Current state of both auth.users rows.
select
  u.email,
  u.id,
  substring(u.encrypted_password from 1 for 4) as pw_prefix,   -- expect '$2a$' or '$2b$'
  length(u.encrypted_password)                  as pw_len,      -- expect 60
  u.email_confirmed_at is not null              as email_confirmed,
  u.banned_until,
  u.aud,                                                        -- expect 'authenticated'
  u.role,                                                       -- expect 'authenticated'
  u.is_anonymous,                                               -- expect false
  u.raw_app_meta_data,                                          -- expect {"provider":"email","providers":["email"]}
  (select count(*) from auth.identities i
   where i.user_id = u.id and i.provider = 'email') as email_identity_count
from auth.users u
where u.email in ('khalidjpal@gmail.com', 'marwa@teacherpal.local')
order by u.email;

-- 1b. Sanity check: does pgcrypto crypt() round-trip on this database?
-- If false, pgcrypto is doing something unexpected and the whole approach
-- is unsafe. If true, hash format is fine and the problem is elsewhere.
select
  extensions.crypt('sample', extensions.gen_salt('bf', 10)) as sample_hash,
  extensions.crypt('sample', extensions.crypt('sample', extensions.gen_salt('bf', 10)))
    = extensions.crypt('sample', extensions.gen_salt('bf', 10)) as note_this_is_expected_false,
  -- Real round-trip test:
  (with h as (select extensions.crypt('sample', extensions.gen_salt('bf', 10)) as v)
   select extensions.crypt('sample', h.v) = h.v from h) as pgcrypto_roundtrip_ok;


-- ---------------------------------------------------------------------------
-- STEP 2 · Repair auth.users fields (safe — non-destructive on values that
--          were already correct).
-- ---------------------------------------------------------------------------
update auth.users
   set aud                 = coalesce(nullif(aud,  ''), 'authenticated'),
       role                = coalesce(nullif(role, ''), 'authenticated'),
       email_confirmed_at  = coalesce(email_confirmed_at, now()),
       raw_app_meta_data   = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object(
                                  'provider',  'email',
                                  'providers', jsonb_build_array('email')
                                ),
       raw_user_meta_data  = coalesce(raw_user_meta_data, '{}'::jsonb),
       instance_id         = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
       is_anonymous        = coalesce(is_anonymous, false),
       banned_until        = case when banned_until > now() then null else banned_until end,
       updated_at          = now()
 where email in ('khalidjpal@gmail.com', 'marwa@teacherpal.local');


-- ---------------------------------------------------------------------------
-- STEP 3 · Ensure a matching auth.identities row exists per user with the
--          exact shape the dashboard uses. If missing → insert; if present
--          → rewrite identity_data so `sub` / `email` / `email_verified` /
--          `phone_verified` are all correct.
-- ---------------------------------------------------------------------------
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub',            u.id::text,
    'email',          u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  coalesce(u.last_sign_in_at, u.created_at, now()),
  coalesce(u.created_at, now()),
  now()
from auth.users u
where u.email in ('khalidjpal@gmail.com', 'marwa@teacherpal.local')
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  );

update auth.identities i
   set identity_data = jsonb_build_object(
         'sub',            i.user_id::text,
         'email',          u.email,
         'email_verified', true,
         'phone_verified', false
       ),
       updated_at    = now()
  from auth.users u
 where i.user_id = u.id
   and i.provider = 'email'
   and u.email in ('khalidjpal@gmail.com', 'marwa@teacherpal.local');


-- ---------------------------------------------------------------------------
-- STEP 4 · Reset both passwords using a known-good bcrypt hash produced by
--          pgcrypto. Replace the two placeholders below with real passwords
--          before running. Hashes stay in encrypted_password at rest.
--
--          If sign-in still fails after this + the identity fix, the last
--          remaining hypothesis is that this Supabase project's GoTrue is
--          configured with a hash pepper (`GOTRUE_HASH_SECRET_KEY`) that
--          pgcrypto doesn't apply. The fallback then is to set the password
--          from the Supabase dashboard: Authentication → Users → row →
--          three-dot menu → "Send password recovery" (or inline edit if
--          your dashboard build allows it).
-- ---------------------------------------------------------------------------
update auth.users
   set encrypted_password = extensions.crypt('123123', extensions.gen_salt('bf', 10)),
       updated_at         = now()
 where email = 'khalidjpal@gmail.com';

update auth.users
   set encrypted_password = extensions.crypt('123123', extensions.gen_salt('bf', 10)),
       updated_at         = now()
 where email = 'marwa@teacherpal.local';


-- ---------------------------------------------------------------------------
-- STEP 5 · Rewrite admin_create_user so every future user gets the same
--          repair-block treatment out of the gate. Two changes vs the prior
--          version:
--            • identity_data now includes `phone_verified: false` to match
--              exactly what the Supabase dashboard writes
--            • is_anonymous explicitly set to false (has a default, but no
--              harm being explicit — makes the row identical to a dashboard-
--              created user)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_user(text, text, text);

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

  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token,
    is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id, 'authenticated', 'authenticated',
    norm_email, extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(), now(),
    '', '', '', '',
    false
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    new_user_id::text, new_user_id,
    jsonb_build_object(
      'sub',            new_user_id::text,
      'email',          norm_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  );

  insert into public.profiles (user_id, username, email, is_admin)
  values (new_user_id, norm_username, norm_email, false);

  return new_user_id;
end;
$$;

revoke all on function public.admin_create_user(text, text, text) from public;
grant execute on function public.admin_create_user(text, text, text) to authenticated;

notify pgrst, 'reload schema';
