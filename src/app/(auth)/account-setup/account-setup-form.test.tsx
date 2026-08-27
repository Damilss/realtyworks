import { render, screen } from "@testing-library/react";
import type { AuthFormState } from "@/server/actions/auth";

import { AccountSetupForm } from "./account-setup-form";

vi.mock("@/server/actions/auth", () => ({
  completeAccountSetup: vi.fn(),
}));

const useActionState = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState,
}));

function renderWith(state: AuthFormState, pending = false) {
  useActionState.mockReturnValue([state, vi.fn(), pending]);
  return render(
    <AccountSetupForm
      initialValues={{ fullName: "Existing Name", phone: "+15551230000" }}
    />,
  );
}

describe("AccountSetupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefills current profile data and renders two password fields", () => {
    renderWith({});

    expect(screen.getByLabelText("Full name")).toHaveValue("Existing Name");
    expect(screen.getByLabelText("Phone")).toHaveValue("+15551230000");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("restores only non-secret submitted values after an error", () => {
    renderWith({
      fieldErrors: { passwordConfirmation: ["Passwords do not match."] },
      values: { fullName: "Corrected Name", phone: "+1 555 123 9999" },
    });

    expect(screen.getByLabelText("Full name")).toHaveValue("Corrected Name");
    expect(screen.getByLabelText("Phone")).toHaveValue("+1 555 123 9999");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("disables completion while the action is pending", () => {
    renderWith({}, true);

    expect(
      screen.getByRole("button", { name: "Saving account…" }),
    ).toBeDisabled();
  });
});
