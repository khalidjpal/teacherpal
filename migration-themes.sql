-- ============================================================================
-- migration-themes.sql — per-user visual themes.
--
-- Adds:
--   • profiles.theme text (default 'jarvis')
--   • public.set_my_theme(text) RPC — a user updates their own theme only
--
-- The RPC pattern avoids needing per-column RLS. authenticated users can't
-- UPDATE the profiles table directly (there is no update policy) but can
-- call this SECURITY DEFINER function, which only ever touches its own
-- caller's row and only ever touches the `theme` column. No way to
-- promote yourself to admin or change your email through this.
--
-- The theme name is otherwise open — the client is the authority on which
-- theme ids exist. An unknown id just falls back to the default styling
-- (no CSS `:root[data-theme="…"]` block matches), which is harmless.
--
-- Idempotent. Run after migration-admin.sql.
-- ============================================================================

alter table public.profiles
  add column if not exists theme text not null default 'jarvis';

create or replace function public.set_my_theme(p_theme text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Cheap validation to prevent junk (typos, injection attempts via long
  -- strings). Real theme names are short kebab/snake-case ids.
  if p_theme is null or length(p_theme) > 40 or p_theme !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid theme name' using errcode = '22023';
  end if;

  update public.profiles
     set theme = p_theme
   where user_id = auth.uid();
end;
$$;

revoke all on function public.set_my_theme(text) from public;
grant execute on function public.set_my_theme(text) to authenticated;

notify pgrst, 'reload schema';
