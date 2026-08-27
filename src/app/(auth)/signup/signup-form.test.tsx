import { render, screen } from "@testing-library/react";
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
});
