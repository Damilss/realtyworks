import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AuthFormState } from "@/server/actions/auth";

import { SignupForm } from "./signup-form";

vi.mock("@/server/actions/auth", () => ({ signUp: vi.fn() }));

const useActionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState,
}));

function renderWith(state: AuthFormState, pending = false) {
  useActionState.mockReturnValue([state, vi.fn(), pending]);
  return render(<SignupForm />);
}

describe("SignupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects only the email before ownership is verified", () => {
    renderWith({});

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("restores the submitted email after an error", () => {
    renderWith({
      error: "Could not create that account.",
      values: { email: "new@realtyworks.test" },
    });

    expect(screen.getByLabelText("Email")).toHaveValue("new@realtyworks.test");
  });

  it("marks an invalid email and shows its message", () => {
    renderWith({
      fieldErrors: { email: ["Enter a valid email address."] },
    });

    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("disables the submit button while the action is pending", () => {
    renderWith({}, true);

    expect(
      screen.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
  });

  it("replaces the form with a non-enumerating confirmation panel", () => {
    renderWith({
      confirmationSent: true,
      values: { email: "new@realtyworks.test" },
    });

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText("new@realtyworks.test")).toBeInTheDocument();
    expect(screen.getByText(/choose your password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  // The panel is otherwise terminal, and nothing upstream checks that the
  // address can receive mail: `you@realtyworks.tst` is accepted, so without a
  // way back the only correction is knowing to reload the page.
  it("hands the form back so a mistyped address can be corrected", async () => {
    renderWith({
      confirmationSent: true,
      values: { email: "new@realtyworks.tst" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Use a different address" }),
    );

    expect(screen.getByLabelText("Email")).toHaveValue("new@realtyworks.tst");
    expect(
      screen.queryByRole("heading", { name: "Check your email" }),
    ).not.toBeInTheDocument();
  });
});
