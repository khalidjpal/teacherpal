-- ============================================================================
-- Migration: the games' Leaderboard — running standings per period, fed by
-- Family Feud and Jeopardy. Run once in the Supabase SQL editor. Safe to re-run.
--
-- New tables:
--   game_results                (one row per game ended with teams from a roster)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete): the class it was played with
--     game        text        'feud' | 'quiz'
--     set_id      text        the question set / board it was played on (no FK:
--                             sets get deleted, the history stays; may be 'starter' / 'sample')
--     set_name    text        its name when it was played
--     teams       jsonb       [{ name, score, won,
--                                members: [{ id, name, points }] }]  (2–4 teams)
--                             points = what each student earned from this game,
--                             worked out when it ended (so later changes to the
--                             settings never rewrite old games)
--     counts      boolean     counts toward the standings (off = "just for fun")
--     cleared_at  timestamptz set by Reset: the game stays in the history but no
--                             longer counts
--     played_at   timestamptz when it ended
--
--   leaderboard_adjustments     (hand corrections to a student's points)
--     id          uuid        primary key
--     owner_id    uuid        -> auth.users.id (cascade delete)
--     period_id   uuid        -> periods.id (cascade delete)
--     student_id  uuid        -> students.id (cascade delete)
--     points      integer     + or −, never 0
--     note        text        optional, up to 120 chars
--     cleared_at  timestamptz set by Reset
--     created_at  timestamptz
--
--   leaderboard_settings        (one row per teacher)
--     owner_id      uuid      primary key -> auth.users.id (cascade delete)
--     winner_mode   text      'score' (each winner gets the team's final score)
--                             | 'fixed' (each winner gets winner_points)
--     winner_points integer   used when winner_mode = 'fixed'
--     loser_points  integer   what each player on the other teams gets
--     updated_at    timestamptz
--
-- Standings = the sum, per student, of their points in every game that counts
-- and isn't cleared, plus their uncleared adjustments. Worked out in the
-- browser; nothing stores a total.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  game        text not null check (game in ('feud', 'quiz')),
  set_id      text,
  set_name    text check (set_name is null or length(set_name) <= 120),
  teams       jsonb not null default '[]'::jsonb
                check (jsonb_typeof(teams) = 'array' and jsonb_array_length(teams) between 2 and 4
                       and pg_column_size(teams) <= 60000),
  counts      boolean not null default true,
  cleared_at  timestamptz,
  played_at   timestamptz not null default now()
);
create index if not exists game_results_owner_idx  on public.game_results (owner_id);
create index if not exists game_results_period_idx on public.game_results (period_id, played_at desc);

create table if not exists public.leaderboard_adjustments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id   uuid not null references public.periods(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  points      integer not null check (points <> 0 and points between -100000 and 100000),
  note        text check (note is null or length(note) <= 120),
  cleared_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists leaderboard_adjustments_owner_idx  on public.leaderboard_adjustments (owner_id);
create index if not exists leaderboard_adjustments_period_idx on public.leaderboard_adjustments (period_id);

create table if not exists public.leaderboard_settings (
  owner_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  winner_mode   text not null default 'score' check (winner_mode in ('score', 'fixed')),
  winner_points integer not null default 100 check (winner_points between 0 and 100000),
  loser_points  integer not null default 10 check (loser_points between 0 and 100000),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security — the standard four per-owner policies on each
-- ---------------------------------------------------------------------------
alter table public.game_results            enable row level security;
alter table public.leaderboard_adjustments enable row level security;
alter table public.leaderboard_settings    enable row level security;

do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array['game_results', 'leaderboard_adjustments', 'leaderboard_settings'] loop
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
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. Check: RLS on and four policies each
-- ---------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('game_results', 'leaderboard_adjustments', 'leaderboard_settings')
order by c.relname;
