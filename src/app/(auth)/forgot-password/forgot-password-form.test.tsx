import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuthFormState } from "@/server/actions/auth";

import { ForgotPasswordForm } from "./forgot-password-form";

vi.mock("@/server/actions/auth", () => ({
  requestPasswordReset: vi.fn(),
}));

const useActionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState,
}));

function renderWith(state: AuthFormState, pending = false) {
  useActionState.mockReturnValue([state, vi.fn(), pending]);
  return render(<ForgotPasswordForm />);
}

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores and validates the submitted email", () => {
    renderWith({
      fieldErrors: { email: ["Enter a valid email address."] },
      values: { email: "nope" },
    });

    expect(screen.getByLabelText("Email")).toHaveValue("nope");
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
  });

  it("uses the same success panel whether or not the account exists", () => {
    renderWith({ passwordResetSent: true });

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/if an account matches/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  // Sharper here than on signup: the panel cannot echo the address without
  // becoming the oracle its wording avoids, so a typo leaves nothing to notice.
  it("hands the form back so a mistyped address can be corrected", async () => {
    renderWith({
      passwordResetSent: true,
      values: { email: "me@example.tst" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Use a different address" }),
    );

    expect(screen.getByLabelText("Email")).toHaveValue("me@example.tst");
    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
  });

  it("disables the request while it is pending", () => {
    renderWith({}, true);

    expect(
      screen.getByRole("button", { name: "Sending link…" }),
    ).toBeDisabled();
  });

  // Same defect as the signup form, stated more strongly here: this panel claims
  // a reset link was sent, so bringing it back while the corrected address is
  // still in flight asserts something that has not happened yet — and the panel
  // names no address, so nothing on screen contradicts it. Delete `&& !pending`
  // from forgot-password-form.tsx and this fails.
  it("keeps the form up while a corrected address is still in flight", async () => {
    const stale: AuthFormState = {
      passwordResetSent: true,
      values: { email: "me@example.tst" },
    };

    renderWith(stale);

    await userEvent.click(
      screen.getByRole("button", { name: "Use a different address" }),
    );

    // Submitting starts the action: the state is still the previous result and
    // `pending` flips true. That pair is the whole bug.
    useActionState.mockReturnValue([stale, vi.fn(), true]);
    await userEvent.click(
      screen.getByRole("button", { name: "Send password-reset link" }),
    );

    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use a different address" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sending link…" }),
    ).toBeDisabled();
  });
});
