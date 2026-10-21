-- ============================================================================
-- Migration: lesson plan attachments — files and links on a (period, date).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- 1. public.lesson_attachments — one row per file or link
-- 2. the private Storage bucket "lesson-files" (50 MB per file)
-- 3. Storage policies: a signed-in teacher can read, upload and delete only
--    objects under their own folder  <auth.uid()>/…
--
-- Files live at  <owner uid>/<period id>/<date>/<random id>.<ext>  in the
-- bucket. The original file name is kept in lesson_attachments.name, so a
-- name with spaces, accents or emoji never has to be a storage key.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lesson_attachments
--   kind          'file' | 'link'
--   name          what the teacher sees (original file name, or the link's title)
--   storage_path  files only — the object key inside the lesson-files bucket
--   url           links only — http(s) URL (Google Slides, Docs, YouTube, …)
--   mime, size    files only — Content-Type and bytes, for the icon and the size column
--   sort_order    display order inside the plan
--
-- Attachments hang off (period_id, date), not off a lesson_plans row, so a
-- file can be dropped on a day before anything is typed into its plan.
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_attachments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id     uuid not null references public.periods(id) on delete cascade,
  date          date not null,
  kind          text not null check (kind in ('file', 'link')),
  name          text not null check (length(name) between 1 and 300),
  storage_path  text,
  url           text,
  mime          text,
  size          bigint check (size is null or size >= 0),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  -- a file has a storage key inside its owner's folder; a link has an http(s) URL
  constraint lesson_attachments_shape check (
    (kind = 'file' and storage_path is not null and url is null
       and split_part(storage_path, '/', 1) = owner_id::text)
    or
    (kind = 'link' and url ~* '^https?://' and storage_path is null)
  )
);
create index if not exists lesson_attachments_period_date_idx on public.lesson_attachments (period_id, date);
create index if not exists lesson_attachments_owner_idx       on public.lesson_attachments (owner_id);
create index if not exists lesson_attachments_date_idx        on public.lesson_attachments (date);

alter table public.lesson_attachments enable row level security;

do $$
declare
  t text := 'lesson_attachments';
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
-- 2. The bucket: private (no public URLs), 50 MB per file. Supabase's free
--    plan caps uploads at 50 MB anyway; raise both on a paid plan if needed.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('lesson-files', 'lesson-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- 3. Storage policies on storage.objects, for this bucket only. The first
--    folder of every key must be the caller's own uid, so a teacher can
--    neither read nor write anyone else's files — even with a guessed path.
--    anon gets nothing: there are no policies for it.
--    (select = download + signed URLs, insert = upload, delete = remove;
--     update is there for completeness — the app never overwrites a file.)
-- ---------------------------------------------------------------------------
do $$
declare
  ops text[] := array['select', 'insert', 'update', 'delete'];
  op text;
  policy_name text;
  own text := $own$bucket_id = 'lesson-files' and (storage.foldername(name))[1] = (select auth.uid())::text$own$;
begin
  foreach op in array ops loop
    policy_name := format('lesson-files owner %s', op);
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname=policy_name) then
      if op = 'insert' then
        execute format('create policy %I on storage.objects for insert to authenticated with check (%s)', policy_name, own);
      elsif op = 'update' then
        execute format('create policy %I on storage.objects for update to authenticated using (%s) with check (%s)', policy_name, own, own);
      else
        execute format('create policy %I on storage.objects for %s to authenticated using (%s)', policy_name, op, own);
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check: the bucket, its four policies and the table's four policies.
select 'bucket' as what, id as name, public::text as detail from storage.buckets where id = 'lesson-files'
union all
select 'storage policy', policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'lesson-files owner %'
union all
select 'table policy', policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'lesson_attachments'
order by 1, 2;
