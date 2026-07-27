import type { Metadata } from "next";

import { WorkOrderTable } from "@/components/features/work-orders/work-order-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile, isStaff } from "@/server/queries/session";
import { listWorkOrders } from "@/server/queries/work-orders";

export const metadata: Metadata = {
  title: "Work orders · RealtyWorks",
};

export default async function DashboardPage() {
  // The gate. `getCurrentProfile()` calls `requireSession()`, which redirects an
  // unauthenticated caller to /login.
  const profile = await getCurrentProfile();

  // A live session with no profile row. Not a redirect to /login — the cookie is
  // still valid, so that would bounce straight back here and loop.
  if (!profile) {
    return (
      <Card>
        <CardHeader>
          {/* A real <h1> rather than <CardTitle>: shadcn's CardTitle is a
              styled <div>, and on a terminal state like this it is the whole
              content of the page — leaving it unheaded gives a screen-reader
              user nothing to navigate to. */}
          <h1 className="leading-none font-semibold">Account not set up</h1>
          <CardDescription>
            You are signed in, but this account has no profile. Sign out and
            contact an administrator.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // A self-registered user: role 'vendor', not yet linked to a vendors row. RLS
  // will return an empty list, which without this reads as a broken page rather
  // than an account awaiting setup.
  if (!isStaff(profile) && profile.vendorId === null) {
    return (
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">
            Your account isn&apos;t linked yet
          </h1>
          <CardDescription>
            An administrator needs to connect this account before you can see
            any work orders. Nothing is assigned to you yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const workOrders = await listWorkOrders();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Work orders</h1>
        <p className="text-muted-foreground text-sm">
          {isStaff(profile)
            ? "Every work order across all properties."
            : "Work orders assigned to you."}
        </p>
      </div>

      {workOrders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No work orders</CardTitle>
            <CardDescription>
              {isStaff(profile)
                ? "Nothing has been created yet."
                : "Nothing is assigned to you right now."}
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <WorkOrderTable workOrders={workOrders} />
      )}
    </div>
  );
}
