-- Self-service signup (2026-07-27) collects a phone number on the signup form
-- and sends it, with the full name, through
-- `supabase.auth.signUp({ options: { data } })`. GoTrue stores that object in
-- `raw_user_meta_data`.
--
-- The original trigger read the name from `raw_user_meta_data` but the phone
-- from `new.phone` — the `auth.users.phone` column, which only the SMS signup
-- path populates ([auth.sms] enable_signup = false). An email signup's phone
-- was therefore accepted by the form and silently dropped on the way to the
-- profile. Read the metadata, keeping `auth.users.phone` as the higher-priority
-- source so a future phone-auth signup still wins.
--
-- Role is deliberately NOT read from `raw_user_meta_data` and never will be.
-- That object is whatever the client sent. Now that anyone may self-register,
-- this is the invariant the entire authorization model rests on: every
-- self-registration is a 'vendor', and a vendor with no `vendors` row resolves
-- `current_vendor_id()` to NULL, so every policy arm keyed on it returns
-- nothing. Server-side creation still sets the role through `raw_app_meta_data`
-- (auth.admin.createUser / inviteUserByEmail with `app_metadata`), which a
-- client cannot reach. Pinned by supabase/tests/03_signup_defaults.test.sql.
--
-- `nullif(trim(...), '')` on both text columns closes the gap where a
-- whitespace-only value satisfies the length CHECKs on `profiles.full_name`
-- (<= 120) and `profiles.phone` (<= 32) — `'   '` is length 3. This covers only
-- the two columns this trigger writes; the wider sweep is tracked separately in
-- docs/backlog.md.
--
-- `create or replace` preserves the function's existing privileges and keeps
-- the `on_auth_user_created` trigger bound to the same oid. The revoke below is
-- therefore redundant, and restated so the closed grant stays legible in the
-- file that last touched the function.

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'app_role')::public.app_role, 'vendor'),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    coalesce(
      nullif(trim(new.phone), ''),
      nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
    )
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon;
