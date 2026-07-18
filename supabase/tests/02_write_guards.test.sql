-- Write-path enforcement: vendor column guard, role-change machinery,
-- append-only activity, coordinated-only work-order/attachment deletes, and
-- history-preserving RESTRICTs.
-- Run: supabase test db

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(32);

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

select throws_ok(
  $$insert into public.work_order_attachments
      (id, work_order_id, kind, storage_path, file_name, mime_type)
    values ('50000000-0000-0000-0000-000000000099',
            '40000000-0000-0000-0000-000000000003', 'photo',
            '40000000-0000-0000-0000-000000000003/evil/nested.jpg',
            'nested.jpg', 'image/jpeg')$$,
  '23514', null,
  'attachment metadata must match <work_order_id>/<attachment_id>.<ext> exactly'
);

select throws_ok(
  $$insert into public.work_order_activity (work_order_id, note)
    values ('40000000-0000-0000-0000-000000000001', 'note on someone else''s job')$$,
  '42501', null,
  'vendor cannot note an unassigned work order (RLS with check)'
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

select * from finish();

rollback;
