-- Local seed — loaded by `supabase db reset` (config.toml [db.seed]).
-- Runs as postgres: RLS/grants don't apply, but triggers DO fire — the seed
-- leans on that: profiles materialize via on_auth_user_created, and work
-- orders are inserted as 'open' then UPDATEd into their target states so the
-- activity log carries a realistic trigger-written history.
--
-- Deterministic UUIDs, block-prefixed by entity:
--   users 00000000-…  properties 10000000-…  units 20000000-…
--   vendors 30000000-…  work orders 40000000-…  attachments 50000000-…
--   identities 90000000-…
--
-- Logins (local only): landlord@realtyworks.test / manager@realtyworks.test /
-- vendor@realtyworks.test — password `password123`.

create extension if not exists pgcrypto with schema extensions;

-- ── Auth users ──────────────────────────────────────────────────────────────
-- Direct auth.users inserts (the CLI-supported local mechanism). Gotchas:
-- token-ish columns are seeded as '' (GoTrue errors scanning NULLs there);
-- app_role rides in raw_app_meta_data (server-set territory) so
-- handle_new_user() creates the three profiles with correct roles — the seed
-- never inserts profiles rows directly.

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'landlord@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"], "app_role": "landlord"}',
   '{"full_name": "Lana Landlord"}',
   now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'manager@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"], "app_role": "manager"}',
   '{"full_name": "Manny Manager"}',
   now(), now(), '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'vendor@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"], "app_role": "vendor"}',
   '{"full_name": "Bob Vendor"}',
   now(), now(), '', '', '', '', '');

insert into auth.identities
  (id, user_id, provider, provider_id, identity_data, last_sign_in_at,
   created_at, updated_at)
values
  ('90000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'email',
   '00000000-0000-0000-0000-000000000001',
   '{"sub": "00000000-0000-0000-0000-000000000001", "email": "landlord@realtyworks.test", "email_verified": true, "phone_verified": false}',
   now(), now(), now()),
  ('90000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002', 'email',
   '00000000-0000-0000-0000-000000000002',
   '{"sub": "00000000-0000-0000-0000-000000000002", "email": "manager@realtyworks.test", "email_verified": true, "phone_verified": false}',
   now(), now(), now()),
  ('90000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000003', 'email',
   '00000000-0000-0000-0000-000000000003',
   '{"sub": "00000000-0000-0000-0000-000000000003", "email": "vendor@realtyworks.test", "email_verified": true, "phone_verified": false}',
   now(), now(), now());

-- ── Properties & units ──────────────────────────────────────────────────────
-- created_by is supplied explicitly everywhere below: seed runs without a JWT,
-- so the auth.uid() column defaults would resolve to NULL.

insert into public.properties
  (id, name, address_line1, city, state, postal_code, created_by)
values
  ('10000000-0000-0000-0000-000000000001', 'Maple Court Apartments',
   '412 Maple Ct', 'Springfield', 'IL', '62704',
   '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Oak Street House',
   '87 Oak St', 'Springfield', 'IL', '62702',
   '00000000-0000-0000-0000-000000000001');

insert into public.units (id, property_id, label, created_by)
values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'Unit 1A',
   '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001', 'Unit 1B',
   '00000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000002', 'Main House',
   '00000000-0000-0000-0000-000000000002');

-- ── Vendor (contact row, linked to the vendor auth user) ────────────────────

insert into public.vendors (id, name, phone, email, profile_id, created_by)
values
  ('30000000-0000-0000-0000-000000000001', 'Bob''s Handyman Services',
   '+15551230003', 'vendor@realtyworks.test',
   '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000002');

-- ── Work orders — every status, driven through real transitions ─────────────
-- Insert as 'open', then UPDATE toward the target state so work_orders_30_log
-- writes the same history a live app would produce (created → vendor_assigned
-- → status_changed …). Insert-time actor falls back to created_by; the
-- update-time actor is NULL (no JWT) — rendered as "system" in dev UIs.

-- 1. open · unassigned · medium
insert into public.work_orders
  (id, property_id, unit_id, title, description, priority, created_by)
values
  ('40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   'Dripping kitchen faucet',
   'Tenant reports a steady drip from the kitchen faucet in 1A.',
   'medium',
   '00000000-0000-0000-0000-000000000002');

-- 2. assigned · high · due next week
insert into public.work_orders
  (id, property_id, unit_id, title, description, priority, due_date, created_by)
values
  ('40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002',
   'Water heater not heating',
   'No hot water in 1B since Monday. Unit is a 40-gal electric heater.',
   'high', current_date + 7,
   '00000000-0000-0000-0000-000000000002');

update public.work_orders
set vendor_id = '30000000-0000-0000-0000-000000000001', status = 'assigned'
where id = '40000000-0000-0000-0000-000000000002';

-- 3. in_progress · urgent
insert into public.work_orders
  (id, property_id, unit_id, title, description, priority, due_date, created_by)
values
  ('40000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000003',
   'Roof leak above back bedroom',
   'Active leak during rain; ceiling drywall is staining. Tarp until repair.',
   'urgent', current_date + 2,
   '00000000-0000-0000-0000-000000000002');

update public.work_orders
set vendor_id = '30000000-0000-0000-0000-000000000001', status = 'assigned'
where id = '40000000-0000-0000-0000-000000000003';

update public.work_orders
set status = 'in_progress'
where id = '40000000-0000-0000-0000-000000000003';

-- 4. completed · with cost · property-level (unit_id NULL — exercises the
--    vendor read path that exposes only the property)
insert into public.work_orders
  (id, property_id, title, description, priority, created_by)
values
  ('40000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000002',
   'Gutter cleaning — full exterior',
   'Seasonal gutter cleaning for the whole house.',
   'low',
   '00000000-0000-0000-0000-000000000001');

update public.work_orders
set vendor_id = '30000000-0000-0000-0000-000000000001', status = 'assigned'
where id = '40000000-0000-0000-0000-000000000004';

update public.work_orders
set status = 'in_progress'
where id = '40000000-0000-0000-0000-000000000004';

update public.work_orders
set status = 'completed', cost_cents = 18500
where id = '40000000-0000-0000-0000-000000000004';

-- 5. cancelled · low
insert into public.work_orders
  (id, property_id, unit_id, title, description, priority, created_by)
values
  ('40000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   'Repaint hallway scuffs',
   'Cosmetic scuffs near the entry. Tenant fixed it themselves.',
   'low',
   '00000000-0000-0000-0000-000000000002');

update public.work_orders
set status = 'cancelled'
where id = '40000000-0000-0000-0000-000000000005';

-- ── Manual notes (the client-insert path, with explicit actors) ─────────────

insert into public.work_order_activity (work_order_id, actor_id, action, note)
values
  ('40000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002', 'note_added',
   'Vendor confirmed for Thursday morning. Tenant notified.'),
  ('40000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000003', 'note_added',
   'Tarped the affected section. Shingles + underlayment ordered, ETA 2 days.');

-- ── Attachment metadata (kind='receipt') ────────────────────────────────────
-- Metadata row only — there is no object behind it in local storage. Fine for
-- list-UI development; real uploads land via the Phase 3 flow.

insert into public.work_order_attachments
  (id, work_order_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by)
values
  ('50000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000004', 'receipt',
   '40000000-0000-0000-0000-000000000004/50000000-0000-0000-0000-000000000001.jpg',
   'receipt-hardware-store.jpg', 'image/jpeg', 482113,
   '00000000-0000-0000-0000-000000000003');
