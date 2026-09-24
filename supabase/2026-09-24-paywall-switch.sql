-- ============================================================================
-- Paywall switch — run this ONCE in the Supabase SQL editor on the LIVE
-- project. Adds a global app_settings flag that lets admins turn the paywall
-- off (free access for everyone) and back on from the /admin page.
--
-- Seeded with paywall_enabled = false → free access is active immediately.
-- Paid status lives on profiles and is never wiped, so members who paid keep
-- their access when the paywall is re-enabled.
-- ============================================================================

create table if not exists public.app_settings (
  key         text        primary key,
  bool_value  boolean     not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id)
);

insert into public.app_settings (key, bool_value)
values ('paywall_enabled', false)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- is_admin() already exists from the base schema; recreate defensively.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

grant select on public.app_settings to anon, authenticated;
grant update on public.app_settings to authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (true);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update using (public.is_admin()) with check (public.is_admin());
