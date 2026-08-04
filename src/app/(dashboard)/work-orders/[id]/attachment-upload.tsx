"use client";

import { useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  attachmentPath,
  isAllowedMimeType,
} from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { recordAttachment } from "@/server/actions/work-orders";

/**
 * The coordinated trusted upload path, browser half.
 *
 * This is the one form in the app that is not a plain POST to a server action,
 * and it is deliberate rather than an oversight. The bytes go **straight from
 * the browser to Storage** under the user's own session, so a phone on a bad
 * connection uploading a 9 MB photo never streams it through a serverless
 * function. Only the metadata row is a server-side write, because
 * `work_order_attachments` has no client INSERT grant — see `recordAttachment`.
 *
 * The consequence is that this control needs JavaScript, unlike every other
 * form here. Nothing else does, and nothing else should.
 */
export function AttachmentUpload({ workOrderId }: { workOrderId: string }) {
  const [error, setError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const busy = uploading || pending;

  async function upload(formData: FormData) {
    setError(undefined);

    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "photo");

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file first.");
      return;
    }

    // Both of these are enforced by the bucket (`allowed_mime_types` and
    // `file_size_limit`); checking here only saves the user a failed upload of
    // a large file, and gives a sentence instead of a storage API error.
    if (!isAllowedMimeType(file.type)) {
      setError("Upload a JPEG, PNG, WebP, HEIC, or PDF.");
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("That file is larger than 10 MB.");
      return;
    }

    setUploading(true);

    try {
      // Generated here, before the upload, because it IS the object name — and
      // then the metadata row's primary key, which is what ties the two
      // together. `crypto.randomUUID()` emits lowercase, which the storage
      // policy's `[0-9a-f]` regex requires.
      const attachmentId = crypto.randomUUID();
      const path = attachmentPath({
        workOrderId,
        attachmentId,
        mimeType: file.type,
      });

      const supabase = createClient();

      // `upsert: false` matters: there is deliberately no storage UPDATE policy,
      // because objects are immutable — a new version is a new attachment id.
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });

      if (uploadError) {
        console.error("[attachments] Upload failed", uploadError);
        setError("That upload failed. Try again.");
        return;
      }

      // Only now does the file become visible to the app. If this fails the
      // action deletes the object it could not register, so a failure here
      // leaves nothing behind.
      const result = await recordAttachment({
        workOrderId,
        attachmentId,
        storagePath: path,
        fileName: file.name,
        kind: kind === "receipt" ? "receipt" : "photo",
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      formRef.current?.reset();
      // revalidatePath() marks the cache stale; this is what makes the current
      // page actually re-render with the new attachment and trail entry.
      startTransition(() => router.refresh());
    } finally {
      setUploading(false);
    }
  }

  return (
    <form ref={formRef} action={upload} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">Add a photo or receipt</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept={ATTACHMENT_ACCEPT}
          required
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="kind">Type</Label>
        <NativeSelect
          id="kind"
          name="kind"
          defaultValue="photo"
          disabled={busy}
        >
          <option value="photo">Photo</option>
          <option value="receipt">Receipt</option>
        </NativeSelect>
      </div>

      <FormError message={error} />

      <div>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}
