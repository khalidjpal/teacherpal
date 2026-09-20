-- ============================================================================
-- migration-auth.sql — turn TeacherPal into a multi-user app.
--
-- Adds owner_id (uuid → auth.users.id) to every existing table, backfills
-- old rows to Khalid's user id, drops the "TEMP anon full access" policies
-- and replaces them with per-user policies (authenticated users can only
-- see/modify rows where owner_id = auth.uid()).
--
-- Also:
--   • room_layouts unique constraint moves from (key) to (key, owner_id) so
--     each teacher has their own "default" room (still one shared room *per
--     owner*, not per-period).
--   • schedule_overrides unique moves from (date) to (date, owner_id) so
--     each teacher owns their own override calendar.
--   • bathroom_log partial unique index becomes (student_id, quarter,
--     owner_id) so it stays scoped correctly.
--
-- **Idempotent.** Safe to re-run.
-- Run this in the Supabase SQL editor AFTER creating your account (so
-- auth.users has at least one row) and BEFORE deploying the new code.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The user id every existing row will be backfilled to.
-- (Khalid — from Supabase Authentication → Users.)
-- ---------------------------------------------------------------------------
do $$
declare
  backfill_owner constant uuid := '3256e7f7-22a1-41f5-81a4-a410a9a290ad';
begin
  -- Fail loudly if this user doesn't exist yet.
  if not exists (select 1 from auth.users where id = backfill_owner) then
    raise exception 'auth.users has no row for %. Create the account first.', backfill_owner;
  end if;

  -- -------------------------------------------------------------------------
  -- 0. Backfill columns that may be missing from tables created by an
  --    older version of the app (or when a follow-up migration was never
  --    run against this project). Keeping these here makes migration-auth.sql
  --    self-contained so we don't fail on a mismatch further down.
  --
  --    bathroom_log: tally columns from migration-lessons-bathroom.sql —
  --                  the partial unique index below reads `manual`.
  --    seating_rules: scope column from migration-rule-scopes.sql — not
  --                   referenced by this migration itself, but the client
  --                   requires it, so add it here too if missing.
  -- -------------------------------------------------------------------------
  alter table public.bathroom_log  add column if not exists manual  boolean not null default false;
  alter table public.bathroom_log  add column if not exists quarter text check (quarter in ('Q1', 'Q2', 'Q3', 'Q4'));
  alter table public.bathroom_log  add column if not exists count   integer not null default 1 check (count >= 0);

  alter table public.seating_rules add column if not exists scope   text not null default 'seating';
  begin
    alter table public.seating_rules add constraint seating_rules_scope_check check (scope in ('seating', 'grouping'));
  exception when duplicate_object then null;
  end;
  -- old uniqueness (period_id) becomes (period_id, scope)
  alter table public.seating_rules drop constraint if exists seating_rules_period_id_key;
  create unique index if not exists seating_rules_period_scope_idx on public.seating_rules (period_id, scope);

  -- -------------------------------------------------------------------------
  -- 1. Add owner_id to every table (nullable at first so we can backfill).
  -- -------------------------------------------------------------------------
  alter table public.periods            add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.students           add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.room_layouts       add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.seat_assignments   add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.seating_rules      add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.attendance         add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.lesson_plans       add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.bathroom_log       add column if not exists owner_id uuid references auth.users(id) on delete cascade;
  alter table public.schedule_overrides add column if not exists owner_id uuid references auth.users(id) on delete cascade;

  -- -------------------------------------------------------------------------
  -- 2. Backfill every existing row to the backfill owner.
  -- -------------------------------------------------------------------------
  update public.periods            set owner_id = backfill_owner where owner_id is null;
  update public.students           set owner_id = backfill_owner where owner_id is null;
  update public.room_layouts       set owner_id = backfill_owner where owner_id is null;
  update public.seat_assignments   set owner_id = backfill_owner where owner_id is null;
  update public.seating_rules      set owner_id = backfill_owner where owner_id is null;
  update public.attendance         set owner_id = backfill_owner where owner_id is null;
  update public.lesson_plans       set owner_id = backfill_owner where owner_id is null;
  update public.bathroom_log       set owner_id = backfill_owner where owner_id is null;
  update public.schedule_overrides set owner_id = backfill_owner where owner_id is null;

  -- -------------------------------------------------------------------------
  -- 3. Lock owner_id in: NOT NULL + default auth.uid() so every new INSERT
  --    from an authenticated session fills it automatically.
  -- -------------------------------------------------------------------------
  alter table public.periods            alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.students           alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.room_layouts       alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.seat_assignments   alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.seating_rules      alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.attendance         alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.lesson_plans       alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.bathroom_log       alter column owner_id set not null, alter column owner_id set default auth.uid();
  alter table public.schedule_overrides alter column owner_id set not null, alter column owner_id set default auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- 4. Helpful owner_id indexes (RLS reads filter by owner_id every request).
-- ---------------------------------------------------------------------------
create index if not exists periods_owner_idx            on public.periods(owner_id);
create index if not exists students_owner_idx           on public.students(owner_id);
create index if not exists room_layouts_owner_idx       on public.room_layouts(owner_id);
create index if not exists seat_assignments_owner_idx   on public.seat_assignments(owner_id);
create index if not exists seating_rules_owner_idx      on public.seating_rules(owner_id);
create index if not exists attendance_owner_idx         on public.attendance(owner_id);
create index if not exists lesson_plans_owner_idx       on public.lesson_plans(owner_id);
create index if not exists bathroom_log_owner_idx       on public.bathroom_log(owner_id);
create index if not exists schedule_overrides_owner_idx on public.schedule_overrides(owner_id);

-- ---------------------------------------------------------------------------
-- 5. Per-owner uniqueness fixes.
--    room_layouts: was UNIQUE (key). Now UNIQUE (key, owner_id) — each
--                  teacher has their own single "default" room.
--    schedule_overrides: was UNIQUE (date). Now UNIQUE (date, owner_id).
--    bathroom_log: partial UNIQUE (student_id, quarter) already implies an
--                  owner via students, but add owner_id defensively.
-- ---------------------------------------------------------------------------

-- room_layouts: drop the old constraint (name auto-generated) if present.
do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class      t on t.oid = c.conrelid
    join pg_namespace  n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'room_layouts' and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (key)'
  loop
    execute format('alter table public.room_layouts drop constraint %I', con.conname);
  end loop;
end $$;
create unique index if not exists room_layouts_key_owner_uidx on public.room_layouts (key, owner_id);

-- schedule_overrides: drop the old (date) unique if present.
do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class      t on t.oid = c.conrelid
    join pg_namespace  n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'schedule_overrides' and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (date)'
  loop
    execute format('alter table public.schedule_overrides drop constraint %I', con.conname);
  end loop;
end $$;
create unique index if not exists schedule_overrides_date_owner_uidx on public.schedule_overrides (date, owner_id);

-- bathroom_log: rebuild the partial unique index with owner_id.
drop index if exists public.bathroom_log_manual_uidx;
create unique index if not exists bathroom_log_manual_owner_uidx
  on public.bathroom_log (owner_id, student_id, quarter) where manual;

-- ---------------------------------------------------------------------------
-- 6. Drop every "TEMP anon full access" policy.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'periods','students','room_layouts','seat_assignments','seating_rules',
    'attendance','lesson_plans','bathroom_log','schedule_overrides'
  ] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'TEMP anon full access') then
      execute format('drop policy %I on public.%I', 'TEMP anon full access', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. New per-owner policies. Each table gets four policies (select / insert
--    / update / delete) for the `authenticated` role, all keyed to
--    owner_id = auth.uid(). No anon access to any of these tables.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array[
    'periods','students','room_layouts','seat_assignments','seating_rules',
    'attendance','lesson_plans','bathroom_log','schedule_overrides'
  ] loop
    -- SELECT
    policy_name := format('%s owner select', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    -- INSERT
    policy_name := format('%s owner insert', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    -- UPDATE
    policy_name := format('%s owner update', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
    -- DELETE
    policy_name := format('%s owner delete', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
        policy_name, t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Verify. These SELECTs should each return the expected row count under
--    Khalid's account (or 0 rows anonymously). Uncomment and run manually.
-- ---------------------------------------------------------------------------
-- select tablename, policyname, roles, cmd from pg_policies where schemaname='public' order by tablename, cmd;
-- select count(*) as periods_visible from public.periods;   -- 0 when signed out
