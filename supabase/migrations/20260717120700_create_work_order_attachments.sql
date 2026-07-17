-- work_order_attachments: metadata rows; the files live in Supabase Storage
-- (bucket + object policies in the next migration). Receipts are attachments
-- with kind='receipt' — deliberately NOT a line-items/ledger table
-- (docs/vendor-access.md §4; the ledger is Phase 6).
--
-- id is generated client-side BEFORE upload and becomes the object name, so
-- the path CHECK below ties every metadata row to its own work order's storage
-- prefix — a row can never point at another work order's object.

create table public.work_order_attachments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  kind public.attachment_kind not null default 'photo',
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 255),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint attachments_path_matches_work_order
    check (storage_path like work_order_id::text || '/%')
);

create index work_order_attachments_wo_idx on public.work_order_attachments (work_order_id);

alter table public.work_order_attachments enable row level security;

create function public.log_attachment_added() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.work_order_activity (work_order_id, actor_id, action, new_value)
  values (
    new.work_order_id,
    coalesce((select auth.uid()), new.uploaded_by),
    'attachment_added',
    jsonb_build_object('attachment_id', new.id, 'kind', new.kind, 'file_name', new.file_name)
  );
  return null;
end;
$$;

revoke execute on function public.log_attachment_added() from public, anon;

create trigger work_order_attachments_30_log
  after insert on public.work_order_attachments
  for each row execute function public.log_attachment_added();

create policy attachments_select_wo_access on public.work_order_attachments
  for select to authenticated
  using (public.can_access_work_order(work_order_id));

create policy attachments_insert_wo_access on public.work_order_attachments
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.can_access_work_order(work_order_id)
  );

-- Staff may fix a mis-categorized kind — the update grant carries ONLY `kind`,
-- so this policy can't reach anything else.
create policy attachments_update_staff on public.work_order_attachments
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy attachments_delete_landlord on public.work_order_attachments
  for delete to authenticated
  using ((select public.is_landlord()));

grant select, delete on public.work_order_attachments to authenticated;
grant insert (id, work_order_id, kind, storage_path, file_name, mime_type, size_bytes)
  on public.work_order_attachments to authenticated;
grant update (kind) on public.work_order_attachments to authenticated;
grant all on public.work_order_attachments to service_role;
