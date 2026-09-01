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
 *
 * **Editing `supabase/templates/*.html` while the stack is running stops mail
 * entirely, and nothing says so.** The CLI bind-mounts each template as a single
 * *file* into Kong. Rewriting one on the host writes a new inode — which is what
 * an editor, `git checkout`, and a branch switch all do — while the container
 * keeps the old, now-unlinked one: `ls` still lists it, with a link count of 0,
 * and opening it fails. Kong then 404s, GoTrue logs
 * `templatemailer: ... status code 404`, and sends nothing, so every spec that
 * waits on a link times out against a mailbox that was never going to fill.
 *
 * `supabase db reset` does not fix it — it restarts containers but does not
 * recreate them, so the mount is rebuilt only by `supabase stop && supabase
 * start`. CI never sees this: it starts fresh containers from the committed
 * templates and never edits them mid-run. It is purely a local trap, and it
 * surfaces at the *next* restart rather than at the edit that caused it, which
 * is what makes it hard to attribute. Confirm it with
 * `docker logs supabase_auth_realtyworks | grep templatemailer`.
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
 * The `/auth/confirm` URL out of the newest message *currently* addressed to
 * `email` — see `waitForAuthLink` for why the qualifier is load-bearing.
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
 * Polls until an auth email for `email` is in the mailbox, and returns its link.
 *
 * There is nothing to await on the page: the message arrives over SMTP, so no UI
 * state reflects it.
 *
 * **This waits for a message to be present, not for the one the last step
 * triggered** — the two are the same claim only when the mailbox was empty to
 * begin with. Send a second link while an earlier one is still sitting there and
 * this returns the earlier one for as long as the new message is in flight, and
 * an earlier link is generally already dead: GoTrue keeps one token per flow
 * (`confirmation_token`, `recovery_token`) and rotates it on every send, so the
 * previous one verifies as 403 `otp_expired`. /auth/confirm turns that into
 * /login?error=invalid-link, which reaches the spec as a URL mismatch that says
 * nothing about mail.
 *
 * So the discipline is **clear, act, wait**: `clearMailbox()` before the step
 * that sends, and "newest present" and "the one this step sent" cannot diverge.
 * Every caller in auth.spec.ts does. The window is currently narrow — GoTrue
 * hands the message off before answering the request that triggered it, ~2-3ms
 * to searchable — but that is the mailer's behaviour, not a property of these
 * helpers, and custom SMTP makes the handoff a network call.
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
        `No auth email for ${email} reached Mailpit within ${timeoutMs}ms.\n` +
          `Causes, in the order worth checking:\n` +
          `  1. The mail container is not running — \`pnpm exec supabase status\`.\n` +
          `  2. [auth.email] enable_confirmations is off in supabase/config.toml.\n` +
          `  3. The email templates are stale-mounted, so GoTrue is sending ` +
          `nothing at all — see the template-mount note in this file's header. ` +
          `Confirm with ` +
          `\`docker logs supabase_auth_realtyworks | grep templatemailer\`; if ` +
          `that shows a 404, \`supabase stop && supabase start\`.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
