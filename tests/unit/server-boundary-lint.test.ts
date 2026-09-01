import { ESLint } from "eslint";

// The `realtyworks/no-server-queries-in-client` rule in eslint.config.mjs is the
// lint half of the CLAUDE.md §3 trust boundary. It is easy for a rule to stop
// matching silently — a renamed alias, a config entry whose `files` glob drifts —
// and a boundary nobody notices is unenforced is worse than none, so lint every
// shape through the *real* config rather than the rule in isolation.
//
// "Every shape" is the point. `server-only` fails the build for all of them, so
// this rule only ever buys an earlier error with a better message — and it buys
// nothing at all for a shape it does not match. A specifier is checked by
// resolving it, not by reading its text, so an alias and the relative path to
// the same file are one case; the node types below are the rest.
//
// `lintText` never reads the path from disk; the path only decides which config
// entries apply, so these fixtures do not have to exist.
const RULE = "realtyworks/no-server-queries-in-client";
const CLIENT_FILE = "src/app/(dashboard)/boundary-fixture.tsx";

async function lint(code: string, filePath = CLIENT_FILE) {
  const [result] = await new ESLint().lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === RULE);
}

describe("server/queries import boundary", () => {
  it("reports a runtime import from a client component", async () => {
    const messages = await lint(
      '"use client";\nimport { listWorkOrders } from "@/server/queries/work-orders";\nexport const x = listWorkOrders;\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("server-only");
  });

  // Every client component that touches a query module today does it this way,
  // and `import type` is erased before bundling. Flagging it would fail lint on
  // five files of correct, shipping code.
  it("allows a type-only import from a client component", async () => {
    expect(
      await lint(
        '"use client";\nimport type { WorkOrderListItem } from "@/server/queries/work-orders";\nexport type X = WorkOrderListItem;\n',
      ),
    ).toEqual([]);
  });

  // The seam the original issue got wrong: "use server" swaps a server action's
  // body for an RPC reference, so client components are *meant* to import them.
  it("allows a server action import from a client component", async () => {
    expect(
      await lint(
        '"use client";\nimport { signIn } from "@/server/actions/auth";\nexport const x = signIn;\n',
      ),
    ).toEqual([]);
  });

  it("allows a runtime import from a server component", async () => {
    expect(
      await lint(
        'import { listWorkOrders } from "@/server/queries/work-orders";\nexport const x = listWorkOrders;\n',
      ),
    ).toEqual([]);
  });

  // The alias is a convenience, not the boundary. Matching its text let the same
  // module through under a relative path, which is the spelling an editor's
  // auto-import offers as readily as the alias.
  it("reports a relative runtime import from a client component", async () => {
    const messages = await lint(
      '"use client";\nimport { listWorkOrders } from "../../server/queries/work-orders";\nexport const x = listWorkOrders;\n',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("server-only");
  });

  // Resolution has to stay narrow as well as wide: a relative path out of the
  // same directory reaches actions, which client components are meant to import.
  it("allows a relative server action import from a client component", async () => {
    expect(
      await lint(
        '"use client";\nimport { signIn } from "../../server/actions/auth";\nexport const x = signIn;\n',
      ),
    ).toEqual([]);
  });

  // A dynamic import bundles the module exactly as a static one does — verified
  // against `next build`, which fails on `server-only` either way.
  it("reports a dynamic import from a client component", async () => {
    const messages = await lint(
      '"use client";\nexport async function f() {\n  const m = await import("@/server/queries/work-orders");\n  return m.listWorkOrders();\n}\n',
    );

    expect(messages).toHaveLength(1);
  });

  // A re-export pulls the module in and then republishes it, which is strictly
  // worse than importing it — a barrel file spreads the breach.
  it("reports a re-export from a client component", async () => {
    const messages = await lint(
      '"use client";\nexport { listWorkOrders } from "@/server/queries/work-orders";\n',
    );

    expect(messages).toHaveLength(1);
  });

  it("reports a star re-export from a client component", async () => {
    const messages = await lint(
      '"use client";\nexport * from "@/server/queries/work-orders";\n',
    );

    expect(messages).toHaveLength(1);
  });

  it("allows a type-only re-export from a client component", async () => {
    expect(
      await lint(
        '"use client";\nexport type { WorkOrderListItem } from "@/server/queries/work-orders";\n',
      ),
    ).toEqual([]);
  });

  // @types/node makes `require` resolve in a .tsx file, so this is reachable.
  it("reports a require() from a client component", async () => {
    const messages = await lint(
      '"use client";\nconst m = require("@/server/queries/work-orders");\nexport const x = m;\n',
    );

    expect(messages).toHaveLength(1);
  });

  // The deliberate limit, recorded so it is not mistaken for an oversight: a
  // specifier that is not a string literal cannot be resolved at lint time, and
  // guessing would report on code that is fine. `server-only` still fails the
  // build, which is the guarantee that never depended on this rule.
  it("ignores a dynamic import whose specifier is not a literal", async () => {
    expect(
      await lint(
        '"use client";\nconst p = "@/server/queries/work-orders";\nexport const f = () => import(p);\n',
      ),
    ).toEqual([]);
  });

  // "use client" means something only in the directive prologue. A bare string
  // anywhere else is an expression statement, and treating it as the directive
  // reports a *server* module for an import that is entirely correct — the rule
  // firing at the boundary being respected. Both fixtures below are server
  // modules; neither may report.
  it('ignores a stray "use client" string after the imports', async () => {
    expect(
      await lint(
        'import { listWorkOrders } from "@/server/queries/work-orders";\n"use client";\nexport const x = listWorkOrders;\n',
      ),
    ).toEqual([]);
  });

  it('ignores a stray "use client" string after a statement', async () => {
    expect(
      await lint(
        'const n = 1;\n"use client";\nimport { listWorkOrders } from "@/server/queries/work-orders";\nexport const x = [n, listWorkOrders];\n',
      ),
    ).toEqual([]);
  });

  // The other half of the same fix: narrowing to the prologue must not narrow to
  // `body[0]`. A prologue can hold more than one directive, and this ordering is
  // legal — a rule that only read the first statement would go quiet here.
  it('still reports when "use client" follows another directive', async () => {
    const messages = await lint(
      '"use strict";\n"use client";\nimport { listWorkOrders } from "@/server/queries/work-orders";\nexport const x = listWorkOrders;\n',
    );

    expect(messages).toHaveLength(1);
  });
});
