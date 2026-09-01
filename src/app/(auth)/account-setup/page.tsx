import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile } from "@/server/queries/session";

import { AccountSetupForm } from "./account-setup-form";

export const metadata: Metadata = {
  title: "Finish account setup · RealtyWorks",
};

export default async function AccountSetupPage() {
  // This page is reached after /auth/confirm mints the session. Keeping the
  // check in the page (not the layout) makes client-side navigation re-run it.
  const profile = await getCurrentProfile();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish account setup</CardTitle>
        <CardDescription>
          Your email is verified. Confirm your details and choose the password
          you will use to sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AccountSetupForm
          initialValues={{
            fullName: profile?.fullName ?? "",
            phone: profile?.phone ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
