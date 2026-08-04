import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentProfile, isStaff } from "@/server/queries/session";
import { listVendorRows } from "@/server/queries/vendors";

import { VendorForm } from "./vendor-form";

export const metadata: Metadata = {
  title: "Vendors · RealtyWorks",
};

export default async function VendorsPage() {
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

  // A vendor reaching this URL would see exactly one row — their own, via the
  // `or profile_id = auth.uid()` arm of `vendors_select_staff_or_self` — and a
  // create form the `vendors_insert_staff` policy would refuse. Saying so beats
  // rendering a page that half works.
  if (!isStaff(profile)) {
    return (
      <Card>
        <CardHeader>
          <h1 className="leading-none font-semibold">Not available</h1>
          <CardDescription>
            Only landlords and managers can manage vendors.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const vendors = await listVendorRows();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
        <p className="text-muted-foreground text-sm">
          Contact records. A vendor gets access only when you assign them a work
          order and send them a link from it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {vendors.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No vendors yet</CardTitle>
                <CardDescription>
                  Add one to be able to assign work orders.
                </CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Access</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map((vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium">
                        {vendor.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {vendor.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {vendor.phone ?? "—"}
                      </TableCell>
                      <TableCell>
                        {/* `profile_id` is the whole access story: set means an
                            account exists and is linked, null means every
                            vendor-scoped policy arm returns nothing for them. */}
                        <Badge
                          variant={vendor.profileId ? "secondary" : "outline"}
                        >
                          {vendor.profileId ? "Invited" : "Not invited"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add a vendor</CardTitle>
            <CardDescription>
              A name plus either an email address or a phone number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VendorForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
