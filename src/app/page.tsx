import { redirect } from "next/navigation";

/**
 * The app has no marketing surface — `/` is just the entry point. It sends
 * callers to the dashboard, which redirects to /login when there is no session.
 *
 * Keeping the hop here (rather than making `/` the dashboard) is what lets the
 * Phase 5 PWA point `start_url` at `/` and still land a logged-out user on the
 * login screen instead of an error (docs/pwa.md).
 */
export default function RootPage() {
  redirect("/dashboard");
}
