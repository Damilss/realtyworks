<!-- Solo repo: this is the paper trail, not a gate. Strike rows that don't
     apply rather than deleting them, so the record shows they were considered.
     An unticked box means "not done" — don't tick to be tidy. -->

## What & why

<!-- Two sentences. The diff already shows what changed — say why it changed. -->

<!-- `Refs`, not `Closes`. Closing keywords in a PR description are interpreted
     ONLY when the PR targets the default branch: "If the pull request targets
     any other branch, then these keywords are ignored, no links are created,
     and merging the PR has no effect on the issues." Most PRs here target
     `dev`, so `Closes` would silently do nothing. Put the closing keyword in
     the COMMIT message instead — that fires when the commit reaches `main`. -->

Refs #

## How I verified

<!-- The command or click-path you actually ran. Not "tested locally". -->

## Checklist

<!-- Nothing here duplicates a CI gate. lint / format:check / typecheck / test /
     build / audit / Playwright / gitleaks / Semgrep / pgTAP all block the merge
     on their own — a box claiming you ran them buys nothing. These four are
     rules no gate enforces. -->

- [ ] Ran the full gate locally first: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm audit --audit-level=high`
- [ ] Security, money, and data-integrity logic is enforced **server-side** — RLS, server action, or DB constraint. The client may mirror it for UX and is never the source of truth (`CLAUDE.md` §2)
- [ ] **Schema touched?** New timestamped forward migration (never an edit to one already on `main`), RLS in the same file, `pnpm exec supabase test db` green, `src/lib/database.types.ts` regenerated — not hand-edited
- [ ] Docs this makes wrong are updated: `README.md` · `CLAUDE.md` · `docs/` · `docs/backlog.md`
