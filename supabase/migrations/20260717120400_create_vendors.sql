-- vendors: contact rows, optionally linked to a real auth user on invite
-- (docs/vendor-access.md — contact-first, auth-on-invite). profile_id is
-- written only by the Phase 3 invite server action (service role): no client
-- grant, so the auth link can't be forged or moved from the API.

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  phone text,
  email text,
  profile_id uuid references public.profiles (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At least one *usable* contact method (docs/vendor-access.md: phone-OR-email
  -- required, both individually nullable). nullif(trim(...), '') collapses ''
  -- and whitespace-only to NULL, so a form posting empty strings can't create a
  -- vendor with no reachable contact — a plain `is not null` check let '' pass.
  constraint vendors_contact_method check (
    nullif(trim(phone), '') is not null or nullif(trim(email), '') is not null
  )
);

-- Load-bearing: one vendor row per auth user, or current_vendor_id() below
-- would silently pick one of several. Partial: many rows may be unlinked.
create unique index vendors_profile_id_key on public.vendors (profile_id)
  where profile_id is not null;

alter table public.vendors enable row level security;

create trigger vendors_20_touch
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- The caller's vendors.id, or null. Definer for the same no-recursion reason as
-- the role helpers; revocation is live — unlink profile_id (or delete the row)
-- and the very next request resolves null, killing vendor access mid-session.
create function public.current_vendor_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.vendors where profile_id = (select auth.uid());
$$;

revoke execute on function public.current_vendor_id() from public, anon;
grant execute on function public.current_vendor_id() to authenticated, service_role;

create policy vendors_select_staff_or_self on public.vendors
  for select to authenticated
  using ((select public.is_staff()) or profile_id = (select auth.uid()));

create policy vendors_insert_staff on public.vendors
  for insert to authenticated
  with check ((select public.is_staff()));

create policy vendors_update_staff on public.vendors
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy vendors_delete_landlord on public.vendors
  for delete to authenticated
  using ((select public.is_landlord()));

grant select, delete on public.vendors to authenticated;
grant insert (name, phone, email) on public.vendors to authenticated;
grant update (name, phone, email) on public.vendors to authenticated;
grant all on public.vendors to service_role;

-- Staff-name resolution for linked vendors (the Phase 3 activity trail must
-- show who did what) WITHOUT handing vendors whole profiles rows — a SELECT
-- policy on profiles would expose every column (phone etc.), and RLS can't
-- pick columns. This view is postgres-owned, so it reads past profiles RLS by
-- design (do NOT set security_invoker) and returns ONLY id + full_name, to
-- staff and linked vendors. Lives here because it needs current_vendor_id().
create view public.staff_directory as
  select id, full_name
  from public.profiles
  where role in ('landlord', 'manager')
    and ((select public.is_staff()) or (select public.current_vendor_id()) is not null);

grant select on public.staff_directory to authenticated, service_role;
