import { render, screen } from "@testing-library/react";
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

  it("disables the request while it is pending", () => {
    renderWith({}, true);

    expect(
      screen.getByRole("button", { name: "Sending link…" }),
    ).toBeDisabled();
  });
});
