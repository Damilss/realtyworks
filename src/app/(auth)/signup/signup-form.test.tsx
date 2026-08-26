import { render, screen } from "@testing-library/react";
import type { AuthFormState } from "@/server/actions/auth";

import { SignupForm } from "./signup-form";

// The action is a server function; in a DOM test it is only ever the reference
// useActionState dispatches to.
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

  it("renders the four labelled fields", () => {
    renderWith({});

    expect(screen.getByLabelText("Full name")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("restores every submitted field, because React resets the form on error", () => {
    // The failure this pins: one bad phone number used to cost the user all
    // four fields, since React resets an uncontrolled form after every action.
    renderWith({
      fieldErrors: { phone: ["Enter a valid phone number."] },
      values: {
        fullName: "New Person",
        email: "new@realtyworks.test",
        phone: "12",
      },
    });

    expect(screen.getByLabelText("Full name")).toHaveValue("New Person");
    expect(screen.getByLabelText("Email")).toHaveValue("new@realtyworks.test");
    expect(screen.getByLabelText("Phone")).toHaveValue("12");
    // The one field that is meant to clear.
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("marks the field the action rejected and shows its message", () => {
    renderWith({
      fieldErrors: { phone: ["Enter a valid phone number."] },
    });

    expect(screen.getByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows the action's form-level error", () => {
    renderWith({
      error: "Could not create that account. If you already have one, sign in.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not create that account.",
    );
  });

  it("disables the submit button while the action is pending", () => {
    renderWith({}, true);

    expect(
      screen.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
  });

  it("replaces the form with the confirmation panel, naming the address", () => {
    renderWith({
      confirmationSent: true,
      values: { email: "new@realtyworks.test" },
    });

    expect(
      screen.getByRole("heading", { name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText("new@realtyworks.test")).toBeInTheDocument();

    // Replaced, not annotated: leaving the form up invites a second submit that
    // only re-sends the same email.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create account" }),
    ).not.toBeInTheDocument();
  });
});
