/**
 * The upload contract, shared by the browser uploader and the server action
 * that records the metadata.
 *
 * It lives in `src/lib/` rather than `src/server/` because the client genuinely
 * needs it: in the coordinated upload path the *object* goes straight from the
 * browser to Storage under the user's own session, and only the metadata row is
 * a server-side write. None of this is a security boundary — the bucket's
 * `allowed_mime_types` and `file_size_limit`, the `wo_attachments_insert`
 * policy, and `attachments_path_matches_row` are
 * (`20260717120800_create_storage_bucket.sql`). These constants exist so the
 * browser refuses obvious mistakes before spending an upload on them.
 */

/** Created in a migration, never through the dashboard (CLAUDE.md §5). */
export const ATTACHMENTS_BUCKET = "work-order-attachments";

/** `file_size_limit` on the bucket: 10 MiB per object. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The bucket's `allowed_mime_types`, mapped to the extension the object name
 * will carry.
 *
 * The extension is derived from the **MIME type, not the filename**. A filename
 * is user-supplied and need not have an extension at all, let alone one matching
 * `[a-zA-Z0-9]+` — and the storage policy's regex requires exactly that, so a
 * file called `photo` or `receipt.tar.gz` would be rejected *after* the bytes
 * were uploaded. Going through this map means the name is always well formed.
 */
export const ATTACHMENT_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
} as const;

export type AttachmentMimeType = keyof typeof ATTACHMENT_EXTENSIONS;

/** The `accept` attribute for the file input, kept in step with the bucket. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_EXTENSIONS).join(",");

export function isAllowedMimeType(
  mimeType: string,
): mimeType is AttachmentMimeType {
  return mimeType in ATTACHMENT_EXTENSIONS;
}

/**
 * `<work_order_id>/<attachment_id>.<ext>` — exactly one folder level, and the
 * folder IS the work order. Object authorization derives from that path alone,
 * so this shape is the whole reason a vendor can reach their own job's files and
 * nobody else's.
 */
export function attachmentPath({
  workOrderId,
  attachmentId,
  mimeType,
}: {
  workOrderId: string;
  attachmentId: string;
  mimeType: AttachmentMimeType;
}): string {
  return `${workOrderId}/${attachmentId}.${ATTACHMENT_EXTENSIONS[mimeType]}`;
}
