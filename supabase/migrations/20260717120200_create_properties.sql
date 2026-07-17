-- properties: the buildings work is organized under. All staff see and manage
-- all properties (single-operation instance — settled 2026-07-17); deletes are
-- landlord-only mistake cleanup and are blocked by RESTRICT FKs the moment
-- anything under the property has work-order history.
-- The assigned-vendor read arm is added in the work_orders migration.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  address_line1 text not null check (char_length(address_line1) between 1 and 200),
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.properties enable row level security;

create trigger properties_20_touch
  before update on public.properties
  for each row execute function public.set_updated_at();

create policy properties_select_staff on public.properties
  for select to authenticated
  using ((select public.is_staff()));

create policy properties_insert_staff on public.properties
  for insert to authenticated
  with check ((select public.is_staff()));

create policy properties_update_staff on public.properties
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy properties_delete_landlord on public.properties
  for delete to authenticated
  using ((select public.is_landlord()));

grant select, delete on public.properties to authenticated;
grant insert (name, address_line1, address_line2, city, state, postal_code)
  on public.properties to authenticated;
grant update (name, address_line1, address_line2, city, state, postal_code)
  on public.properties to authenticated;
grant all on public.properties to service_role;
