import { ESLint } from "eslint";

// The `realtyworks/no-server-queries-in-client` rule in eslint.config.mjs is the
// lint half of the CLAUDE.md §3 trust boundary. It is easy for a rule to stop
// matching silently — a renamed alias, a config entry whose `files` glob drifts —
// and a boundary nobody notices is unenforced is worse than none, so lint the
// three shapes through the *real* config rather than the rule in isolation.
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
});
