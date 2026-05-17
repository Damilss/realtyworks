import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live next to the code or under tests/unit/ (see CLAUDE.md §5).
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
