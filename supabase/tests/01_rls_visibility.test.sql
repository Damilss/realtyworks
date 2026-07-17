-- RLS visibility per role, against the seeded state. Run: supabase test db
-- Identity simulation: request.jwt.claims carries the seeded user's sub, and
-- queries run as the `authenticated` (or `anon`) Postgres role — the same
-- shape PostgREST requests have.

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(11);

-- landlord sees everything
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select is(
  (select count(*) from public.work_orders)::int, 5,
  'landlord sees all 5 work orders'
);

reset role;

-- manager sees everything
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000002", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select is(
  (select count(*) from public.work_orders)::int, 5,
  'manager sees all 5 work orders'
);

reset role;

-- vendor sees only assigned work orders + what they point at
do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000003", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select is(
  (select count(*) from public.work_orders)::int, 3,
  'vendor sees only the 3 assigned work orders'
);

select is(
  (select count(*) from public.properties)::int, 2,
  'vendor sees the properties their assigned work orders point at'
);

select is(
  (select count(*) from public.units)::int, 2,
  'vendor sees only units referenced by assigned work orders (null-unit WO exposes none)'
);

select is(
  (select count(*) from public.work_order_activity
   where work_order_id = '40000000-0000-0000-0000-000000000001')::int, 0,
  'vendor sees no activity for an unassigned work order'
);

select ok(
  (select count(*) from public.work_order_activity
   where work_order_id = '40000000-0000-0000-0000-000000000003') > 0,
  'vendor sees the activity trail of an assigned work order'
);

select is(
  (select count(*) from public.work_order_attachments)::int, 1,
  'vendor sees the attachment on their assigned work order'
);

select is(
  (select count(*) from public.profiles)::int, 3,
  'linked vendor sees own profile + the two staff profiles (actor names)'
);

reset role;

-- anon: zero grants — denied before RLS is even consulted
set local role anon;

select throws_ok(
  'select * from public.work_orders',
  '42501', null,
  'anon cannot read work_orders'
);

select throws_ok(
  'select * from public.properties',
  '42501', null,
  'anon cannot read properties'
);

reset role;

select * from finish();

rollback;
