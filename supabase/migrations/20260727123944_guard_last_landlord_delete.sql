-- Hard-block semantics (option a): a landlord profile may be deleted only
-- while another landlord exists. This is deliberately enforced in Postgres,
-- not in selected admin callers, because deleting auth.users cascades directly
-- into profiles without passing through application code. An auth-admin delete
-- of the final landlord therefore fails atomically; promote a replacement first.
--
-- The existing UPDATE guard serializes landlord demotions on
-- `profiles.landlord_demotion`. DELETE must take that exact advisory lock before
-- checking too, so a racing demotion and deletion (or two deletions) cannot each
-- observe the other landlord and commit a zero-landlord state.

create function public.guard_profile_delete() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'landlord' then
    perform pg_advisory_xact_lock(hashtext('profiles.landlord_demotion'));
    if not exists (
      select 1 from public.profiles p
      where p.role = 'landlord' and p.id <> old.id
    ) then
      raise exception 'cannot delete the last landlord' using errcode = '42501';
    end if;
  end if;

  return old;
end;
$$;

-- SECURITY DEFINER lets the auth.users cascade inspect every profile even when
-- invoked by Supabase's auth-admin role. The empty search_path and qualified
-- table reference keep the definer boundary closed; direct calls are unnecessary.
revoke execute on function public.guard_profile_delete() from public, anon;

create trigger profiles_10_guard_delete
  before delete on public.profiles
  for each row execute function public.guard_profile_delete();
