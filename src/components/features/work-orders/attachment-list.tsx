import { Badge } from "@/components/ui/badge";
import type { WorkOrderAttachment } from "@/server/queries/work-orders";

const KIND_LABEL: Record<WorkOrderAttachment["kind"], string> = {
  photo: "Photo",
  receipt: "Receipt",
  invoice: "Invoice",
  document: "Document",
};

function formatSize(bytes: number | null): string {
  if (bytes === null) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({
  attachments,
}: {
  attachments: WorkOrderAttachment[];
}) {
  if (attachments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Nothing attached yet.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Badge variant="outline">{KIND_LABEL[attachment.kind]}</Badge>

          {attachment.url ? (
            <a
              href={attachment.url}
              target="_blank"
              // The URL is signed and short-lived, but it still points at a
              // private object; `noreferrer` keeps it out of the Referer header
              // of whatever the file links on to.
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              {attachment.fileName}
            </a>
          ) : (
            // A row whose URL could not be signed. Listing it unopenable is the
            // honest state — the file exists, this render just could not reach
            // it — and beats omitting it, which would read as "never uploaded".
            <span className="font-medium">{attachment.fileName}</span>
          )}

          <span className="text-muted-foreground">
            {formatSize(attachment.sizeBytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}
