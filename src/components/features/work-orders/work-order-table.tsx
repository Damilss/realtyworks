import Link from "next/link";

import {
  PRIORITY_LABEL,
  PRIORITY_VARIANT,
  STATUS_LABEL,
} from "@/components/features/work-orders/labels";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkOrderListItem } from "@/server/queries/work-orders";

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
              <TableCell className="font-medium">
                {/* The whole row is the target in spirit, but only the title is
                    a link: a <tr> cannot contain an <a> wrapping every cell
                    without producing invalid table markup. */}
                <Link
                  href={`/work-orders/${workOrder.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {workOrder.title}
                </Link>
              </TableCell>
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
                  {PRIORITY_LABEL[workOrder.priority]}
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
