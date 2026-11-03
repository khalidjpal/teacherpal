-- ============================================================================
-- migration-farmer.sql — the thanksgiving Name Wheel's farmer, per teacher.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
--   1. profiles.farmer jsonb: how the teacher's farmer looks (null = the
--      default farmer). Shape, written by farmer.js:
--        { skin, face, figure, hairStyle, hair, head, headColor, shirt, sleeves, over, pants, lashes }
--      skin / hair / headColor / shirt / pants are '#RRGGBB' from a short
--      list; face classic|soft; figure straight|curvy; hairStyle wavy|straight|curly|buzz|tied|hijab (wavy = the
--      middle part; a hijab's colour is headColor); head none|cap|beanie;
--      sleeves short|long; over none|overalls (farm clothes over the
--      shirt, in the trousers' colour); lashes true|false. (Older looks with crop / long /
--      bun or head = hijab are still read: farmer.js maps them.) The app ignores anything it
--      doesn't know, key by key, so the check only bounds the size.
--   2. set_my_farmer(jsonb): the only way to write it, own row only
--      (profiles has no client update policy).
--   3. marwa's farmer starts as a woman in a grey hijab (fair skin, the soft
--      face, a curvy figure, a white long-sleeve top under denim overalls), and khalid's with short wavy
--      hair in a middle part.
-- ============================================================================

alter table public.profiles add column if not exists farmer jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_farmer_shape') then
    alter table public.profiles add constraint profiles_farmer_shape check (
      farmer is null or (jsonb_typeof(farmer) = 'object' and length(farmer::text) <= 1000)
    );
  end if;
end $$;

create or replace function public.set_my_farmer(p_farmer jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_farmer is not null and (jsonb_typeof(p_farmer) <> 'object' or length(p_farmer::text) > 1000) then
    raise exception 'farmer must be a small object';
  end if;
  update public.profiles set farmer = p_farmer where user_id = auth.uid();
end $$;
revoke all on function public.set_my_farmer(jsonb) from public;
grant execute on function public.set_my_farmer(jsonb) to authenticated;

-- marwa: a grey hijab, unless she has already picked something else (the
-- earlier seeds, none of which had a face, are replaced)
update public.profiles
   set farmer = '{"skin": "#F1C9A5", "face": "soft", "figure": "curvy", "hairStyle": "hijab", "hair": "#1E1512", "head": "none", "headColor": "#97928B",
                  "shirt": "#F4F1EA", "sleeves": "long", "over": "overalls", "pants": "#3A5784", "lashes": true}'::jsonb
 where lower(username) = 'marwa'
   and (farmer is null or farmer->>'head' = 'hijab'
        or (farmer->>'hairStyle' = 'hijab' and farmer->>'face' is null));

-- khalid: the wavy middle part (keeps any other choices already made)
update public.profiles
   set farmer = coalesce(farmer, '{}'::jsonb) || '{"hairStyle": "wavy", "head": "none"}'::jsonb
 where lower(username) = 'khalid';

notify pgrst, 'reload schema';

-- Check: who has a farmer of their own.
-- (If marwa or khalid isn't listed with a look, their username differs:
-- run the two updates above with the right one.)
select username, display_name, coalesce(farmer->>'hairStyle', '(default farmer)') as hair, farmer
  from public.profiles
 order by username;
