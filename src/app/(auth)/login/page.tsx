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

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · RealtyWorks",
};

/**
 * The only value `/auth/confirm` ever redirects with. Matched exactly rather
 * than rendered, so a hand-written `?error=<anything>` cannot put arbitrary text
 * on the sign-in page.
 */
const INVALID_LINK = "invalid-link";

/** `searchParams` is a Promise in Next 16 — it must be awaited. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // In the page rather than the (auth) layout: Partial Rendering means a layout
  // check stops running once the user is navigating client-side.
  if (await getSession()) {
    redirect("/dashboard");
  }

  const { error } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter your email and password to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error === INVALID_LINK ? (
          <p className="text-destructive text-sm" role="alert">
            That link has expired or has already been used. Ask for a new one.
          </p>
        ) : null}
        <LoginForm />
        <Link
          href="/forgot-password"
          className="text-muted-foreground text-center text-sm underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </CardContent>
      <CardFooter>
        <p className="text-muted-foreground text-sm">
          Need an account?{" "}
          <Link
            href="/signup"
            className="text-foreground font-medium underline underline-offset-4"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
