import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { VendorFormState } from "@/server/actions/vendors";

import { InviteVendorPanel } from "./invite-vendor-panel";

// The action is a server function; in a DOM test it is only ever the reference
// useActionState dispatches to.
vi.mock("@/server/actions/vendors", () => ({ inviteVendor: vi.fn() }));

const useActionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState,
}));

const PANEL = {
  workOrderId: "40000000-0000-0000-0000-000000000001",
  vendorId: "30000000-0000-0000-0000-000000000001",
  vendorName: "Rapid Plumbing",
  invited: false,
};

// Two links for the same vendor, which is the case that matters: generating a
// fresh one supersedes the last, and only the token differs.
const FIRST_LINK =
  "http://127.0.0.1:3000/auth/confirm?token_hash=aaaa1111&type=magiclink";
const SECOND_LINK =
  "http://127.0.0.1:3000/auth/confirm?token_hash=bbbb2222&type=magiclink";

const writeText = vi.fn();

function renderWith(state: VendorFormState) {
  useActionState.mockReturnValue([state, vi.fn(), false]);
  return render(<InviteVendorPanel {...PANEL} />);
}

/** The action returning a new link — a re-render, never a remount. */
function actionReturns(
  state: VendorFormState,
  rerender: (ui: React.ReactElement) => void,
) {
  useActionState.mockReturnValue([state, vi.fn(), false]);
  rerender(<InviteVendorPanel {...PANEL} />);
}

describe("InviteVendorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    // happy-dom has no Clipboard API, and the component's fallback path keys off
    // it rejecting — so both branches need it to be ours.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("shows no link before one has been generated", () => {
    renderWith({});

    expect(screen.queryByLabelText("Sign-in link")).not.toBeInTheDocument();
  });

  it("puts the generated link in a readable, selectable field", () => {
    renderWith({ inviteUrl: FIRST_LINK });

    const field = screen.getByLabelText("Sign-in link");
    expect(field).toHaveValue(FIRST_LINK);
    // readOnly, not disabled: a disabled input cannot be selected or copied,
    // which is the only thing this field is for.
    expect(field).toHaveAttribute("readonly");
  });

  it("reports the link as copied once the clipboard accepts it", async () => {
    renderWith({ inviteUrl: FIRST_LINK });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(FIRST_LINK);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("keeps offering Copy when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderWith({ inviteUrl: FIRST_LINK });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    // The link stays on screen and selected, so ⌘C still works — but nothing
    // claims it reached the clipboard.
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sign-in link")).toHaveValue(FIRST_LINK);
  });

  it("stops saying Copied once a fresh link supersedes the copied one", async () => {
    const { rerender } = renderWith({ inviteUrl: FIRST_LINK });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    // Same vendor, so nothing remounts: a "Copied" boolean would survive here
    // and describe a token the clipboard no longer holds, and the operator
    // would send the superseded link believing they had copied this one.
    actionReturns({ inviteUrl: SECOND_LINK }, rerender);

    expect(screen.getByLabelText("Sign-in link")).toHaveValue(SECOND_LINK);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("says Copied again once the fresh link is the one copied", async () => {
    const { rerender } = renderWith({ inviteUrl: FIRST_LINK });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    actionReturns({ inviteUrl: SECOND_LINK }, rerender);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenLastCalledWith(SECOND_LINK);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("describes an uninvited vendor as needing an account", () => {
    renderWith({});

    expect(
      screen.getByText(`Creates an account for ${PANEL.vendorName}`, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create sign-in link" }),
    ).toBeInTheDocument();
  });

  it("shows the action's error", () => {
    renderWith({ error: "Add an email address for this vendor first." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add an email address for this vendor first.",
    );
  });
});
