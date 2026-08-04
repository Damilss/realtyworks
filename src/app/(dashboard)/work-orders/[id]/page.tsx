import type { Metadata } from "next";
import Link from "next/link";

import { ActivityTrail } from "@/components/features/work-orders/activity-trail";
import { AttachmentList } from "@/components/features/work-orders/attachment-list";
import {
  PRIORITY_LABEL,
  PRIORITY_VARIANT,
  STATUS_LABEL,
} from "@/components/features/work-orders/labels";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile, isStaff } from "@/server/queries/session";
import { listVendors } from "@/server/queries/vendors";
import {
  getWorkOrder,
  listWorkOrderActivity,
  listWorkOrderAttachments,
} from "@/server/queries/work-orders";

import { AddNoteForm } from "./add-note-form";
import { AssignVendorForm } from "./assign-vendor-form";
import { AttachmentUpload } from "./attachment-upload";
import { InviteVendorPanel } from "./invite-vendor-panel";
import { StatusForm } from "./status-form";

export const metadata: Metadata = {
  title: "Work order · RealtyWorks",
};

/** `params` is a Promise in Next 16 — it must be awaited, not destructured. */
export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The gate, in the page rather than the layout: Partial Rendering means a
  // layout check stops running on client-side navigation between siblings.
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">Account not set up</h1>
          <CardDescription>
            You are signed in, but this account has no profile. Sign out and
            contact an administrator.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const staff = isStaff(profile);

  // getWorkOrder() 404s when RLS returns no row, so an unassigned vendor never
  // gets past this line. Vendors are fetched only for the assign control, which
  // only staff see — `vendors_select_staff_or_self` would hand a vendor just
  // their own row anyway.
  const [workOrder, activity, attachments, vendors] = await Promise.all([
    getWorkOrder(id),
    listWorkOrderActivity(id),
    listWorkOrderAttachments(id),
    staff ? listVendors() : Promise.resolve([]),
  ]);

  // The assigned vendor, and only them: `guard_work_order_update()` restricts
  // the status choices by role, and this decides whether to offer the control at
  // all. Not a gate — the trigger is — just a reason not to render a form the
  // database would refuse.
  const isAssignedVendor =
    !staff &&
    workOrder.vendorId !== null &&
    workOrder.vendorId === profile.vendorId;

  const assignedVendor =
    workOrder.vendorId === null
      ? undefined
      : vendors.find((vendor) => vendor.id === workOrder.vendorId);

  const location = [workOrder.propertyName, workOrder.unitLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          <Link href="/dashboard" className="underline underline-offset-4">
            Work orders
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {workOrder.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{STATUS_LABEL[workOrder.status]}</Badge>
          <Badge variant={PRIORITY_VARIANT[workOrder.priority]}>
            {PRIORITY_LABEL[workOrder.priority]}
          </Badge>
          {location ? (
            <span className="text-muted-foreground text-sm">{location}</span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <p className="whitespace-pre-wrap">
                {workOrder.description ?? "No description."}
              </p>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted-foreground text-xs">Vendor</dt>
                  <dd>{workOrder.vendorName ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Due</dt>
                  <dd>{workOrder.dueDate ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
              <CardDescription>
                Photos and receipts for this job. Links expire after a few
                minutes — reload the page for fresh ones.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <AttachmentList attachments={attachments} />
              <div className="border-t pt-4">
                <AttachmentUpload workOrderId={workOrder.id} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                Every change to this work order, oldest first. Entries cannot be
                edited or removed.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <ActivityTrail entries={activity} />
              <AddNoteForm workOrderId={workOrder.id} />
            </CardContent>
          </Card>
        </div>

        {staff ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
              <CardDescription>
                Assigning a vendor gives them access to this work order — and
                only this one.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {vendors.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No vendors have been added yet.
                </p>
              ) : (
                <AssignVendorForm
                  workOrderId={workOrder.id}
                  vendors={vendors}
                  currentVendorId={workOrder.vendorId}
                />
              )}

              {/* Only once someone is assigned: the link deep-links this job,
                  and `can_access_work_order()` admits only the current
                  assignee — so an invite before assignment would land the
                  vendor on a 404 (docs/vendor-access.md §3b). */}
              {assignedVendor ? (
                <InviteVendorPanel
                  workOrderId={workOrder.id}
                  vendorId={assignedVendor.id}
                  vendorName={assignedVendor.name}
                  invited={assignedVendor.profileId !== null}
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {isAssignedVendor ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Your job</CardTitle>
              <CardDescription>
                Mark this as started or finished. Every change is recorded in
                the activity trail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StatusForm
                workOrderId={workOrder.id}
                currentStatus={workOrder.status}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
