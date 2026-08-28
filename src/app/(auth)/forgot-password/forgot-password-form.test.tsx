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
});
