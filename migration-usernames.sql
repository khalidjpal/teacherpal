-- ============================================================================
-- migration-usernames.sql — username sign-in on top of Supabase email/password.
--
-- Supabase Auth still uses email + password underneath. This migration adds a
-- `profiles` table that maps a chosen username to the account's email so the
-- login page can look up the email from the username before it hits
-- /auth/v1/token. Anon can SELECT the table (that's what makes the lookup
-- work from an unauthenticated login page); nobody outside the Supabase
-- dashboard / service role can insert or update it.
--
-- Usernames are unique **case-insensitively** (via a `lower(username)` unique
-- index); anyone can log in with any casing.
--
-- Idempotent. Run after migration-auth.sql.
-- ============================================================================

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness on username.
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Anyone (anon + authenticated) can look up profiles to resolve
-- username → email at sign-in time. No insert/update/delete policies —
-- only the service role (Supabase dashboard SQL editor) can modify rows.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles public read'
  ) then
    create policy "profiles public read" on public.profiles
      for select to anon, authenticated using (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: Khalid's own username. Change 'khalid' if you want a different one.
-- ---------------------------------------------------------------------------
insert into public.profiles (user_id, username, email)
select id, 'khalid', email
from auth.users
where id = '3256e7f7-22a1-41f5-81a4-a410a9a290ad'
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
