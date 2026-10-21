-- ============================================================================
-- Migration: courses — lesson plans move from periods to courses.
-- Run once in the Supabase SQL editor, AFTER migration-lesson-attachments.sql.
-- Safe to re-run.
--
--   courses          one row per course a teacher teaches ("English 9", "ERWC 11")
--   periods.course_id  the course a period belongs to (several periods can share one);
--                      null = a period on its own
--   lesson_plans / lesson_attachments now belong to EXACTLY ONE of
--     course_id   the plan every period of that course follows that day, or
--     period_id   a period's own plan — a "split" when the period has a course,
--                 the period's only plan when it has none
--
-- Attendance, seating, groups and bathroom are untouched: still per period.
--
-- Steps: 1 courses table · 2 periods.course_id · 3/4 plans + attachments get
-- course_id · 5 seed khalid + marwa · 6 fold existing per-period plans into
-- their course · check query.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. courses
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists courses_owner_name_uidx on public.courses (owner_id, lower(name));
create index if not exists courses_owner_idx on public.courses (owner_id);
alter table public.courses enable row level security;

do $$
declare
  t text := 'courses';
  policy_name text;
begin
  policy_name := format('%s owner select', t);
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', policy_name, t);
  end if;
  policy_name := format('%s owner insert', t);
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', policy_name, t);
  end if;
  policy_name := format('%s owner update', t);
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', policy_name, t);
  end if;
  policy_name := format('%s owner delete', t);
  if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=policy_name) then
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', policy_name, t);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. periods.course_id — deleting a course leaves its periods, just unassigned
-- ---------------------------------------------------------------------------
alter table public.periods add column if not exists course_id uuid references public.courses(id) on delete set null;
create index if not exists periods_course_idx on public.periods (course_id);

-- ---------------------------------------------------------------------------
-- 3. lesson_plans: course plans (course_id) or period plans (period_id)
--    UNIQUE (course_id, date) is the upsert target for course plans; the old
--    UNIQUE (period_id, date) still serves period plans. NULLs never clash,
--    so the two kinds never collide.
--    Deleting a course deletes its plans (Settings → Courses warns first).
-- ---------------------------------------------------------------------------
alter table public.lesson_plans add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.lesson_plans alter column period_id drop not null;
create index if not exists lesson_plans_course_idx on public.lesson_plans (course_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_plans_course_date_key') then
    alter table public.lesson_plans add constraint lesson_plans_course_date_key unique (course_id, date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lesson_plans_one_owner') then
    alter table public.lesson_plans add constraint lesson_plans_one_owner check (num_nonnulls(course_id, period_id) = 1);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. lesson_attachments: the same either/or
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.lesson_attachments') is null then
    raise exception 'Run migration-lesson-attachments.sql first, then this file.';
  end if;
end $$;
alter table public.lesson_attachments add column if not exists course_id uuid references public.courses(id) on delete cascade;
alter table public.lesson_attachments alter column period_id drop not null;
create index if not exists lesson_attachments_course_date_idx on public.lesson_attachments (course_id, date);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_attachments_one_owner') then
    alter table public.lesson_attachments add constraint lesson_attachments_one_owner check (num_nonnulls(course_id, period_id) = 1);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Seed the two accounts. Periods are matched by the bell number in their
--    name ("3rd Period - English 9", "Period 3"). Courses are only added if
--    missing, and a period is only assigned while it has no course yet, so a
--    re-run never undoes changes made later in Settings → Courses.
-- ---------------------------------------------------------------------------
do $$
declare
  seed jsonb := '[
    { "username": "khalid", "courses": [ { "name": "English 9",  "periods": [1, 2, 3] },
                                          { "name": "ERWC 11",    "periods": [5, 6] } ] },
    { "username": "marwa",  "courses": [ { "name": "English 12", "periods": [2] },
                                          { "name": "English 9",  "periods": [3, 4] },
                                          { "name": "ELD 12",     "periods": [5, 6] } ] }
  ]';
  acct jsonb;
  crs jsonb;
  uid uuid;
  cid uuid;
  i int;
begin
  for acct in select * from jsonb_array_elements(seed) loop
    select user_id into uid from public.profiles where username = acct->>'username';
    if uid is null then
      raise notice 'No profile "%": skipped', acct->>'username';
      continue;
    end if;
    i := 0;
    for crs in select * from jsonb_array_elements(acct->'courses') loop
      insert into public.courses (owner_id, name, sort_order)
      values (uid, crs->>'name', i)
      on conflict (owner_id, lower(name)) do nothing;
      select id into cid from public.courses where owner_id = uid and lower(name) = lower(crs->>'name');
      update public.periods p
         set course_id = cid
       where p.owner_id = uid
         and p.course_id is null
         and substring(p.name from '(\d+)')::int in (select (jsonb_array_elements_text(crs->'periods'))::int);
      i := i + 1;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Fold existing per-period plans into their course. For every (course,
--    day) that has period plans but no course plan yet:
--      * the plan of the earliest period that has any text becomes the
--        course plan, and that period's attachments go with it;
--      * the course's other periods with the SAME text that day are folded
--        in too (their attachments join the course's, duplicates dropped);
--      * periods whose text DIFFERS stay as their own plan — a split.
--    Attachments on a course period's day with no plan row of its own also
--    move up to the course. Nothing here deletes a storage object.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.plan_text(lp public.lesson_plans) returns text language sql immutable as $$
  select concat_ws(chr(31), btrim(lp.objective), btrim(lp.materials), btrim(lp.homework), btrim(lp.notes),
    (select string_agg(btrim(e->>'text') || '|' || coalesce(e->>'minutes', ''), chr(30) order by ord)
       from jsonb_array_elements(lp.agenda) with ordinality as x(e, ord)
      where btrim(coalesce(e->>'text', '')) <> ''))
$$;

do $$
declare
  r record;
  keep public.lesson_plans;
  keep_text text;
  dup record;
begin
  for r in
    select distinct p.course_id, lp.date
      from public.lesson_plans lp
      join public.periods p on p.id = lp.period_id
     where p.course_id is not null
       and not exists (select 1 from public.lesson_plans c where c.course_id = p.course_id and c.date = lp.date)
  loop
    select lp.* into keep
      from public.lesson_plans lp
      join public.periods p on p.id = lp.period_id
     where p.course_id = r.course_id and lp.date = r.date
     order by (pg_temp.plan_text(lp) = concat_ws(chr(31), '', '', '', '')),   -- plans with text first
              substring(p.name from '(\d+)')::int nulls last, p.sort_order, lp.updated_at desc
     limit 1;
    keep_text := pg_temp.plan_text(keep);

    update public.lesson_attachments
       set course_id = r.course_id, period_id = null
     where period_id = keep.period_id and date = r.date;
    update public.lesson_plans
       set course_id = r.course_id, period_id = null
     where id = keep.id;

    for dup in
      select lp.id, lp.period_id
        from public.lesson_plans lp
        join public.periods p on p.id = lp.period_id
       where p.course_id = r.course_id and lp.date = r.date
         and pg_temp.plan_text(lp) is not distinct from keep_text
    loop
      -- its attachments join the course's; exact duplicates (same file or URL) are dropped
      delete from public.lesson_attachments a
       where a.period_id = dup.period_id and a.date = r.date
         and exists (select 1 from public.lesson_attachments c
                      where c.course_id = r.course_id and c.date = r.date
                        and coalesce(c.storage_path, c.url) = coalesce(a.storage_path, a.url));
      update public.lesson_attachments
         set course_id = r.course_id, period_id = null
       where period_id = dup.period_id and date = r.date;
      delete from public.lesson_plans where id = dup.id;
    end loop;
  end loop;

  -- attachments on a course period's day that has no plan row of its own
  delete from public.lesson_attachments a
   using public.periods p
   where a.period_id = p.id and p.course_id is not null
     and not exists (select 1 from public.lesson_plans lp where lp.period_id = a.period_id and lp.date = a.date)
     and exists (select 1 from public.lesson_attachments c
                  where c.course_id = p.course_id and c.date = a.date
                    and coalesce(c.storage_path, c.url) = coalesce(a.storage_path, a.url));
  update public.lesson_attachments a
     set course_id = p.course_id, period_id = null
    from public.periods p
   where a.period_id = p.id and p.course_id is not null
     and not exists (select 1 from public.lesson_plans lp where lp.period_id = a.period_id and lp.date = a.date);
end $$;

notify pgrst, 'reload schema';

-- Check: every account's courses and the periods in each, plus plan counts.
select pr.username,
       c.name as course,
       string_agg(p.name, ' · ' order by p.sort_order) as periods,
       (select count(*) from public.lesson_plans lp where lp.course_id = c.id) as course_plans,
       (select count(*) from public.lesson_plans lp join public.periods pp on pp.id = lp.period_id where pp.course_id = c.id) as split_plans
  from public.courses c
  left join public.profiles pr on pr.user_id = c.owner_id
  left join public.periods p on p.course_id = c.id
 group by pr.username, c.id, c.name, c.sort_order
 order by pr.username, c.sort_order, c.name;
