-- Storage for work-order attachments. Bucket created in a migration (the
-- no-click-ops rule covers storage too). Private: every read is authorized.
--
-- Path convention: <work_order_id>/<attachment_id>.<ext> — exactly one folder
-- level, and the folder IS the work order id. Object authorization derives
-- from the path alone, independently re-checked against work_orders; neither
-- the metadata table nor the storage layer trusts the other.
--
-- Phase 3 upload flow: generate attachment id -> upload object -> insert
-- metadata row. A crash between the two leaves an orphaned object that nothing
-- renders (the app lists from metadata) — acceptable MVP debt. Postgres cannot
-- delete the physical object transactionally, so the Phase 3 server action
-- coordinates deletes: remove Storage API objects first, then delete metadata
-- or the work-order row with the service role. Authenticated clients receive no
-- direct delete surface on either layer.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-order-attachments',
  'work-order-attachments',
  false,
  10485760, -- 10 MiB per object
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Enforce the exact object name <work_order_id>/<attachment_id>.<ext> — the same
-- shape work_order_attachments.attachments_path_matches_row requires (lowercase-
-- uuid folder, lowercase-uuid basename, alphanumeric extension, exactly one
-- folder level). storage.foldername() drops the basename, so checking the folder
-- alone let <wo-uuid>/photo.jpg — a valid folder with a non-UUID basename —
-- through, yet no metadata row can ever reference it (its id must equal the
-- basename UUID). Uploads precede the metadata insert and clients have no object-
-- delete surface, so such a name would orphan forever. Matching the two regexes
-- makes an object insertable here IFF a metadata row could reference it, refusing
-- the orphan up front. The whole-name regex (checked before the ::uuid cast, so
-- junk paths still get clean denials not cast errors) also fixes the single
-- folder level, so no separate array_length check is needed;
-- can_access_work_order() then requires the folder to name a REAL work order the
-- caller can reach — for a vendor, one currently assigned to them.
create policy wo_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-order-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-zA-Z0-9]+$'
    and public.can_access_work_order(((storage.foldername(name))[1])::uuid)
  );

create policy wo_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-order-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-zA-Z0-9]+$'
    and public.can_access_work_order(((storage.foldername(name))[1])::uuid)
  );

-- Deliberately NO update policy (objects are immutable — no overwrites or
-- upserts; a new version is a new attachment id) and NO delete policy: object
-- deletes are service-role-only via the Phase 3 server action, coordinated
-- with the metadata row (see the coordinated-delete note in the attachments
-- migration). A client-side object delete would strand metadata pointing at
-- a 404 — the mirror image of the unlisted-but-fetchable hole.
