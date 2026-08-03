import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile, isStaff } from "@/server/queries/session";
import { listPropertiesWithUnits } from "@/server/queries/properties";

import { WorkOrderForm } from "./work-order-form";

export const metadata: Metadata = {
  title: "New work order · RealtyWorks",
};

export default async function NewWorkOrderPage() {
  // The gate. `getCurrentProfile()` calls `requireSession()`, which redirects an
  // unauthenticated caller to /login. Checked here rather than in the layout:
  // Partial Rendering means a layout check stops running on client-side
  // navigation between sibling routes.
  const profile = await getCurrentProfile();

  // Not a 404 and not a redirect: this is a real page the caller simply may not
  // use. `work_orders_insert_staff` would refuse the insert anyway — this only
  // saves them filling in a form that cannot succeed.
  if (!profile || !isStaff(profile)) {
    return (
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">Staff only</h1>
          <CardDescription>
            Only landlords and managers can create work orders.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const properties = await listPropertiesWithUnits();

  if (properties.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No properties yet</CardTitle>
          <CardDescription>
            A work order has to belong to a property. Add one before creating
            work.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          New work order
        </h1>
        <p className="text-muted-foreground text-sm">
          It starts as <span className="font-medium">open</span>; assign a
          vendor from the work order itself.
        </p>
      </div>

      <WorkOrderForm properties={properties} />

      <p className="text-muted-foreground text-sm">
        <Link href="/dashboard" className="underline underline-offset-4">
          Back to work orders
        </Link>
      </p>
    </div>
  );
}
