# Playwright (E2E testing)

End-to-end tests for RealtyWorks. Playwright drives a real browser against the
running app to verify user-facing behavior.

**Phase 1 scope:** install + a single smoke test only. Real flows and a CI job
arrive with the Phase 3 vertical slice — see `CLAUDE.md` §4. For now E2E runs
**locally only** and is not part of the CI gate.

---

## Prerequisites

- Node **24** (`nvm use` — reads `.nvmrc`)
- **pnpm** (`pnpm@9.15.9`). Do **not** use `npm init playwright` — it writes a
  `package-lock.json`, adds example tests, and drops in its own GitHub Actions
  workflow, none of which we want.

## Installation

Two separate steps — the library and the browser binaries are installed
independently:

```bash
pnpm add -D @playwright/test          # the test runner/library (devDependency)
pnpm exec playwright install chromium # downloads the Chromium binary into Playwright's cache
```

The browsers do **not** live in `node_modules`; `playwright install` fetches
them into a separate Playwright cache. We pin to `chromium` to keep the download
small. To add more engines later:

```bash
pnpm exec playwright install firefox webkit
```

## Running the tests

```bash
pnpm test:e2e            # run all E2E tests (script in package.json)
```

You do **not** need to start the dev server yourself. `playwright.config.ts`
has a `webServer` block that boots `pnpm dev` automatically, waits for
`http://localhost:3000`, runs the tests, then shuts it down. (If a dev server is
already running locally, Playwright reuses it.)

Useful variants:

```bash
pnpm exec playwright test --ui              # interactive UI mode (great for debugging)
pnpm exec playwright test --headed          # watch the real browser
pnpm exec playwright test --debug           # step through with the inspector
pnpm exec playwright test smoke             # filter by test file name/path
pnpm exec playwright test -g "home page"    # filter by test title (--grep)
pnpm exec playwright show-report            # open the HTML report from the last run
```

## Where things live

```
playwright.config.ts        # config: testDir, baseURL, browser, webServer auto-boot
tests/e2e/                  # E2E specs (*.spec.ts)
tests/e2e/smoke.spec.ts     # the current smoke test (app boots + serves a page)
```

Test runners stay separated by directory: **Vitest** collects `src/**` and
`tests/unit/**` (`vitest.config.ts`); **Playwright** owns `tests/e2e/`. They
never collect each other's files.

Playwright's generated output (`test-results/`, `playwright-report/`,
`blob-report/`, `playwright/.cache/`) is gitignored.

## Writing a test

```ts
import { test, expect } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/"); // resolved against baseURL (localhost:3000)
  await expect(page).toHaveTitle(/.+/);
});
```

## Troubleshooting

- **`Cannot find module '@playwright/test'`** — run `pnpm add -D @playwright/test`.
  (This also makes `pnpm typecheck` fail until installed, since the config/specs
  import the package.)
- **`Executable doesn't exist ...` / browser missing** — run
  `pnpm exec playwright install chromium`. Installing the npm package alone does
  not download browsers.
- **Hangs on "waiting for localhost:3000"** — the dev server is slow to boot on
  first run; the config allows 120s. Confirm `pnpm dev` works on its own.
- **Wrong Node version** — `nvm use` to match `.nvmrc` (Node 24), the same
  version CI uses.

## CI

Intentionally **not** wired into CI yet. The CI job is
`lint → format:check → typecheck → test → build → audit` (Vitest only — no
Playwright step). E2E joins CI in Phase 3/4 once there are real flows to test.
See `CLAUDE.md` §4–§5.
