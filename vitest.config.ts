import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Lets tests import app code via the "@/*" alias, read straight from
  // tsconfig.json so there's a single source of truth (CLAUDE.md §5). Native
  // to Vite 8 — no vite-tsconfig-paths plugin needed.
  resolve: {
    tsconfigPaths: true,
    alias: {
      // See tests/unit/server-only-stub.ts for why this is aliased rather than
      // enabling the `react-server` resolve condition.
      // fileURLToPath, not .pathname: a URL path is not a filesystem path —
      // it keeps percent-encoding (a checkout under a directory with a space)
      // and the leading slash on a Windows drive letter (/C:/...).
      "server-only": fileURLToPath(
        new URL("./tests/unit/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "happy-dom",
    // Enables React Testing Library's automatic per-test cleanup().
    globals: true,
    setupFiles: ["./tests/unit/setup.ts"],
    // Unit tests live next to the code or under tests/unit/ (see CLAUDE.md §5).
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
    ],
    // Visibility, not a gate (issue #28) — deliberately no thresholds.
    coverage: {
      provider: "v8",
      // Report every source file, not only the ones a test already imports.
      // The default counts loaded modules, so a module with no test at all is
      // absent from the table entirely and the percentage describes the tests
      // rather than the app — the one number that cannot show what is untested.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Generated from the migrations; types only, no runtime to cover.
        "src/lib/database.types.ts",
        // Vendored shadcn/ui primitives — framework code, per CLAUDE.md §5
        // ("test what matters, not the framework").
        "src/components/ui/**",
      ],
      // text prints the table in CI logs; html is for reading locally.
      reporter: ["text", "html"],
    },
  },
});
