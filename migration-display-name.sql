-- ============================================================================
-- migration-display-name.sql — how a teacher is addressed in the app.
--
-- Adds:
--   • profiles.display_name text  (how the teacher is addressed in the UI —
--     today the top-bar USER chip). Nullable — when it is empty the client
--     falls back to profiles.username, then the email's local part.
--
-- Seeds:
--   khalid → 'Mr. Pal'
--   marwa  → 'Ms. Mohammadi'
--
-- Read-only from the client (the app never writes it; set names here).
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name text;

-- ---------------------------------------------------------------------------
-- 2. Seed the two known accounts. Matches on username first (how the other
--    profile migrations key these rows); the email fallback covers a row
--    whose username was never filled in — username is nullable now that
--    sign-in is plain email + password.
-- ---------------------------------------------------------------------------
update public.profiles
   set display_name = 'Mr. Pal'
 where lower(username) = 'khalid'
    or lower(email) like 'khalid%';

update public.profiles
   set display_name = 'Ms. Mohammadi'
 where lower(username) = 'marwa'
    or lower(email) like 'marwa%';

-- Check what landed (both rows should show a display_name):
--   select user_id, email, username, display_name from public.profiles order by email;

notify pgrst, 'reload schema';
