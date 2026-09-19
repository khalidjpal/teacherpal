-- ============================================================================
-- Seed: Q1 bathroom-pass tallies from the paper tracker.
-- Run in the Supabase SQL editor. Safe to re-run (tallies are upserted).
--
-- What it does
--   1. Adds the manual-tally columns to bathroom_log if they are missing
--      (manual, quarter, count) — same as in schema.sql.
--   2. Matches every listed name to a student in that period (rules listed
--      at step 3: exact → first+last → shared surname → contained name →
--      unique surname), then falls back to the same student in ANOTHER
--      period when the list and the roster disagree.
--   3. Creates the three paper-tracker students if they are not on the
--      roster yet, then tallies them too.
--   4. Upserts one MANUAL Q1 row per student (count = used passes; no time
--      is recorded), and clears Q1 manual rows for anyone not listed, since
--      everyone else is at 0. Q2–Q4 are left at 0 (no rows).
--   5. The LAST result set is the report: any name that did not match, plus
--      what was created and how many tallies were written.
-- ============================================================================

-- ---- 1. columns (idempotent) ----------------------------------------------
alter table public.bathroom_log add column if not exists manual  boolean not null default false;
alter table public.bathroom_log add column if not exists quarter text check (quarter in ('Q1', 'Q2', 'Q3', 'Q4'));
alter table public.bathroom_log add column if not exists count   integer not null default 1 check (count >= 0);
create unique index if not exists bathroom_log_manual_uidx on public.bathroom_log (student_id, quarter) where manual;

-- ---- 2. the tallies ----------------------------------------------------------
drop table if exists seed; drop table if exists matches; drop table if exists created;
create temp table seed (period_key text, full_name text, q1 int, create_if_missing boolean default false);
insert into seed (period_key, full_name, q1) values
  -- PERIOD 1
  ('1st', 'Anthony Aceves Espejo', 1), ('1st', 'Blake Bartholomew', 3), ('1st', 'Obed Cortez Corazon', 1),
  ('1st', 'Iker Covarrubias', 3), ('1st', 'Dominic Galvan', 3), ('1st', 'Mateo Hernandez', 3), ('1st', 'Savannah Jackson', 1),
  ('1st', 'Josiah Karim', 1), ('1st', 'Dalvin Lopez', 3), ('1st', 'Raul Lupian Del Toro', 1), ('1st', 'Isabella Luque Sanchez', 2),
  ('1st', 'Desire Owens', 2), ('1st', 'Shahryar Parvez', 2), ('1st', 'Samantha Perez', 1),
  -- PERIOD 2
  ('2nd', 'Aaliyah Ali', 1), ('2nd', 'Christopher Cassidy', 3), ('2nd', 'Anderson Cerna Ponce', 3),
  ('2nd', 'Edilene Cisneros', 1), ('2nd', 'Aleena Ditta', 1), ('2nd', 'Reyiana Garrett', 2), ('2nd', 'Ashton Harris', 2),
  ('2nd', 'Orian Harris Oliva', 4), ('2nd', 'Anthony Leon Gallegos', 3), ('2nd', 'Shania Lewis', 2), ('2nd', 'Audrenah Mejia', 2),
  ('2nd', 'Mohammad Omar', 2), ('2nd', 'Xandria Ortega', 3), ('2nd', 'Andrew Sanders', 1), ('2nd', 'Freshta Shah', 1),
  ('2nd', 'Ahmad Hilal Shinwari', 3), ('2nd', 'Samarth Shyam', 1), ('2nd', 'Alexia Torres Espinoza', 1),
  -- PERIOD 3
  ('3rd', 'Natalia Chajon Mora', 3), ('3rd', 'Jasmine Cunningham', 3), ('3rd', 'Ezra Flores', 2),
  ('3rd', 'Pedro Huiltron', 3), ('3rd', 'Quetzalli Jauregui', 1), ('3rd', 'Jaycen Moore', 1), ('3rd', 'Ricardo Ruelas', 4),
  ('3rd', 'Darly Salinas Garcia', 2), ('3rd', 'Dominic Stubbles', 1), ('3rd', 'Isaac Valencia', 3), ('3rd', 'Monique Wiley', 1),
  -- PERIOD 5
  ('5th', 'Ealasha Buffin', 2), ('5th', 'Madelyn Cardoso', 1), ('5th', 'Justin Wil Cruz', 3),
  ('5th', 'Jeffrey Guardado', 4), ('5th', 'Joseph Martinez Padilla', 1), ('5th', 'Adelina Rosas', 4), ('5th', 'Jay Thomas', 2),
  -- PERIOD 6
  ('6th', 'Andres Alvarez Rodriguez', 1), ('6th', 'Anniya Chandra', 2), ('6th', 'Ella Crittenden', 1),
  ('6th', 'Christopher Jeronimo Murillo', 2), ('6th', 'Isabella Jessel', 2), ('6th', 'Maryam Khan Zada', 2),
  ('6th', 'Aaron Martin', 2), ('6th', 'Hector Mora Lopez', 1), ('6th', 'Alexandra Pacheco Diaz', 1),
  ('6th', 'Alynn Soukhaseum', 3), ('6th', 'Cesar Villalta Valle', 1), ('6th', 'Arianna Washington', 1);
-- paper tracker: create if missing
insert into seed (period_key, full_name, q1, create_if_missing) values
  ('1st', 'Daniel Umana', 1, true), ('1st', 'Jordan Romes', 1, true), ('2nd', 'Skyler Aranda', 4, true);

-- ---- helpers -----------------------------------------------------------------
-- "First  M. Last" → "first m last"
create or replace function pg_temp.norm(t text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(regexp_replace(coalesce(t, ''), '\.', '', 'g')), '\s+', ' ', 'g'))
$$;
create or replace function pg_temp.first_word(t text) returns text language sql immutable as $$ select split_part(pg_temp.norm(t), ' ', 1) $$;
create or replace function pg_temp.last_word(t text)  returns text language sql immutable as $$ select regexp_replace(pg_temp.norm(t), '^.* ', '') $$;

-- ---- 3. match -----------------------------------------------------------------
-- Rules, tried in order, each only when it picks exactly ONE student in the period:
--   1 exact normalised name            "Blake Bartholomew"          = "Blake Bartholomew"
--   2 first word + last word           "Justin Wil Cruz"            → "Justin Cruz"
--   3 first name + a shared surname    "Anthony Aceves Espejo"      → "Anthony Aceves"
--   4 the roster name is contained in  "Ahmad Hilal Shinwari"       → "Hilal Shinwari"
--     the listed name (word sequence)
--   5 surname only, when that surname  "Shahryar Parvez"            → "Shar Parvez"
--     belongs to exactly one student in the period (nicknames)
-- Then, for anything still unmatched, the same rules 1–2 across ALL periods
-- (the list and the roster disagree about which period a few students are in);
-- those are tallied where the roster has them and reported.
create temp table matches as
with s as (
  select seed.*, p.id as period_id, p.name as period_name
  from seed
  left join public.periods p on lower(p.name) like lower(seed.period_key) || ' period%'
),
cand as (
  select s.full_name, s.period_key, s.q1, s.create_if_missing, s.period_id, s.period_name,
         st.id as student_id, st.name as student_name,
         case when pg_temp.norm(st.name) = pg_temp.norm(s.full_name) then 1
              when pg_temp.first_word(st.name) = pg_temp.first_word(s.full_name)
               and pg_temp.last_word(st.name)  = pg_temp.last_word(s.full_name) then 2
              when pg_temp.first_word(st.name) = pg_temp.first_word(s.full_name)
               and (position(' ' || pg_temp.last_word(st.name) || ' ' in ' ' || pg_temp.norm(s.full_name) || ' ') > 0
                 or position(' ' || pg_temp.last_word(s.full_name) || ' ' in ' ' || pg_temp.norm(st.name) || ' ') > 0) then 3
              when position(' ' || pg_temp.norm(st.name) || ' ' in ' ' || pg_temp.norm(s.full_name) || ' ') > 0 then 4
              when pg_temp.last_word(st.name) = pg_temp.last_word(s.full_name)
               and (select count(*) from public.students o where o.period_id = s.period_id and pg_temp.last_word(o.name) = pg_temp.last_word(s.full_name)) = 1 then 5
         end as rank
  from s
  left join public.students st on st.period_id = s.period_id
),
best as (
  select full_name, period_key, min(rank) as rank
  from cand where rank is not null
  group by full_name, period_key
),
picked as (
  select c.full_name, c.period_key, c.student_id, c.student_name, c.rank,
         count(*) over (partition by c.full_name, c.period_key) as n_candidates
  from cand c
  join best b on b.full_name = c.full_name and b.period_key = c.period_key and b.rank = c.rank
)
select s.full_name, s.period_key, s.q1, s.create_if_missing, s.period_id, s.period_name,
       case when p.n_candidates = 1 then p.student_id end as student_id,
       case when p.n_candidates = 1 then p.student_name end as student_name,
       case
         when s.period_id is null  then 'PERIOD NOT FOUND'
         when p.student_id is null then 'NOT MATCHED'
         when p.n_candidates > 1   then 'AMBIGUOUS (' || p.n_candidates || ' students fit)'
         when p.rank = 1           then 'exact'
         when p.rank = 2           then 'matched by first + last name → ' || p.student_name
         when p.rank = 3           then 'matched by first name + shared surname → ' || p.student_name
         when p.rank = 4           then 'roster name is part of the listed name → ' || p.student_name
         else                           'matched by surname only (unique in period) → ' || p.student_name
       end as status
from (select distinct full_name, period_key, q1, create_if_missing, period_id, period_name from s) s
left join (select distinct full_name, period_key, student_id, student_name, rank, n_candidates from picked) p
  on p.full_name = s.full_name and p.period_key = s.period_key;

-- cross-period fallback (rules 1–2 only, must be unique across the whole roster)
with xp as (
  select m.full_name, m.period_key, st.id as student_id, st.name as student_name, st.period_id, p.name as period_name,
         count(*) over (partition by m.full_name, m.period_key) as n
  from matches m
  join public.students st
    on pg_temp.norm(st.name) = pg_temp.norm(m.full_name)
    or (pg_temp.first_word(st.name) = pg_temp.first_word(m.full_name) and pg_temp.last_word(st.name) = pg_temp.last_word(m.full_name))
  join public.periods p on p.id = st.period_id
  where m.student_id is null and m.status = 'NOT MATCHED'
)
update matches m
set student_id = xp.student_id, student_name = xp.student_name, period_id = xp.period_id, period_name = xp.period_name,
    status = 'FOUND IN ' || upper(xp.period_name) || ' (listed under ' || m.period_key || ') → ' || xp.student_name
from xp
where xp.n = 1 and xp.full_name = m.full_name and xp.period_key = m.period_key;

-- ---- 4a. create the paper-tracker students that are missing -----------------
create temp table created (full_name text, period_name text, student_id uuid);
with missing as (
  select m.full_name, m.period_id, m.period_name
  from matches m
  where m.create_if_missing and m.student_id is null and m.period_id is not null
),
ins as (
  insert into public.students (period_id, name, sort_order)
  select mi.period_id, mi.full_name,
         coalesce((select max(sort_order) from public.students st where st.period_id = mi.period_id), 0) + 1
  from missing mi
  returning id, period_id, name
)
insert into created (full_name, period_name, student_id)
select ins.name, mi.period_name, ins.id from ins join missing mi on mi.period_id = ins.period_id and mi.full_name = ins.name;

update matches m
set student_id = c.student_id, student_name = c.full_name, status = 'CREATED on roster, then tallied'
from created c
where m.student_id is null and m.full_name = c.full_name and m.period_name = c.period_name;

-- ---- 4b. write the Q1 manual tallies -------------------------------------------
-- manual rows carry no time: out_at = in_at, quarter = 'Q1', count = passes used
insert into public.bathroom_log (period_id, student_id, date, out_at, in_at, manual, quarter, count)
select period_id, student_id, current_date, now(), now(), true, 'Q1', q1
from matches
where student_id is not null
on conflict (student_id, quarter) where manual
do update set count = excluded.count, period_id = excluded.period_id;

-- everyone not listed is at 0 for Q1
delete from public.bathroom_log
where manual and quarter = 'Q1'
  and student_id not in (select student_id from matches where student_id is not null);

-- let PostgREST see the new columns immediately (otherwise the app can't read them until its cache refreshes)
notify pgrst, 'reload schema';

-- ---- 5. report (the last result set is what the SQL editor shows) ----------
select 'FIX BY HAND' as result, period_key as period, full_name as name, q1 as passes, status
from matches where student_id is null
union all
select 'created', period_key, full_name, q1, status from matches where status like 'CREATED%'
union all
select 'moved period', period_key, full_name, q1, status from matches where status like 'FOUND IN%'
union all
select 'fuzzy match', period_key, full_name, q1, status from matches where status like 'matched by%' or status like 'roster name%'
union all
select 'summary', '', (select count(*) from matches where student_id is not null) || ' tallies written, '
                      || (select count(*) from matches where student_id is null) || ' unmatched', null, ''
order by 1, 2, 3;
