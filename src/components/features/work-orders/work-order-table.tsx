import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Enums } from "@/lib/database.types";
import type { WorkOrderListItem } from "@/server/queries/work-orders";

/**
 * Only `urgent` and `high` earn a loud treatment — badging every row the same
 * weight would make the column decorative instead of informative.
 */
const PRIORITY_VARIANT: Record<
  Enums<"work_order_priority">,
  "default" | "secondary" | "destructive" | "outline"
> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

const STATUS_LABEL: Record<Enums<"work_order_status">, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatLocation(workOrder: WorkOrderListItem) {
  // A work order may be property-level, with no unit.
  return [workOrder.propertyName, workOrder.unitLabel]
    .filter(Boolean)
    .join(" · ");
}

export function WorkOrderTable({
  workOrders,
}: {
  workOrders: WorkOrderListItem[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workOrders.map((workOrder) => (
            <TableRow key={workOrder.id}>
              <TableCell className="font-medium">{workOrder.title}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatLocation(workOrder) || "—"}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {STATUS_LABEL[workOrder.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={PRIORITY_VARIANT[workOrder.priority]}>
                  {workOrder.priority}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {workOrder.vendorName ?? "Unassigned"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {workOrder.dueDate ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
