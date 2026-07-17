-- work_order_activity: the append-only audit trail (a product feature, §5).
--
-- Append-only stack: no UPDATE/DELETE policies, no UPDATE/DELETE grants, and a
-- BEFORE UPDATE forbid trigger that binds owner/service paths too. Deliberately
-- NO delete trigger: landlord hard-delete of a work order cascades its trail —
-- the documented mistake-cleanup tradeoff (settled 2026-07-17).
--
-- Identity PK (not uuid): totally orders entries within one transaction, where
-- created_at ties; identity columns need no sequence grant for inserts.

create table public.work_order_activity (
  id bigint generated always as identity primary key,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  actor_id uuid default auth.uid() references public.profiles (id) on delete restrict,
  action public.activity_action not null default 'note_added',
  old_value jsonb,
  new_value jsonb,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  constraint activity_note_requires_text check (action <> 'note_added' or note is not null)
);

-- The timeline query (where work_order_id = ? order by id) straight off the index.
create index work_order_activity_wo_idx on public.work_order_activity (work_order_id, id);

alter table public.work_order_activity enable row level security;

create function public.forbid_activity_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'work_order_activity is append-only' using errcode = '42501';
end;
$$;

revoke execute on function public.forbid_activity_update() from public, anon;

create trigger work_order_activity_10_forbid_update
  before update on public.work_order_activity
  for each row execute function public.forbid_activity_update();

-- System entries. DEFINER: it must insert past the notes-only client policy;
-- it stamps the ACTUAL caller (auth.uid()), so entries can't be forged. INSERT
-- falls back to created_by for seed realism (no JWT in seed/psql).
-- One UPDATE changing both status and assignment logs two rows — one per
-- change type; the identity PK orders them. Vendor names are denormalized so
-- the trail survives renames.
create function public.log_work_order_changes() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_order_activity (work_order_id, actor_id, action, new_value)
    values (
      new.id,
      coalesce((select auth.uid()), new.created_by),
      'created',
      jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority)
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.work_order_activity (work_order_id, actor_id, action, old_value, new_value)
    values (
      new.id,
      (select auth.uid()),
      'status_changed',
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;

  if new.vendor_id is distinct from old.vendor_id then
    insert into public.work_order_activity (work_order_id, actor_id, action, old_value, new_value)
    values (
      new.id,
      (select auth.uid()),
      'vendor_assigned',
      jsonb_build_object(
        'vendor_id', old.vendor_id,
        'vendor_name', (select name from public.vendors where id = old.vendor_id)
      ),
      jsonb_build_object(
        'vendor_id', new.vendor_id,
        'vendor_name', (select name from public.vendors where id = new.vendor_id)
      )
    );
  end if;

  return null;
end;
$$;

revoke execute on function public.log_work_order_changes() from public, anon;

create trigger work_orders_30_log
  after insert or update on public.work_orders
  for each row execute function public.log_work_order_changes();

create policy activity_select_wo_access on public.work_order_activity
  for select to authenticated
  using (public.can_access_work_order(work_order_id));

-- Clients author NOTES only, as themselves, on work orders they can access.
-- action and actor_id have no insert grant — their defaults ('note_added',
-- auth.uid()) apply, and this check pins them.
create policy activity_insert_note on public.work_order_activity
  for insert to authenticated
  with check (
    action = 'note_added'
    and actor_id = (select auth.uid())
    and public.can_access_work_order(work_order_id)
  );

-- No UPDATE policy. No DELETE policy. For anyone.

grant select on public.work_order_activity to authenticated;
grant insert (work_order_id, note) on public.work_order_activity to authenticated;
grant all on public.work_order_activity to service_role;
