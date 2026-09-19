-- ============================================================================
-- Migration: separate Seating rules from Grouping rules.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- seating_rules becomes one row per (period_id, scope):
--   scope        text  'seating' | 'grouping'
--   rules        jsonb [{ id, type, a, b?, hard }] — this scope's rules, in priority order
--   use_formula  boolean — this scope's "Formula on/off" toggle
--
-- Every existing row (which held one shared rule set) is copied into BOTH
-- scopes so nothing is lost; delete what you don't want from each side in
-- the app. The old use_formula_groups column becomes the grouping row's
-- use_formula and is then dropped.
-- ============================================================================

-- 1. scope column (existing rows are the seating copy)
alter table public.seating_rules
  add column if not exists scope text not null default 'seating';

alter table public.seating_rules
  drop constraint if exists seating_rules_scope_check;
alter table public.seating_rules
  add constraint seating_rules_scope_check check (scope in ('seating', 'grouping'));

-- 2. uniqueness is now (period_id, scope)
alter table public.seating_rules
  drop constraint if exists seating_rules_period_id_key;
create unique index if not exists seating_rules_period_scope_idx
  on public.seating_rules (period_id, scope);

-- 3. copy every seating row into a grouping row (once), dropping the
--    seating-only rule types and carrying the old grouping toggle across
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'seating_rules' and column_name = 'use_formula_groups'
  ) then
    insert into public.seating_rules (period_id, scope, rules, use_formula, updated_at)
    select
      s.period_id,
      'grouping',
      coalesce(
        (select jsonb_agg(r) from jsonb_array_elements(s.rules) r
          where r->>'type' not in ('front', 'back')),
        '[]'::jsonb),
      s.use_formula_groups,
      now()
    from public.seating_rules s
    where s.scope = 'seating'
      and not exists (
        select 1 from public.seating_rules g
        where g.period_id = s.period_id and g.scope = 'grouping'
      );

    alter table public.seating_rules drop column use_formula_groups;
  end if;
end $$;

-- 4. the TEMP anon policy already covers the table; nothing to add.

-- 5. tell PostgREST about the new shape
notify pgrst, 'reload schema';
