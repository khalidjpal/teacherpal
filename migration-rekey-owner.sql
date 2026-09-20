-- ============================================================================
-- migration-rekey-owner.sql — repoint owner_id from the deleted old UID to
-- the newly recreated user, and rebuild the profiles.khalid row.
--
-- Old UID: 3256e7f7-22a1-41f5-81a4-a410a9a290ad  (deleted in the dashboard)
-- New UID: e1bf27b3-00bf-49c6-b745-620a43598211
--
-- ⚠️  Deleting a row in auth.users fires ON DELETE CASCADE on every
--    teacher-owned table (owner_id → auth.users) and on public.profiles
--    (user_id → auth.users). Your data for the old UID was almost certainly
--    deleted at that moment. Run the count queries in the message that came
--    with this file *before* running this script so you know what survived.
--
-- Safe either way:
--   • Every UPDATE is a no-op when the row set is empty.
--   • The profiles fix DELETEs any stale 'khalid' row (case-insensitive) and
--     UPSERTs a fresh one for the new UID with the new email — works whether
--     the cascade took the row or not.
--   • Idempotent — re-running does nothing.
-- ============================================================================

do $$
declare
  old_uid constant uuid := '3256e7f7-22a1-41f5-81a4-a410a9a290ad';
  new_uid constant uuid := 'e1bf27b3-00bf-49c6-b745-620a43598211';
  new_email text;
begin
  if not exists (select 1 from auth.users where id = new_uid) then
    raise exception 'auth.users has no row for the new UID %. Recreate the user first.', new_uid;
  end if;
  select email into new_email from auth.users where id = new_uid;

  -- ---------------------------------------------------------------------
  -- 1. Repoint owner_id on every teacher-owned table.
  --    (No-op when the cascade already emptied them.)
  -- ---------------------------------------------------------------------
  update public.periods            set owner_id = new_uid where owner_id = old_uid;
  update public.students           set owner_id = new_uid where owner_id = old_uid;
  update public.room_layouts       set owner_id = new_uid where owner_id = old_uid;
  update public.seat_assignments   set owner_id = new_uid where owner_id = old_uid;
  update public.seating_rules      set owner_id = new_uid where owner_id = old_uid;
  update public.attendance         set owner_id = new_uid where owner_id = old_uid;
  update public.lesson_plans       set owner_id = new_uid where owner_id = old_uid;
  update public.bathroom_log       set owner_id = new_uid where owner_id = old_uid;
  update public.schedule_overrides set owner_id = new_uid where owner_id = old_uid;

  -- seating_charts is the retired grid table — update it too if it still
  -- exists in this project and has an owner_id column.
  if to_regclass('public.seating_charts') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'seating_charts'
                   and column_name = 'owner_id') then
    execute format(
      'update public.seating_charts set owner_id = %L where owner_id = %L',
      new_uid, old_uid
    );
  end if;

  -- ---------------------------------------------------------------------
  -- 2. Rebuild the profiles.khalid row on the new UID + current email.
  --    DELETE first (handles the case where the row still points at some
  --    other user_id — say a leftover from the old UID that skipped the
  --    cascade — since the (lower(username)) unique index would block an
  --    INSERT otherwise), then UPSERT on user_id (handles the case where
  --    someone already reran migration-usernames.sql after recreating the
  --    account and a new khalid row is already there).
  -- ---------------------------------------------------------------------
  delete from public.profiles where lower(username) = 'khalid' and user_id <> new_uid;

  insert into public.profiles (user_id, username, email)
  values (new_uid, 'khalid', new_email)
  on conflict (user_id) do update
    set username = excluded.username,
        email    = excluded.email;
end $$;

-- ---------------------------------------------------------------------------
-- Show the final state so you can eyeball it.
-- ---------------------------------------------------------------------------
select id::text as user_id, email from auth.users where id = 'e1bf27b3-00bf-49c6-b745-620a43598211';
select user_id::text, username, email from public.profiles;
