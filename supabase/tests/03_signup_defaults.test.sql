-- What a new auth.users row becomes, and what it can see. Run: supabase test db
--
-- Self-registration is open ([auth] enable_signup = true), so `handle_new_user()`
-- now runs on input a stranger controls. These assertions pin the two properties
-- that make that safe: the role is never taken from client-supplied metadata,
-- and an unlinked account can read nothing. Re-widening either fails CI.
--
-- Identity simulation matches 01/02: request.jwt.claims carries the sub, and
-- queries run as the `authenticated` Postgres role.
--
-- These fixtures INSERT into auth.users directly, so they pin the trigger's
-- contract rather than any particular caller of it. That distinction matters
-- for the phone assertions below: since 2026-08-31 no application path writes
-- `raw_user_meta_data.phone` at insert time — `/signup` submits an email alone
-- and `inviteVendor` sends only `full_name` — so the fallback they cover is
-- dormant, kept for `[auth.sms] enable_signup` in Phase 5. A green run here is
-- not evidence that a signup form still sends a phone.

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(9);

-- Disposable users, one per case. The token-ish columns are '' rather than NULL
-- because GoTrue's scanner errors on NULLs there. The surrounding transaction
-- rolls every fixture back.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current)
values
  -- 1: a self-registration claiming to be a landlord in the client-supplied
  --    object. This is the attack the whole model rests on rejecting.
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b1',
   'authenticated', 'authenticated', 'selfreg-escalate@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   null,
   '{"provider": "email", "providers": ["email"]}',
   '{"full_name": "Mallory", "phone": "5551230099", "app_role": "landlord", "role": "landlord"}',
   now(), now(), '', '', '', '', ''),
  -- 2: the sanctioned server-side path — role set in raw_app_meta_data.
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b2',
   'authenticated', 'authenticated', 'invited-manager@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   null,
   '{"provider": "email", "providers": ["email"], "app_role": "manager"}',
   '{"full_name": "Invited Manager"}',
   now(), now(), '', '', '', '', ''),
  -- 3: no role metadata anywhere.
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b3',
   'authenticated', 'authenticated', 'selfreg-plain@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   null,
   '{"provider": "email", "providers": ["email"]}',
   '{"full_name": "Plain Signup", "phone": "+15551230098"}',
   now(), now(), '', '', '', '', ''),
  -- 4: auth.users.phone populated as well as the metadata, to pin precedence.
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b4',
   'authenticated', 'authenticated', 'phone-precedence@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '+15551230097',
   '{"provider": "email", "providers": ["email"]}',
   '{"full_name": "Phone Precedence", "phone": "+15551230096"}',
   now(), now(), '', '', '', '', ''),
  -- 5: whitespace-only name and phone — length CHECKs alone would accept both.
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-0000000000b5',
   'authenticated', 'authenticated', 'blank-fields@realtyworks.test',
   extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   null,
   '{"provider": "email", "providers": ["email"]}',
   '{"full_name": "   ", "phone": "   "}',
   now(), now(), '', '', '', '', '');

-- ── role assignment ────────────────────────────────────────────────────────

select is(
  (select role from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b1'),
  'vendor'::public.app_role,
  'a self-registration cannot promote itself via raw_user_meta_data.app_role'
);

select is(
  (select role from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b2'),
  'manager'::public.app_role,
  'a server-set raw_app_meta_data.app_role still assigns the role'
);

select is(
  (select role from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b3'),
  'vendor'::public.app_role,
  'a signup with no role metadata defaults to vendor'
);

-- ── name and phone as handle_new_user() resolves them ──────────────────────

select is(
  (select phone from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b3'),
  '+15551230098',
  'a phone in raw_user_meta_data reaches the profile (dormant fallback)'
);

select is(
  (select phone from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b4'),
  '+15551230097',
  'auth.users.phone takes precedence over the metadata phone'
);

select is(
  (select phone from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b5'),
  null,
  'a whitespace-only phone is stored as NULL, not as blanks'
);

select is(
  (select full_name from public.profiles
   where id = '00000000-0000-0000-0000-0000000000b5'),
  null,
  'a whitespace-only full_name is stored as NULL, not as blanks'
);

-- ── the fail-safe: an unlinked self-registration reads nothing ─────────────
-- Exactly the shape open signup now produces: a real session, a real profile,
-- role 'vendor', and no vendors row — so current_vendor_id() is NULL and every
-- policy arm keyed on it matches no rows.

do $$
begin
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}', true);
end $$;
set local role authenticated;

select is(
  (select count(*) from public.work_orders)::int, 0,
  'an unlinked self-registration sees no work orders'
);

select is(
  (select count(*) from public.properties)::int, 0,
  'an unlinked self-registration sees no properties'
);

reset role;

select * from finish();
rollback;
