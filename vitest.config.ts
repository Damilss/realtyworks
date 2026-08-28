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
  },
});
