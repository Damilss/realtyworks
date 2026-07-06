# Commit message cheat sheet

Quick reference for writing commits that pass this repo's gate. The rules are
enforced by **commitlint** (`commitlint.config.mjs`) via the `.husky/commit-msg`
hook on **every commit** — a bad message is rejected before it lands. This is
Conventional Commits with a repo-specific type list.

## The format

```
type(optional-scope): subject

optional body — what & why, wrap at 100 cols

optional footer(s) — BREAKING CHANGE:, Refs #123, Co-Authored-By:
```

Minimum viable commit is just `type: subject` (e.g. `docs: fix typo in README`).
Scope, body, and footer are optional.

## Allowed types

Only these types pass (`type-enum`). Standard Conventional Commits set, **minus**
the retired `CI/CD` (use `ci`), **plus** `deps` and `wip`.

| Type | Use for | Example |
| --- | --- | --- |
| `feat` | A new user-facing feature | `feat(work-orders): add status filter` |
| `fix` | A bug fix | `fix(auth): refresh session on expiry` |
| `docs` | Docs only — no code change | `docs: add commit cheat sheet` |
| `test` | Adding/adjusting tests only | `test: cover work-order transitions` |
| `refactor` | Code change that neither fixes a bug nor adds a feature | `refactor: extract query helper` |
| `perf` | A change that improves performance | `perf: memoize vendor lookup` |
| `style` | Formatting/whitespace, no logic change | `style: run prettier` |
| `build` | Build system / tooling (not CI, not deps) | `build: switch to next.config.ts` |
| `ci` | CI config & workflows (`.github/workflows/…`) | `ci: run gates on dev` |
| `deps` | Dependency bumps (also what Dependabot uses) | `deps: bump next to 16.2.6` |
| `chore` | Housekeeping that fits nothing above | `chore: untrack pnpm store` |
| `revert` | Reverting a previous commit | `revert: "feat: add status filter"` |
| `wip` | Local work-in-progress checkpoint | `wip: sketch vendor form` |

> ⚠️ **`wip` caveat:** this repo merges with **merge commits**, so a `wip`
> commit that isn't squashed away **persists in `main`'s history**. Use it for
> local checkpoints, then squash/reword before it reaches a PR.

**Which type when it's ambiguous:**
- Touched `.github/workflows/**` → `ci`. Touched `package.json`/lockfile deps →
  `deps`. Other tooling/config (eslint, tsconfig, husky) → `build` or `chore`.
- Bug fix vs refactor: did behavior change for a user? Yes → `fix`. No → `refactor`.
- New capability → `feat`. Anything docs-only (including this file) → `docs`.

## Rules commitlint enforces

Severity **2** = blocking (commit rejected). Severity **1** = warning (allowed,
but nagged). All inherited from `@commitlint/config-conventional` except the type
list.

| Rule | Requirement | Blocking? |
| --- | --- | --- |
| `type-enum` | Type must be one of the list above | ✅ yes |
| `type-empty` | Type is required | ✅ yes |
| `type-case` | Type must be **lower-case** (`feat`, not `Feat`) | ✅ yes |
| `subject-empty` | Subject is required | ✅ yes |
| `subject-full-stop` | Subject must **not** end in `.` | ✅ yes |
| `subject-case` | Subject must **not** be Sentence-case, Start-Case, PascalCase, or UPPER-CASE | ✅ yes |
| `header-max-length` | Header (`type(scope): subject`) ≤ **100** chars | ✅ yes |
| `body-max-line-length` | Each body line ≤ **100** chars | ✅ yes |
| `footer-max-line-length` | Each footer line ≤ **100** chars | ✅ yes |
| `body-leading-blank` | Blank line between subject and body | ⚠️ warning |
| `footer-leading-blank` | Blank line before the footer | ⚠️ warning |

Note on `subject-case`: it *forbids* those specific cases rather than *requiring*
lower-case — so `fix: Handle null vendor` fails (Sentence-case) but a subject
starting with a proper noun/identifier like `fix: NULL check on vendor_id` is
fine. Easiest safe habit: **write subjects in plain lower-case.**

## Tips

- **Imperative mood**, present tense: "add", "fix", "remove" — not "added" /
  "adds" / "fixing". Read it as *"if applied, this commit will `<subject>`."*
- **Subject = the what, body = the why.** The body is where the paper trail lives
  (`CLAUDE.md` §5) — explain the reasoning, not the diff. The diff already shows
  *what* changed.
- **Scope is optional but cheap signal** — a lowercase noun for the area touched:
  `feat(work-orders):`, `fix(supabase):`, `ci(osv):`.
- **Breaking changes:** append `!` after the type/scope **and/or** add a
  `BREAKING CHANGE:` footer:
  ```
  feat(api)!: drop legacy work-order shape

  BREAKING CHANGE: `status` is now an enum, not a free string.
  ```
- **Reference issues/PRs** in the footer: `Refs #24`, `Closes #52`.
- **Keep the header short** — aim well under 100; if you need more, that's what
  the body is for.

## Examples

Good:
```
feat(work-orders): assign a vendor to an open order
fix(auth): stop redirect loop when session cookie is stale
ci: run CI and security gates on dev, OSV on PRs into main
deps: bump @supabase/ssr to 0.6.1
docs: add roadbump report for the vite audit-gate peer-dep fight
```

Rejected, and why:
```
Fix: handle null vendor        # type must be lower-case → use `fix:`
feat: Add filter.              # Sentence-case subject + trailing full-stop
update readme                  # missing a type
chore/CI: tweak workflow       # `CI/CD`-style type is retired → use `ci:`
```

## See also

- `commitlint.config.mjs` — the actual config (source of truth).
- [`docs/tooling.md`](tooling.md) — the full gate stack, including the commit-msg hook.
- [Conventional Commits](https://www.conventionalcommits.org/) — the upstream spec.
