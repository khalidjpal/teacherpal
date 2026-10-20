-- ============================================================================
-- Migration: every seating arrangement owns its desk layout.
-- Run once in the Supabase SQL editor (after migration-seating-arrangements.sql).
-- Safe to re-run: it never overwrites a layout you have edited since.
--
-- Before: one shared room per teacher (room_layouts) held the desks; an
-- arrangement held its seats, and the ACTIVE arrangement was always shown
-- on the shared room.
-- After:  seating_arrangements.layout is the arrangement's own desks. The
-- active arrangement's layout + assignments are what Attendance shows for
-- that period; drafts affect nothing. Each period has its own set.
--
-- What this does, per teacher:
--   1. Active arrangements take the room they were really shown on (the
--      shared room), unless they were saved after the room — i.e. edited
--      under the new model already.
--   2. Any arrangement with no stored layout takes the shared room.
--   3. Every period that has no arrangement yet gets an active
--      "Seating chart" on the shared room (with that period's old
--      seat_assignments row, if there is one), so no period loses its room.
-- Drafts that already carry their own desks are left exactly as they are.
--
-- room_layouts and seat_assignments stay in place, untouched by the app
-- (read only as a fallback for a layout-less row). See the optional drops
-- at the bottom once you're happy.
-- ============================================================================

-- 0. Give every shared room a timestamp, so step 1 has something to compare.
update public.room_layouts
   set updated_at = now()
 where updated_at is null;

-- 1. Active arrangements: the shared room was their real desks.
update public.seating_arrangements x
   set layout = rl.layout,
       updated_at = now()
  from public.room_layouts rl
 where rl.owner_id = x.owner_id
   and rl.key = 'default'
   and x.is_active
   and (x.layout is null or x.updated_at <= rl.updated_at)
   and x.layout is distinct from rl.layout;

-- 2. Any arrangement with no desks stored: the shared room.
update public.seating_arrangements x
   set layout = rl.layout
  from public.room_layouts rl
 where rl.owner_id = x.owner_id
   and rl.key = 'default'
   and x.layout is null;

-- 3. Periods with no arrangement at all: an active one on the shared room.
insert into public.seating_arrangements
  (owner_id, period_id, name, assignments, layout, is_active, created_at, updated_at)
select
  p.owner_id,
  p.id,
  'Seating chart',
  coalesce(sa.assignments, '{}'::jsonb),
  rl.layout,
  true,
  now(),
  now()
from public.periods p
join public.room_layouts rl
  on rl.owner_id = p.owner_id and rl.key = 'default'
left join public.seat_assignments sa
  on sa.period_id = p.id
where not exists (
  select 1 from public.seating_arrangements x where x.period_id = p.id
);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Check: one row per arrangement — every one should have desks now.
-- ---------------------------------------------------------------------------
select p.name as period,
       x.name as arrangement,
       x.is_active,
       jsonb_array_length(coalesce(x.layout -> 'pieces', '[]'::jsonb)) as desks,
       (select count(*) from jsonb_object_keys(x.assignments)) as seated
  from public.seating_arrangements x
  join public.periods p on p.id = x.period_id
 order by p.sort_order, p.name, x.is_active desc, x.created_at;

-- ---------------------------------------------------------------------------
-- OPTIONAL, later: once every period looks right in the app, the shared
-- room and the old per-period seats are no longer needed.
-- ---------------------------------------------------------------------------
-- drop table if exists public.room_layouts;
-- drop table if exists public.seat_assignments;
