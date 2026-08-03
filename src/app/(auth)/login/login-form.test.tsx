import { render, screen } from "@testing-library/react";
import type { AuthFormState } from "@/server/actions/auth";

import { LoginForm } from "./login-form";

// The action is a server function; in a DOM test it is only ever the reference
// useActionState dispatches to.
vi.mock("@/server/actions/auth", () => ({ signIn: vi.fn() }));

const useActionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState,
}));

function renderWith(state: AuthFormState, pending = false) {
  useActionState.mockReturnValue([state, vi.fn(), pending]);
  return render(<LoginForm />);
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders labelled email and password fields", () => {
    renderWith({});

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("shows the action's error message", () => {
    renderWith({ error: "Invalid email or password." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
  });

  it("shows field errors and marks the field invalid", () => {
    renderWith({ fieldErrors: { email: ["Enter a valid email address."] } });

    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("restores the submitted email, because React resets the form on error", () => {
    renderWith({
      error: "Invalid email or password.",
      values: { email: "manager@realtyworks.test" },
    });

    expect(screen.getByLabelText("Email")).toHaveValue(
      "manager@realtyworks.test",
    );
    // The one field that is meant to clear.
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("disables the submit button while the action is pending", () => {
    renderWith({}, true);

    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });

  it("does not render a password field error region when there is none", () => {
    renderWith({});

    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
