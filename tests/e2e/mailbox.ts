/**
 * Reads the local mail container, so a spec can follow a confirmation link the
 * way a real user would.
 *
 * The mailbox is **Mailpit**, not Inbucket — the CLI renamed both the service
 * and the config section (`[local_smtp]` in supabase/config.toml), and
 * `inbucket` survives only as a name `supabase start -x` silently ignores.
 *
 * The URL is a constant for the same reason `playwright.config.ts` hardcodes
 * `baseURL` — the port is pinned in `[local_smtp] port` — with an env override
 * for a stack on a different port. (`supabase status -o env` does print
 * `MAILPIT_URL`, but nothing wires that into Playwright's environment: the CI
 * job writes `.env.local`, which Next reads and the test runner does not.)
 *
 * Only reachable when the mail container is actually up. The CI `e2e` job boots
 * it deliberately — see the `-x` list in .github/workflows/ci.yml, which stopped
 * pretending to exclude it when email confirmations went on.
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Newest first, per Mailpit's default sort. */
type SearchResponse = { messages?: { ID: string }[] };
type MessageResponse = { HTML?: string; Text?: string };

async function mailpit(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${MAILPIT_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(
      `Mailpit ${init?.method ?? "GET"} ${path} failed: ${response.status}. ` +
        `Is the mail container up? \`pnpm exec supabase status\``,
    );
  }

  return response;
}

async function mailpitJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await mailpit(path, init);

  return (await response.json()) as T;
}

function search(email: string): Promise<SearchResponse> {
  return mailpitJson<SearchResponse>(
    `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
}

/**
 * Drops every message already addressed to `email`.
 *
 * `supabase db reset` empties `auth.users` but not the mailbox, so without this
 * a local re-run finds the *previous* run's mail first and follows a token that
 * has already been spent. CI never hits it — the container is new each time —
 * which is exactly the kind of flake that only ever reproduces on the machine
 * you are working on.
 */
export async function clearMailbox(email: string): Promise<void> {
  const { messages = [] } = await search(email);

  if (messages.length === 0) {
    return;
  }

  await mailpit("/api/v1/messages", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: messages.map((message) => message.ID) }),
  });
}

/**
 * The `/auth/confirm` URL out of the newest message addressed to `email`.
 *
 * Matched out of the body rather than parsed out of the markup: the template
 * (supabase/templates/confirmation.html) has exactly one link, and a regex over
 * the rendered output proves the *rendered* URL is right — including that
 * `{{ .TokenHash }}` interpolated — where parsing the template would not.
 */
async function findConfirmationLink(email: string): Promise<string | null> {
  const { messages = [] } = await search(email);

  for (const summary of messages) {
    const message = await mailpitJson<MessageResponse>(
      `/api/v1/message/${summary.ID}`,
    );
    const body = message.HTML || message.Text || "";
    const match = body.match(
      /https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+/,
    );

    if (match) {
      // No entity-decoding step: GoTrue renders the template as text, so the
      // `&` before `type=signup` arrives literal rather than as `&amp;`.
      // Checked against a real message, not assumed.
      return match[0];
    }
  }

  return null;
}

/**
 * Polls until the confirmation email for `email` arrives, and returns its link.
 *
 * Mail delivery is asynchronous — the signup response returns before GoTrue has
 * handed the message to the SMTP container — so there is nothing to await on the
 * page.
 */
export async function waitForAuthLink(
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const link = await findConfirmationLink(email);

    if (link) {
      return link;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `No auth email for ${email} reached Mailpit within ` +
          `${timeoutMs}ms. Check [auth.email] enable_confirmations and that ` +
          `the mail container is running.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
