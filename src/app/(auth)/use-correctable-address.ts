"use client";

import { useState } from "react";

/**
 * The escape hatch behind the "Check your email" panels on /signup and
 * /forgot-password.
 *
 * Both pages end on a panel that is otherwise terminal — `useActionState`
 * exposes no reset — and nothing upstream can tell a deliverable address from a
 * typo, since GoTrue accepts any syntactically valid one. So `you@realtyworks.tst`
 * succeeds and the only way back would be knowing to reload the page.
 *
 * Three parts have to agree, and they are subtle enough that duplicating them
 * already cost one bug in both copies at once:
 *
 * - **`showPanel` is false while the action is in flight.** `useActionState`
 *   keeps the *previous* result for the whole of the next submission, so without
 *   this the reset below re-satisfies the condition immediately: the stale panel
 *   returns over a request that has not landed, claims a link was sent, and
 *   offers a button that restores the address the user just corrected. A panel
 *   is a claim about a settled result; `pending` is precisely "not settled".
 * - **`formProps.onSubmit` clears the flag**, rather than the panel's click
 *   handler doing it, so the *next* result renders its own panel instead of
 *   being suppressed by a stale flag.
 * - **`editAddress`** is what that button calls.
 *
 * Deliberately a hook and not a component. The two panels differ in copy, and
 * one of those differences is load-bearing: /forgot-password must not name the
 * address it sent to, or it becomes the account-enumeration oracle its wording
 * exists to avoid. Sharing the mechanism keeps the bug-prone half in one place;
 * keeping the markup in each page keeps that decision where it can be read.
 */
export function useCorrectableAddress(
  settled: boolean | undefined,
  pending: boolean,
) {
  const [editingAddress, setEditingAddress] = useState(false);

  return {
    showPanel: Boolean(settled) && !editingAddress && !pending,
    editAddress: () => setEditingAddress(true),
    formProps: { onSubmit: () => setEditingAddress(false) },
  };
}
