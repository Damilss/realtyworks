-- Enums + table-independent helpers for the Phase 2 schema.
-- Native enums (not check constraints): `supabase gen types typescript` emits
-- them as string-literal unions, so the value sets flow into the TS contract.
-- PG17 note for future migrations: `alter type ... add value` cannot be USED in
-- the same transaction that adds it — a migration that adds and uses a value
-- must be split in two.

create type public.app_role as enum ('landlord', 'manager', 'vendor');

create type public.work_order_status as enum (
  'open',
  'assigned',
  'in_progress',
  'completed',
  'cancelled'
);

create type public.work_order_priority as enum ('low', 'medium', 'high', 'urgent');

create type public.attachment_kind as enum ('photo', 'receipt', 'invoice', 'document');

create type public.activity_action as enum (
  'created',
  'status_changed',
  'vendor_assigned',
  'note_added',
  'attachment_added'
);

-- updated_at touch trigger. Hand-rolled rather than moddatetime: no extension
-- dependency to keep in sync across local/self-hosted, and a pinned search_path.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon;
