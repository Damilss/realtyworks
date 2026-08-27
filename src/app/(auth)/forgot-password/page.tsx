import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/server/queries/session";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password · RealtyWorks",
};

export default async function ForgotPasswordPage() {
  if (await getSession()) {
    redirect("/dashboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we will send a secure setup link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
      <CardFooter>
        <Link
          href="/login"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
