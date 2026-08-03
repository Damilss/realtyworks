import type { Enums } from "@/lib/database.types";

/**
 * Presentation for the work-order enums, in one place so the list, the detail
 * page, the activity trail, and the forms cannot drift into calling the same
 * status two different things.
 */

export const STATUS_LABEL: Record<Enums<"work_order_status">, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<Enums<"work_order_priority">, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/**
 * Only `urgent` and `high` earn a loud treatment — badging every row the same
 * weight would make the column decorative instead of informative.
 */
export const PRIORITY_VARIANT: Record<
  Enums<"work_order_priority">,
  "default" | "secondary" | "destructive" | "outline"
> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};
