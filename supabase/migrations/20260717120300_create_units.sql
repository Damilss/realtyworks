-- units: subdivisions of a property. unique(property_id, label) also serves as
-- the FK index. Units don't move between properties via the API (no property_id
-- update grant) — delete and recreate instead.
-- The assigned-vendor read arm is added in the work_orders migration.

create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, label),
  -- Superkey for the composite FK from work_orders: lets a work order prove
  -- its unit actually belongs to its property.
  unique (id, property_id)
);

alter table public.units enable row level security;

create trigger units_20_touch
  before update on public.units
  for each row execute function public.set_updated_at();

create policy units_select_staff on public.units
  for select to authenticated
  using ((select public.is_staff()));

create policy units_insert_staff on public.units
  for insert to authenticated
  with check ((select public.is_staff()));

create policy units_update_staff on public.units
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy units_delete_landlord on public.units
  for delete to authenticated
  using ((select public.is_landlord()));

grant select, delete on public.units to authenticated;
grant insert (property_id, label) on public.units to authenticated;
grant update (label) on public.units to authenticated;
grant all on public.units to service_role;
