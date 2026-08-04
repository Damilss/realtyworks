import { STATUS_LABEL } from "@/components/features/work-orders/labels";
import type { Enums } from "@/lib/database.types";
import type { ActivityEntry } from "@/server/queries/work-orders";

/**
 * The audit trail, rendered. "Who changed what, when" has to be answerable from
 * our own database (CLAUDE.md §5), which means this view is a product feature
 * and not a debug panel — every entry gets a sentence, not a jsonb dump.
 *
 * The trail is append-only for everyone (no UPDATE/DELETE policy, no grant, and
 * a forbid trigger), so there is deliberately no edit or delete affordance here.
 */

/**
 * Server-rendered only, so there is no hydration mismatch to worry about — but
 * it does mean timestamps are formatted in the *server's* timezone. Per-user
 * timezones are Phase 5 polish; until then this is at least consistent for
 * everyone looking at the same record.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function statusLabel(status: string | undefined): string {
  if (!status) {
    return "unknown";
  }
  // The trail can outlive an enum value, so this reads the map rather than
  // indexing it blindly.
  return STATUS_LABEL[status as Enums<"work_order_status">] ?? status;
}

function describe(entry: ActivityEntry): string {
  switch (entry.action) {
    case "created":
      return "created this work order";
    case "status_changed":
      return `changed status from ${statusLabel(entry.from.status)} to ${statusLabel(entry.to.status)}`;
    case "vendor_assigned":
      if (entry.to.vendorName && entry.from.vendorName) {
        return `reassigned this from ${entry.from.vendorName} to ${entry.to.vendorName}`;
      }
      if (entry.to.vendorName) {
        return `assigned ${entry.to.vendorName}`;
      }
      if (entry.from.vendorName) {
        return `unassigned ${entry.from.vendorName}`;
      }
      return "changed the assigned vendor";
    case "attachment_added":
      return entry.to.fileName
        ? `uploaded ${entry.to.fileName}`
        : "uploaded an attachment";
    case "note_added":
      return "added a note";
  }
}

export function ActivityTrail({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing has happened on this work order yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 pl-4">
          <p className="text-sm">
            <span className="font-medium">{entry.actorName}</span>{" "}
            {describe(entry)}
          </p>

          {entry.note ? (
            <p className="mt-1 text-sm whitespace-pre-wrap">{entry.note}</p>
          ) : null}

          <time
            dateTime={entry.createdAt}
            className="text-muted-foreground mt-1 block text-xs"
          >
            {TIMESTAMP_FORMAT.format(new Date(entry.createdAt))}
          </time>
        </li>
      ))}
    </ol>
  );
}
