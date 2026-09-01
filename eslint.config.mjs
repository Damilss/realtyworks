import path from "node:path";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Mirrors the `@/* -> ./src/*` mapping in tsconfig.json. Resolving specifiers
// instead of matching their text is what lets one check cover every spelling of
// the same module — `@/server/queries/x` and `../../server/queries/x` are the
// same file, and only one of them used to be caught.
const SRC_DIR = path.join(import.meta.dirname, "src");
const SERVER_QUERIES_DIR = path.join(SRC_DIR, "server", "queries");

/**
 * Does `specifier`, written in `filename`, resolve inside src/server/queries?
 *
 * Bare package specifiers are never ours, so they resolve to nothing here.
 */
function resolvesIntoServerQueries(specifier, filename) {
  let resolved;

  if (specifier.startsWith("@/")) {
    resolved = path.resolve(SRC_DIR, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    resolved = path.resolve(path.dirname(path.resolve(filename)), specifier);
  } else {
    return false;
  }

  const relative = path.relative(SERVER_QUERIES_DIR, resolved);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

// CLAUDE.md §3: `src/server/` is the trust boundary, with one deliberate seam.
// `src/server/actions/**` is *meant* to be imported by client components —
// `"use server"` swaps the body for an RPC reference, so the implementation
// never ships — which is why this rule targets `src/server/queries/**` alone.
// Blocking all of `@/server/*` would fail lint on the login form.
//
// Those modules already open with `import "server-only"`, so pulling one into
// client code fails the *build* — verified, including through a dynamic
// `import()`. This rule is therefore not the boundary; it moves the same failure
// forward to lint, where the message names the boundary instead of arriving as a
// package resolution error with an import trace.
//
// Which is why it has to cover every shape that reaches the module, not just the
// one spelling anyone had in mind. A check on `ImportDeclaration` nodes whose
// source text starts with `@/server/queries` silently misses a relative
// specifier, a dynamic `import()`, `export ... from`, `export * from`, and
// `require()` — all of which bundle the module exactly as a static import does.
// Each is covered below, and each has a test that fails when its handler is
// removed.
const serverQueriesBoundary = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow runtime references to `src/server/queries/**` from a "use client" module',
    },
    schema: [],
    messages: {
      runtimeImport:
        'A "use client" module cannot pull runtime code from "{{source}}" — ' +
        "src/server/queries/** is server-only (CLAUDE.md §3). Use `import type` " +
        "for a type, or fetch in a server component and pass the data down as a prop.",
    },
  },
  create(context) {
    let isClientModule = false;

    /**
     * Reports `node` when `sourceNode` is a string literal naming a module
     * inside src/server/queries.
     *
     * A non-literal source — a template literal, a variable — is left alone: it
     * cannot be resolved here, and guessing would report on code that is fine.
     * `server-only` still catches those at build time.
     */
    function reportIfServerQueries(node, sourceNode) {
      if (!isClientModule) return;
      if (sourceNode?.type !== "Literal") return;
      if (typeof sourceNode.value !== "string") return;
      if (!resolvesIntoServerQueries(sourceNode.value, context.filename))
        return;

      context.report({
        node,
        messageId: "runtimeImport",
        data: { source: sourceNode.value },
      });
    }

    /** Type-only syntax is erased before the module reaches a bundle. */
    function isTypeOnly(node, kind) {
      if (node[kind] === "type") return true;

      return (
        node.specifiers?.length > 0 &&
        node.specifiers.every((specifier) => specifier[kind] === "type")
      );
    }

    return {
      // `directive` is set by the parser only for statements in the **directive
      // prologue** — the leading run of bare string literals — which is the only
      // place React and Next.js recognise "use client" at all. Reading it is
      // therefore the whole check.
      //
      // Matching `expression.value` instead, as this did, marks a module as
      // client code on any top-level `"use client";` anywhere in the body: after
      // the imports, after a statement, in a string a codemod left behind. That
      // is a *false* positive, and it lands on server modules — the ones whose
      // runtime imports of src/server/queries are entirely correct — so it
      // reports the boundary being respected.
      //
      // `.some()` over the whole body is still right with `directive`: the
      // prologue may hold several, and `"use strict"; "use client";` is a real
      // ordering. Nothing outside the prologue carries the property.
      Program(node) {
        isClientModule = node.body.some(
          (statement) => statement.directive === "use client",
        );
      },

      // `import type { X } from` and `import { type X } from` are both erased. A
      // bare side-effect import has no specifiers and is not, so it still reports.
      ImportDeclaration(node) {
        if (isTypeOnly(node, "importKind")) return;
        reportIfServerQueries(node, node.source);
      },

      // Re-exports pull the module into the bundle exactly as an import does, and
      // then republish it — so a barrel file is the one place this matters most.
      ExportNamedDeclaration(node) {
        if (!node.source) return;
        if (isTypeOnly(node, "exportKind")) return;
        reportIfServerQueries(node, node.source);
      },

      ExportAllDeclaration(node) {
        if (node.exportKind === "type") return;
        reportIfServerQueries(node, node.source);
      },

      // `await import(...)`. There is no type-only form to exempt: a dynamic
      // import is a runtime reference by construction.
      ImportExpression(node) {
        reportIfServerQueries(node, node.source);
      },

      // @types/node makes `require` resolve in a .tsx file, so this is reachable
      // rather than theoretical.
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (node.callee.name !== "require") return;
        reportIfServerQueries(node, node.arguments[0]);
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
    // Istanbul's generated HTML report (issue #28). Git-ignores it, ESLint
    // does not read .gitignore, so without this `pnpm lint` reports on
    // vendored report scripts as soon as anyone runs coverage locally. CI
    // never sees it: lint runs before the coverage step creates it.
    "coverage/**",
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
