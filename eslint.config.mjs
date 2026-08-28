import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// CLAUDE.md §3: `src/server/` is the trust boundary, with one deliberate seam.
// `src/server/actions/**` is *meant* to be imported by client components —
// `"use server"` swaps the body for an RPC reference, so the implementation
// never ships — which is why this rule targets `src/server/queries/**` alone.
// Blocking all of `@/server/*` would fail lint on the login form.
//
// Those modules already open with `import "server-only"`, so a runtime import
// from client code fails the *build*. This moves the same failure to lint,
// where the message names the boundary instead of a package resolution error.
const serverQueriesBoundary = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow runtime imports of `@/server/queries/**` from a "use client" module',
    },
    schema: [],
    messages: {
      runtimeImport:
        'A "use client" module cannot import runtime code from "{{source}}" — ' +
        "src/server/queries/** is server-only (CLAUDE.md §3). Use `import type` " +
        "for a type, or fetch in a server component and pass the data down as a prop.",
    },
  },
  create(context) {
    let isClientModule = false;

    return {
      Program(node) {
        isClientModule = node.body.some(
          (statement) =>
            statement.type === "ExpressionStatement" &&
            (statement.directive === "use client" ||
              (statement.expression.type === "Literal" &&
                statement.expression.value === "use client")),
        );
      },
      ImportDeclaration(node) {
        if (!isClientModule) return;
        if (typeof node.source.value !== "string") return;
        if (!/^@\/server\/queries(\/|$)/.test(node.source.value)) return;
        // `import type { X } from` and `import { type X } from` are both erased
        // before the module ever reaches a bundle. A bare side-effect import
        // has no specifiers and is not erased, so it still reports.
        if (node.importKind === "type") return;
        if (
          node.specifiers.length > 0 &&
          node.specifiers.every((specifier) => specifier.importKind === "type")
        ) {
          return;
        }
        context.report({
          node,
          messageId: "runtimeImport",
          data: { source: node.source.value },
        });
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Triple-slash reference shim (like next-env.d.ts); the TS triple-slash
    // lint rule would otherwise flag it.
    "vitest.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      realtyworks: {
        rules: { "no-server-queries-in-client": serverQueriesBoundary },
      },
    },
    rules: { "realtyworks/no-server-queries-in-client": "error" },
  },
]);

export default eslintConfig;
