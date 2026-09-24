-- ============================================================================
-- OctoOdds — complete database schema (single consolidated setup).
--
-- Run this ONCE in the SQL editor of a fresh Supabase project. It creates
-- everything the app needs from nothing:
--
--   * profiles  — one row per auth user, holds role + paid subscription state
--   * bets      — saved cover-bet plans, one owner each
--   * the trigger that creates a profile automatically on sign-up
--   * the guard that stops users unlocking themselves
--   * row-level security so every user only sees their own data
--
-- It replaces the older incremental migrations (bets columns, quad-name repair,
-- paid access) — those were folded in here.
--
-- Idempotent: safe to re-run, and safe against a database that already has some
-- of these objects (e.g. one shared with the Android app), because every step
-- is "if not exists" / "create or replace" / "drop … if exists" first.
--
-- After running this, point the app at the new project by setting
-- VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (and the server-side ODDS_API_KEY)
-- to the new values.
-- ============================================================================

-- gen_random_uuid() for bet ids. Present on Supabase already; harmless to ask.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles ---
-- id matches the auth.users id 1:1. Deleting the auth user removes the profile.
create table if not exists public.profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text,
  full_name                text,
  -- 'user' pays to use the app; 'admin' manages everyone; 'superuser' is free
  -- but not an admin.
  role                     text        not null default 'user',
  -- Legacy approval fields from the old "admin approves a payment proof" flow.
  -- No longer used for access, but kept so a shared Android app keeps working.
  status                   text        not null default 'pending',
  payment_proof_url        text,
  -- The manual paid switch. Flip to true (in the table editor or on /admin) to
  -- unlock a paying user.
  is_paid                  boolean     not null default false,
  subscription_plan        text,                              -- monthly | biannual | annual
  subscription_started_at  timestamptz,
  subscription_expires_at  timestamptz,                       -- access ends here; null = indefinite
  created_at               timestamptz not null default now()
);

-- Converge an older profiles table that predates the subscription columns.
alter table public.profiles
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'pending',
  add column if not exists payment_proof_url text,
  add column if not exists is_paid boolean not null default false,
  add column if not exists subscription_plan text,
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_expires_at timestamptz;

-- Value constraints (re-created so re-runs and older tables converge).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin', 'superuser'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('pending', 'approved', 'rejected'));

alter table public.profiles drop constraint if exists profiles_subscription_plan_check;
alter table public.profiles
  add constraint profiles_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('monthly', 'biannual', 'annual'));

-- -------------------------------------------------------------------- bets ---
-- rows / team_names / outcome_odds / games are stored as JSON so the exact
-- scenario grid a bet was saved with can be restored verbatim.
create table if not exists public.bets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  title         text,
  team_count    integer     not null default 1,
  tax           numeric     not null default 0,
  target_stake  numeric     not null default 0,
  rows          jsonb       not null default '[]'::jsonb,   -- [{ name, stake, odds, excluded? }]
  team_names    jsonb       not null default '[]'::jsonb,   -- ["Team A", "Team B", ...]
  outcome_odds  jsonb,                                       -- [{ W, D, L }] per event, nullable
  games         jsonb,                                       -- [{ home, away, league? }], nullable
  won_scenario  text,                                        -- winning row name once settled
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- Converge an older bets table that predates the odds/games columns.
alter table public.bets
  add column if not exists outcome_odds jsonb,
  add column if not exists games jsonb;

create index if not exists bets_user_id_idx on public.bets (user_id);

-- ------------------------------------------------------------ app_settings ---
-- Key/value feature flags readable by anyone (they shape the public UI), but
-- only admins may change them. `paywall_enabled = false` means free-access
-- mode: every signed-in user passes the paywall until it is turned back on.
-- Paid status is stored on each profile and is never touched by this switch,
-- so members who paid keep their access when the paywall returns.
create table if not exists public.app_settings (
  key         text        primary key,
  bool_value  boolean     not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users (id)
);

insert into public.app_settings (key, bool_value)
values ('paywall_enabled', false)
on conflict (key) do nothing;

-- ----------------------------------------------------------------- helpers ---
-- Is the caller an admin? SECURITY DEFINER so it reads profiles without RLS,
-- which both lets it work inside a profiles policy and avoids recursion.
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

-- --------------------------------------------------- create profile on signup ---
-- Every new auth user gets a profile row, seeded with their email and the
-- full_name they registered with. Defaults make them an unpaid 'user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------ guard privileged profile fields ---
-- There is a self-update policy on profiles (users set their own
-- subscription_plan when picking a plan), so without this guard a user could
-- PATCH is_paid or their own role straight to the API. Admins may still change
-- these fields, and direct database access (SQL editor / service role, where
-- auth.uid() is null) is always allowed so the manual switch keeps working.
create or replace function public.profiles_guard_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  -- No JWT => SQL editor or service_role. Trusted; let it through.
  if auth.uid() is null then
    return new;
  end if;

  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'admin' then
    if new.is_paid is distinct from old.is_paid
      or new.role is distinct from old.role
      or new.subscription_started_at is distinct from old.subscription_started_at
      or new.subscription_expires_at is distinct from old.subscription_expires_at
    then
      raise exception 'Only an admin can change subscription or role fields';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_fields on public.profiles;
create trigger profiles_guard_privileged_fields
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_fields();

-- --------------------------------------------------------------------- RLS ---
alter table public.profiles     enable row level security;
alter table public.bets         enable row level security;
alter table public.app_settings enable row level security;

-- Everything here is behind sign-in; grant CRUD to authenticated and let RLS
-- narrow it to the caller's own rows. anon gets nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.bets     to authenticated;
grant execute on function public.is_admin() to authenticated;
-- Settings are world-readable (the paywall state is visible in the UI anyway);
-- writes are gated to admins by RLS.
grant select on public.app_settings to anon, authenticated;
grant update on public.app_settings to authenticated;

-- profiles: read/update your own row; admins may read and update everyone.
-- (Inserts happen through the signup trigger, so no insert policy is needed.)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- bets: an owner has full control over their own bets, and sees no one else's.
drop policy if exists bets_select on public.bets;
create policy bets_select on public.bets
  for select using (user_id = auth.uid());

drop policy if exists bets_insert on public.bets;
create policy bets_insert on public.bets
  for insert with check (user_id = auth.uid());

drop policy if exists bets_update on public.bets;
create policy bets_update on public.bets
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists bets_delete on public.bets;
create policy bets_delete on public.bets
  for delete using (user_id = auth.uid());

-- app_settings: everyone reads; only admins write.
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (true);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------- make an admin ---
-- After you have signed up once, promote yourself by running (with your email):
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- Grant a paying user access manually with, e.g.:
--   update public.profiles
--     set is_paid = true,
--         subscription_plan = 'annual',
--         subscription_started_at = now(),
--         subscription_expires_at = now() + interval '12 months'
--   where email = 'member@example.com';
