import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions/auth";
import { getCurrentProfile, isStaff } from "@/server/queries/session";

/**
 * The authenticated app shell.
 *
 * `getCurrentProfile()` calls `requireSession()`, so an unauthenticated request
 * is redirected here too — but that is a convenience, not the gate. Layouts do
 * not re-render on client-side navigation, so each page performs its own check
 * (see src/server/queries/session.ts).
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const profile = await getCurrentProfile();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              RealtyWorks
            </Link>

            {/* Nav only, not a gate. `/vendors` performs its own check, and RLS
                is what actually decides — this link simply doesn't offer a
                vendor a page that would tell them no. */}
            {profile && isStaff(profile) ? (
              <nav className="flex items-center gap-4 text-sm">
                <Link
                  href="/dashboard"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Work orders
                </Link>
                <Link
                  href="/vendors"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Vendors
                </Link>
              </nav>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {profile ? (
              <>
                <span className="text-muted-foreground hidden text-sm sm:inline">
                  {profile.fullName ?? "Unnamed user"}
                </span>
                <Badge variant="secondary">{profile.role}</Badge>
              </>
            ) : null}

            {/* A form POST, not a link: a GET logout gets fired by link
                prefetching and by anything that crawls the page. */}
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
