import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

// Placeholder proving the DOM test harness works end-to-end: render under
// happy-dom, a jest-dom matcher, Vitest globals, and a user-event interaction
// driving a state update. Safe to delete once real component tests exist
// (Phase 3).
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <h1>Harness OK</h1>
      <button onClick={() => setCount((c) => c + 1)}>Count: {count}</button>
    </div>
  );
}

test("renders and asserts on the DOM via a jest-dom matcher", () => {
  render(<Counter />);
  expect(
    screen.getByRole("heading", { name: /harness ok/i }),
  ).toBeInTheDocument();
});

test("handles interaction via user-event", async () => {
  const user = userEvent.setup();
  render(<Counter />);
  await user.click(screen.getByRole("button", { name: /count: 0/i }));
  expect(screen.getByRole("button", { name: /count: 1/i })).toBeInTheDocument();
});
