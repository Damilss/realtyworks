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

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create an account · RealtyWorks",
};

export default async function SignupPage() {
  if (await getSession()) {
    redirect("/dashboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          New accounts start without access. An administrator connects yours
          once it exists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter>
        <p className="text-muted-foreground text-sm">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-foreground font-medium underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
