-- work_order_attachments: metadata rows; the files live in Supabase Storage
-- (bucket + object policies in the next migration). Receipts are attachments
-- with kind='receipt' — deliberately NOT a line-items/ledger table
-- (docs/vendor-access.md §4; the ledger is Phase 6).
--
-- id is generated client-side BEFORE upload and becomes the object name, so
-- the path CHECK below ties every metadata row to its own work order's storage
-- prefix — a row can never point at another work order's object. It has NO
-- database default on purpose: a server-generated id would never match the
-- UUID already baked into the client's storage_path, so the metadata insert
-- would fail the path CHECK *after* the object was uploaded and orphan it. With
-- no default the generated Insert type marks id required, surfacing the
-- contract at compile time instead of at runtime.

create table public.work_order_attachments (
  id uuid primary key,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  kind public.attachment_kind not null default 'photo',
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 255),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Enforce the exact documented invariant <work_order_id>/<attachment_id>.<ext>
  -- — not just the prefix. Blocks nested paths and rows whose object name
  -- doesn't match their own id, so metadata can never point at another row's
  -- (or another work order's) object.
  constraint attachments_path_matches_row
    check (storage_path ~ ('^' || work_order_id::text || '/' || id::text || '\.[a-zA-Z0-9]+$'))
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

-- NO client INSERT surface. Attachment metadata is written ONLY by the
-- coordinated Phase 3 upload server action, using the service_role (which
-- bypasses RLS — so no insert policy is needed), mirroring the coordinated
-- delete surface below. The client still uploads the OBJECT itself (the storage
-- wo_attachments_insert policy in the next migration), but the metadata row is
-- inserted server-side only AFTER that object is confirmed. A client therefore
-- can never insert a correctly shaped metadata row with no object behind it —
-- the orphan that would 404 on download, emit an immutable attachment_added
-- activity entry, and be undeletable through any client surface. This keeps the
-- file bytes on the direct-to-storage path (never proxied through the function)
-- while making the row a server-only write: the "coordinated trusted upload
-- path." The server action must pass uploaded_by explicitly — under the service
-- role auth.uid() (the column default) is null; log_attachment_added() already
-- coalesces to new.uploaded_by, so the activity actor stays correct.

-- Staff may fix a mis-categorized kind — the update grant carries ONLY `kind`,
-- so this policy can't reach anything else.
create policy attachments_update_staff on public.work_order_attachments
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- NO client DELETE surface — not even landlord. A client-side metadata delete
-- can't be coordinated with the object: Postgres cannot remove the object row
-- transactionally (storage.protect_delete() forbids direct SQL deletes on
-- storage.objects — Storage API only), so deleting metadata alone would
-- unlist the attachment while the file stayed fetchable by path for anyone
-- with work-order access. Deletes are therefore the Phase 3 server action's
-- job: storage-API object delete first (service key), then the metadata row
-- (service_role bypasses RLS — no policy needed). Work-order hard deletes
-- still cascade these rows; those objects become unfetchable immediately
-- (path authorization derives from the now-deleted work order) and the
-- WO-delete server action removes the physical objects before deleting the row.

grant select on public.work_order_attachments to authenticated;
-- deliberately NO client insert grant — metadata is a service-role-only write
-- via the coordinated upload action (see the insert note above).
grant update (kind) on public.work_order_attachments to authenticated;
-- deliberately NO delete grant — see the coordinated-delete note above.
grant all on public.work_order_attachments to service_role;
