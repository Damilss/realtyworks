-- profiles: 1:1 with auth.users, holds the app role. RLS + grants ship here.
--
-- Trust notes:
-- * `role` deliberately has NO client update grant — the only mutation path is
--   set_user_role() below. RLS can't compare old/new and column grants can't
--   tell landlord from vendor, so the safe posture is: unreachable from the API.
-- * `auto_expose_new_tables` is off in config.toml, so every table/function
--   needs explicit grants (service_role included) to be reachable at all.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'vendor',
  full_name text check (full_name is null or char_length(full_name) <= 120),
  phone text check (phone is null or char_length(phone) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable, never FORCE: the SECURITY DEFINER helpers below rely on the table
-- owner bypassing RLS — forcing would recurse policy evaluation.
alter table public.profiles enable row level security;

-- Role helpers. SECURITY DEFINER (owner bypasses profiles RLS — no recursion),
-- STABLE (initplan-cached per statement when called as `(select ...)`),
-- empty search_path (nothing shadowable).
create function public.current_app_role() returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create function public.is_staff() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() in ('landlord', 'manager');
$$;

create function public.is_landlord() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_role() = 'landlord';
$$;

revoke execute on function public.current_app_role(), public.is_staff(), public.is_landlord()
  from public, anon;
grant execute on function public.current_app_role(), public.is_staff(), public.is_landlord()
  to authenticated, service_role;

-- The one sanctioned role-change path (landlord-only, never self).
create function public.set_user_role(target_user_id uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_landlord() then
    raise exception 'only landlords may change roles' using errcode = '42501';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target_user_id;
end;
$$;

revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role)
  to authenticated, service_role;

-- Backstop guard: binds every write path (owner, service_role, definer fns).
-- auth.uid() is null in seed/psql/service contexts — those are trusted.
create function public.guard_profile_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable' using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if (select auth.uid()) is not null and not public.is_landlord() then
      raise exception 'only a landlord may change roles' using errcode = '42501';
    end if;
    if old.role = 'landlord' and new.role <> 'landlord'
       and not exists (
         select 1 from public.profiles p
         where p.role = 'landlord' and p.id <> old.id
       ) then
      raise exception 'cannot demote the last landlord' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_update() from public, anon;

create trigger profiles_10_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

create trigger profiles_20_touch
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- auth.users -> profiles. Role comes from raw_app_meta_data (server-set only;
-- client signup `options.data` lands in raw_user_meta_data and is never read
-- for role). Missing role -> 'vendor': least privilege, and a vendor with no
-- vendors row can see nothing.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'app_role')::public.app_role, 'vendor'),
    new.raw_user_meta_data ->> 'full_name',
    new.phone
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS. Vendors see only their own row here; the "linked vendors may read staff
-- profiles" arm is added in the vendors migration (it needs current_vendor_id).
create policy profiles_select_own_or_staff on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT policy (rows are created only by on_auth_user_created).
-- No DELETE policy (user removal is an auth/admin operation).

grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant all on public.profiles to service_role;
