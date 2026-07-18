-- work_orders: the core business object.
--
-- Enforcement split (docs/schema/schema-brainstorming.md §4): RLS picks rows;
-- uniform column rules are grants (status/vendor_id excluded from INSERT so
-- every order starts 'open' and assignment is an audited UPDATE; created_by/
-- timestamps have no write grant at all); the role-dependent rule — vendors
-- may change ONLY status — is the fail-closed guard trigger below, because
-- landlord/manager/vendor all share the `authenticated` Postgres role.
--
-- FKs RESTRICT: a property/unit/vendor with work-order history can't be
-- hard-deleted — history outlives offboarding. cost_cents is the manually
-- entered job total for MVP cost summaries — deliberately not a ledger (no
-- line items, no currency, no approval fields; that's Phase 6).

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete restrict,
  unit_id uuid,
  vendor_id uuid references public.vendors (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  status public.work_order_status not null default 'open',
  priority public.work_order_priority not null default 'medium',
  due_date date,
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_assigned_has_vendor
    check (status <> 'assigned' or vendor_id is not null),
  -- Composite FK: a non-null unit must belong to THIS work order's property
  -- (a bare units(id) FK would only prove the unit exists somewhere). NULL
  -- unit_id passes (MATCH SIMPLE), so property-level work orders are fine.
  constraint work_orders_unit_in_property
    foreign key (unit_id, property_id)
    references public.units (id, property_id) on delete restrict
);

create index work_orders_property_id_idx on public.work_orders (property_id);
create index work_orders_unit_id_idx on public.work_orders (unit_id)
  where unit_id is not null;
create index work_orders_vendor_id_idx on public.work_orders (vendor_id)
  where vendor_id is not null;
create index work_orders_status_idx on public.work_orders (status);

alter table public.work_orders enable row level security;

-- Staff -> any existing work order; vendor -> currently assigned only.
-- Used by activity/attachments RLS and the storage policies.
create function public.can_access_work_order(p_work_order_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.id = p_work_order_id
      and (
        public.is_staff()
        or (wo.vendor_id is not null and wo.vendor_id = public.current_vendor_id())
      )
  );
$$;

revoke execute on function public.can_access_work_order(uuid) from public, anon;
grant execute on function public.can_access_work_order(uuid) to authenticated, service_role;

-- Fail-closed vendor guard: everything except `status` must be byte-identical
-- (jsonb diff — columns added later are protected automatically), and vendors
-- may only move status forward to in_progress/completed. Null app role
-- (seed/service contexts) passes untouched.
create function public.guard_work_order_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() = 'vendor' then
    if (to_jsonb(new) - 'status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'vendors may only change work order status' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('in_progress', 'completed') then
      raise exception 'vendors may only move a work order to in_progress or completed'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_work_order_update() from public, anon;

-- Same-event triggers fire alphabetically: guard (10) before touch (20).
create trigger work_orders_10_guard
  before update on public.work_orders
  for each row execute function public.guard_work_order_update();

create trigger work_orders_20_touch
  before update on public.work_orders
  for each row execute function public.set_updated_at();

create policy work_orders_select_staff_or_assigned on public.work_orders
  for select to authenticated
  using (
    (select public.is_staff())
    or vendor_id = (select public.current_vendor_id())
  );

create policy work_orders_insert_staff on public.work_orders
  for insert to authenticated
  with check ((select public.is_staff()));

-- WITH CHECK repeats the predicate: the proposed row must still be the
-- caller's (a vendor can't reassign away and still pass). Column limits are
-- the guard trigger's job — RLS picks rows, not columns.
create policy work_orders_update_staff_or_assigned on public.work_orders
  for update to authenticated
  using (
    (select public.is_staff())
    or vendor_id = (select public.current_vendor_id())
  )
  with check (
    (select public.is_staff())
    or vendor_id = (select public.current_vendor_id())
  );

create policy work_orders_delete_landlord on public.work_orders
  for delete to authenticated
  using ((select public.is_landlord()));

grant select, delete on public.work_orders to authenticated;
grant insert (property_id, unit_id, title, description, priority, due_date)
  on public.work_orders to authenticated;
grant update (title, description, status, priority, due_date, vendor_id, unit_id, cost_cents)
  on public.work_orders to authenticated;
grant all on public.work_orders to service_role;

-- Derived vendor read access (expressible only now that work_orders exists —
-- properties/units have been RLS-on deny-by-default since their own files, so
-- this is an extension, not a retrofit): the assigned vendor may read the
-- address of the property/unit their job points at. A work order with a null
-- unit_id exposes only the property.
create policy properties_select_assigned_vendor on public.properties
  for select to authenticated
  using (
    exists (
      select 1 from public.work_orders wo
      where wo.property_id = properties.id
        and wo.vendor_id = (select public.current_vendor_id())
    )
  );

create policy units_select_assigned_vendor on public.units
  for select to authenticated
  using (
    exists (
      select 1 from public.work_orders wo
      where wo.unit_id = units.id
        and wo.vendor_id = (select public.current_vendor_id())
    )
  );
