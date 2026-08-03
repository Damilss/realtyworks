-- Write-path enforcement: vendor column guard, role-change machinery,
-- append-only activity, coordinated-only work-order/attachment deletes, and
-- history-preserving RESTRICTs.
-- Run: supabase test db

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(68);

-- ── vendor write surface ────────────────────────────────────────────────────
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select lives_ok(
  $$update public.work_orders set status = 'completed'
    where id = '40000000-0000-0000-0000-000000000003'$$,
  'vendor may move an assigned work order to completed'
);

select is(
  (select status from public.work_orders
   where id = '40000000-0000-0000-0000-000000000003'),
  'completed'::public.work_order_status,
  'the vendor status update took effect'
);

select throws_ok(
  $$update public.work_orders set title = 'hijacked'
    where id = '40000000-0000-0000-0000-000000000003'$$,
  '42501', null,
  'vendor cannot change any column but status (guard trigger)'
);

select throws_ok(
  $$update public.work_orders set status = 'cancelled'
    where id = '40000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'vendor cannot cancel a work order (allowed targets: in_progress, completed)'
);

select throws_ok(
  $$update public.work_orders set vendor_id = null
    where id = '40000000-0000-0000-0000-000000000002'$$,
  '42501', null,
  'vendor cannot change assignment (guard trigger)'
);

select lives_ok(
  $$update public.work_orders set status = 'in_progress'
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'vendor update on an unassigned work order matches zero rows (no error, no effect)'
);

reset role;

select is(
  (select status from public.work_orders
   where id = '40000000-0000-0000-0000-000000000001'),
  'open'::public.work_order_status,
  'the unassigned work order was untouched'
);

-- ── privilege escalation & audit forgery ────────────────────────────────────
set local role authenticated;

select throws_ok(
  $$update public.profiles set role = 'landlord'
    where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null,
  'vendor cannot self-escalate: role column has no update grant'
);

select throws_ok(
  $$insert into public.work_order_activity (work_order_id, actor_id, note)
    values ('40000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000002', 'forged as manager')$$,
  '42501', null,
  'vendor cannot write actor_id (no insert grant on the column)'
);

select throws_ok(
  $$insert into public.work_order_activity (work_order_id, action, note)
    values ('40000000-0000-0000-0000-000000000003', 'status_changed', 'fake system row')$$,
  '42501', null,
  'vendor cannot author system-kind activity entries'
);

select lives_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000003', 'vendor note via client path')$$,
  'vendor may add a note to an assigned work order'
);

-- A blank note is permanent and unfixable once written: the trail has no
-- UPDATE or DELETE path for anyone. `note is not null` alone let '' and '   '
-- through (issue #76).
select throws_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000003', '')$$,
  '23514', null,
  'an empty note is refused by activity_note_requires_text'
);

select throws_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000003', '   ')$$,
  '23514', null,
  'a whitespace-only note is refused by activity_note_requires_text'
);

-- The null arm still has to fail on its own: a CHECK evaluating to NULL passes,
-- so a predicate testing only the trimmed length would let this through.
select throws_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000003', null)$$,
  '23514', null,
  'a null note on a note_added row is still refused'
);

-- Attachment metadata is a service-role-only write via the coordinated upload
-- action — the client has no insert grant. Even a well-formed row from an
-- assigned vendor is refused, so a client can never create a metadata row with
-- no object behind it (the 404-on-download / immutable attachment_added /
-- undeletable orphan). The path-shape and id-required invariants still guard the
-- service path — re-tested as service_role below.
select throws_ok(
  $$insert into public.work_order_attachments
      (id, work_order_id, kind, storage_path, file_name, mime_type)
    values ('50000000-0000-0000-0000-000000000099',
            '40000000-0000-0000-0000-000000000003', 'photo',
            '40000000-0000-0000-0000-000000000003/50000000-0000-0000-0000-000000000099.jpg',
            'photo.jpg', 'image/jpeg')$$,
  '42501', null,
  'authenticated client cannot insert attachment metadata (no grant — coordinated upload path)'
);

-- Storage enforces the same <wo>/<attachment_id>.<ext> shape as the metadata
-- path CHECK, so an object is insertable IFF a metadata row could reference it.
-- A non-UUID basename that no row can point at (and no client can delete) is
-- refused, not orphaned. storage.foldername() drops the basename, so the folder
-- check alone used to let it through.
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('work-order-attachments',
            '40000000-0000-0000-0000-000000000003/photo.jpg')$$,
  '42501', null,
  'storage rejects a non-UUID object basename (an unreferenceable, undeletable orphan)'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('work-order-attachments',
            '40000000-0000-0000-0000-000000000003/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg')$$,
  'storage accepts the canonical <work_order_id>/<attachment_id>.<ext> name for an assigned vendor'
);

select throws_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000001', 'note on someone else''s job')$$,
  '42501', null,
  'vendor cannot note an unassigned work order (RLS with check)'
);

reset role;

-- ── attachment metadata invariants on the coordinated (service_role) path ────
-- The client has no insert grant (above); the path-shape CHECK and the
-- id-required rule now guard the service_role insert the Phase 3 upload action
-- uses. uploaded_by must be supplied — it has no DB default (like id), so the
-- generated Insert type marks it required; auth.uid() would be null under the
-- service role anyway.
set local role service_role;

select throws_ok(
  $$insert into public.work_order_attachments
      (id, work_order_id, kind, storage_path, file_name, mime_type, uploaded_by)
    values ('50000000-0000-0000-0000-000000000099',
            '40000000-0000-0000-0000-000000000003', 'photo',
            '40000000-0000-0000-0000-000000000003/evil/nested.jpg',
            'nested.jpg', 'image/jpeg',
            '00000000-0000-0000-0000-000000000002')$$,
  '23514', null,
  'attachment metadata must match <work_order_id>/<attachment_id>.<ext> exactly'
);

-- id has no DB default: omitting it is a not-null error (23502), never a
-- silent server-generated id that mismatches storage_path and orphans the
-- already-uploaded object.
select throws_ok(
  $$insert into public.work_order_attachments
      (work_order_id, kind, storage_path, file_name, mime_type, uploaded_by)
    values ('40000000-0000-0000-0000-000000000003', 'photo',
            '40000000-0000-0000-0000-000000000003/50000000-0000-0000-0000-0000000000aa.jpg',
            'photo.jpg', 'image/jpeg',
            '00000000-0000-0000-0000-000000000002')$$,
  '23502', null,
  'attachment insert must supply id — no DB default to silently fill it'
);

reset role;

-- ── append-only activity ────────────────────────────────────────────────────
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select throws_ok(
  $$update public.work_order_activity set note = 'rewritten' where id = 1$$,
  '42501', null,
  'manager cannot edit activity (no update grant)'
);

reset role;

select throws_ok(
  $$update public.work_order_activity set note = 'rewritten' where id = 1$$,
  '42501', null,
  'even the table owner cannot edit activity (forbid trigger)'
);

-- ── deletes: coordinated-only work orders, history-preserving FKs ──────────
set local role authenticated;

select throws_ok(
  $$insert into public.work_orders (property_id, unit_id, title, priority)
    values ('10000000-0000-0000-0000-000000000002',
            '20000000-0000-0000-0000-000000000001',
            'unit from the wrong property', 'low')$$,
  '23503', null,
  'a work order cannot pair a unit with a property it does not belong to'
);

select throws_ok(
  $$delete from public.work_orders where id = '40000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'manager cannot delete a work order directly (no grant)'
);

reset role;

select is(
  (select count(*) from public.work_orders)::int, 5,
  'no work order was deleted by the manager'
);

-- ── role management ─────────────────────────────────────────────────────────
set local role authenticated;

select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-000000000003'::uuid,
                                'manager'::public.app_role)$$,
  '42501', null,
  'manager cannot change roles'
);

reset role;

-- Fail closed for a caller with no profiles row (imported / partially-repaired
-- account): is_landlord() is NULL there, so a `not is_landlord()` guard would
-- fall through and let the role change land. `is not true` denies it.
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-0000000000ff", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-000000000003'::uuid,
                                'landlord'::public.app_role)$$,
  '42501', null,
  'a caller with no profiles row cannot change roles (is_landlord() NULL fails closed)'
);

reset role;

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select throws_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-000000000001'::uuid,
                                'manager'::public.app_role)$$,
  '42501', null,
  'landlord cannot change their own role (lock-out guard)'
);

select lives_ok(
  $$select public.set_user_role('00000000-0000-0000-0000-000000000003'::uuid,
                                'manager'::public.app_role)$$,
  'landlord can change another user''s role'
);

reset role;

select is(
  (select role from public.profiles
   where id = '00000000-0000-0000-0000-000000000003'),
  'manager'::public.app_role,
  'the role change took effect'
);

do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

select throws_ok(
  $$update public.profiles set role = 'manager'
    where id = '00000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'the last landlord cannot be demoted (guard trigger, any write path)'
);

-- ── landlord delete: work orders require coordinated server action ─────────
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select throws_ok(
  $$delete from public.work_orders where id = '40000000-0000-0000-0000-000000000005'$$,
  '42501', null,
  'landlord cannot bypass coordinated work-order deletion (no grant)'
);

reset role;

select is(
  (select count(*) from public.work_orders)::int, 5,
  'the direct landlord delete did not remove a work order'
);

select is(
  (select count(*) from public.work_order_activity
   where work_order_id = '40000000-0000-0000-0000-000000000005') > 0, true,
  'the denied delete preserves the work order activity trail'
);

set local role authenticated;

select throws_ok(
  $$delete from public.properties where id = '10000000-0000-0000-0000-000000000001'$$,
  '23503', null,
  'a property whose units carry work-order history cannot be deleted (RESTRICT)'
);

reset role;

-- manager cannot delete a property at all
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select lives_ok(
  $$delete from public.properties where id = '10000000-0000-0000-0000-000000000002'$$,
  'manager property delete matches zero rows (no error, no effect)'
);

reset role;

select is(
  (select count(*) from public.properties)::int, 2,
  'no property was deleted by the manager'
);

-- ── attachment deletes are coordinated-only (no client surface) ─────────────
-- A client-side delete of either layer alone would desynchronize metadata and
-- object (unlisted-but-fetchable file, or metadata pointing at a 404); both
-- deletes belong to the Phase 3 server action. Even a landlord is denied.
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
end $$;

insert into storage.objects (bucket_id, name)
values ('work-order-attachments',
        '40000000-0000-0000-0000-000000000004/50000000-0000-0000-0000-000000000001.jpg');

set local role authenticated;

select throws_ok(
  $$delete from public.work_order_attachments
    where id = '50000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'not even a landlord can delete attachment metadata directly (no grant)'
);

-- Direct object delete: swallow whichever denial fires (missing grant vs. no
-- policy = zero rows) — the assertion is that the object survives.
do $$
begin
  begin
    delete from storage.objects
    where bucket_id = 'work-order-attachments'
      and name = '40000000-0000-0000-0000-000000000004/50000000-0000-0000-0000-000000000001.jpg';
  exception when others then null;
  end;
end $$;

reset role;

select is(
  (select count(*) from public.work_order_attachments
   where id = '50000000-0000-0000-0000-000000000001')::int, 1,
  'the metadata row survives a direct client delete attempt'
);

select is(
  (select count(*) from storage.objects
   where bucket_id = 'work-order-attachments'
     and name = '40000000-0000-0000-0000-000000000004/50000000-0000-0000-0000-000000000001.jpg')::int, 1,
  'the storage object survives a direct client delete attempt'
);

-- ── vendor contact method: at least one *usable* value ──────────────────────
-- The plain `phone is not null or email is not null` accepted '' — a form
-- posting empty strings could create a vendor with no reachable contact,
-- breaking the docs/vendor-access.md phone-OR-email invariant.
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select throws_ok(
  $$insert into public.vendors (name, phone, email)
    values ('Blank Contact Co', '   ', '')$$,
  '23514', null,
  'a vendor with only blank/whitespace phone and email is rejected (usable-contact CHECK)'
);

select lives_ok(
  $$insert into public.vendors (name, phone, email)
    values ('Email Only Co', '', 'contact@example.test')$$,
  'a blank phone is accepted when a real email is present (constraint is not over-tight)'
);

-- ── property address components must be non-blank (trimmed) ──────────────────
-- NOT NULL alone let '' / '   ' through for city/state/postal_code, unlike the
-- neighboring name/address_line1 length checks — an unusable address via the
-- Data API. (Still the authenticated manager from the vendor block above.)
select throws_ok(
  $$insert into public.properties (name, address_line1, city, state, postal_code)
    values ('Blank City', '1 Main St', '   ', 'IL', '62704')$$,
  '23514', null,
  'a property with a blank/whitespace city is rejected (non-blank CHECK)'
);

select throws_ok(
  $$insert into public.properties (name, address_line1, city, state, postal_code)
    values ('Blank State', '1 Main St', 'Springfield', '', '62704')$$,
  '23514', null,
  'a property with a blank state is rejected (non-blank CHECK)'
);

select throws_ok(
  $$insert into public.properties (name, address_line1, city, state, postal_code)
    values ('Blank Postal', '1 Main St', 'Springfield', 'IL', '   ')$$,
  '23514', null,
  'a property with a blank/whitespace postal_code is rejected (non-blank CHECK)'
);

select lives_ok(
  $$insert into public.properties (name, address_line1, city, state, postal_code)
    values ('Valid Property', '1 Main St', 'Springfield', 'IL', '62704')$$,
  'a property with real address components is accepted (constraint is not over-tight)'
);

reset role;

-- ── storage bucket stays private and bounded on conflict ─────────────────────
-- The bucket migration upserts with `on conflict (id) do update`, so re-running
-- it over a pre-existing row reconverges the config instead of silently keeping
-- it. A bucket left public would serve every object over an unauthenticated
-- public URL, bypassing wo_attachments_select; loosened size/MIME limits would
-- persist the same way. Simulate the drifted row, replay the migration's upsert,
-- and assert every security-bearing column is forced back. (Superuser here —
-- role was reset above; storage.buckets is not client-writable.)
update storage.buckets
   set public = true, file_size_limit = null, allowed_mime_types = null
 where id = 'work-order-attachments';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-order-attachments',
  'work-order-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

select is(
  (select public from storage.buckets where id = 'work-order-attachments'),
  false,
  'a pre-existing public bucket is forced back to private on conflict (no public-URL bypass)'
);

select is(
  (select file_size_limit from storage.buckets where id = 'work-order-attachments'),
  10485760::bigint,
  'a loosened file_size_limit is reasserted to 10 MiB on conflict'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'work-order-attachments'),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  'a cleared allowed_mime_types allowlist is reasserted on conflict'
);

-- ── final-landlord deletes: direct and auth.users cascade ───────────────────
-- Use disposable landlords with no RESTRICT-linked history so the assertions
-- reach the profile trigger, rather than succeeding for an unrelated FK reason.
-- Once both exist, demote the seeded landlord so these two form an isolated
-- two-landlord state. The surrounding transaction rolls every fixture back.
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'landlord-delete-a@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"], "app_role": "landlord"}',
   '{"full_name": "Disposable Landlord A"}',
   now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'landlord-delete-b@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"], "app_role": "landlord"}',
   '{"full_name": "Disposable Landlord B"}',
   now(), now(), '', '', '', '', '');

update public.profiles
set role = 'manager'
where id = '00000000-0000-0000-0000-000000000001';

set local role service_role;

select lives_ok(
  $$delete from public.profiles
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'a privileged direct delete may remove a non-final landlord profile'
);

reset role;

select is(
  (select count(*) from public.profiles
   where id = '00000000-0000-0000-0000-0000000000a1')::int,
  0,
  'the non-final landlord profile was deleted'
);

set local role service_role;

select throws_ok(
  $$delete from public.profiles
    where id = '00000000-0000-0000-0000-0000000000a2'$$,
  '42501', 'cannot delete the last landlord',
  'a privileged direct delete cannot remove the final landlord profile'
);

reset role;

select is(
  (select count(*) from public.profiles
   where id = '00000000-0000-0000-0000-0000000000a2')::int,
  1,
  'the final landlord profile survives the refused direct delete'
);

-- Supabase reserves auth-admin membership to superusers, while the CLI's pgTAP
-- connection is intentionally non-superuser. Assert the definer boundary that
-- lets the production auth-admin trigger inspect profiles, then delete the auth
-- parent as the test owner to exercise the exact same FK cascade path.
select is(
  (select p.prosecdef
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_profile_delete'),
  true,
  'the delete guard runs as definer for auth-admin cascades'
);

select throws_ok(
  $$delete from auth.users
    where id = '00000000-0000-0000-0000-0000000000a2'$$,
  '42501', 'cannot delete the last landlord',
  'the auth.users cascade cannot remove the final landlord profile'
);

select is(
  (select count(*)
   from auth.users u
   join public.profiles p on p.id = u.id
   where u.id = '00000000-0000-0000-0000-0000000000a2')::int,
  1,
  'the refused auth-admin cascade preserves both the auth user and profile'
);

-- ── service-role table privileges: row DML, never table administration ──────
-- Query the direct grants as an exact set so a future GRANT ALL fails even if
-- a trigger happens to reject the attempted mutation at runtime.
select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'work_order_activity'),
  array['INSERT', 'SELECT']::text[],
  'service_role has exactly SELECT and INSERT on the append-only activity trail'
);

select is(
  has_table_privilege('service_role', 'public.work_order_activity', 'DELETE'),
  false,
  'service_role cannot DELETE activity rows directly'
);

select is(
  has_table_privilege('service_role', 'public.work_order_activity', 'TRUNCATE'),
  false,
  'service_role cannot TRUNCATE the activity trail'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'profiles'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on profiles'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'properties'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on properties'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'units'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on units'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'vendors'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on vendors'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'work_orders'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on work_orders'
);

select is(
  (select array_agg(privilege_type::text order by privilege_type)
   from information_schema.role_table_grants
   where grantee = 'service_role'
     and table_schema = 'public'
     and table_name = 'work_order_attachments'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[],
  'service_role has row DML, not table-administration privileges, on attachment metadata'
);

-- Prove the child DELETE revocation does not break the coordinated parent
-- delete. Seeded work order 5 has activity and no attachment object to clean up,
-- so it isolates the Postgres cascade that the server action relies on.
select ok(
  (select count(*) from public.work_order_activity
   where work_order_id = '40000000-0000-0000-0000-000000000005') > 0,
  'the cascade fixture starts with activity rows'
);

set local role service_role;

select lives_ok(
  $$delete from public.work_orders
    where id = '40000000-0000-0000-0000-000000000005'$$,
  'service_role may delete the parent work order through the coordinated path'
);

select is(
  (select count(*) from public.work_order_activity
   where work_order_id = '40000000-0000-0000-0000-000000000005')::int,
  0,
  'the parent delete still cascades its activity rows without child DELETE privilege'
);

reset role;

select * from finish();

rollback;
