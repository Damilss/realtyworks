"use client";

import { useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteVendor, type VendorFormState } from "@/server/actions/vendors";

const initialState: VendorFormState = {};

/**
 * Mints a magic link for the assigned vendor and shows it once.
 *
 * "Copy link" rather than "Send" on purpose: the entire vendor login works with
 * no Twilio account, no 10DLC registration, and zero spend, which is what lets
 * this ship in Phase 3 while SMS delivery waits for Phase 5
 * (docs/vendor-access.md §5).
 */
export function InviteVendorPanel({
  workOrderId,
  vendorId,
  vendorName,
  invited,
}: {
  workOrderId: string;
  vendorId: string;
  vendorName: string;
  invited: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    inviteVendor,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  async function copyLink() {
    const link = linkRef.current;

    if (!link) {
      return;
    }

    // select() first, and unconditionally: it is what makes ⌘C work when the
    // Clipboard API is unavailable — an insecure origin, or a browser that
    // refuses without a permission the user never granted. The link stays
    // visible and selectable no matter what, so the flow never dead-ends.
    link.select();

    try {
      await navigator.clipboard.writeText(link.value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Vendor access</h3>
        <p className="text-muted-foreground text-sm">
          {invited
            ? `${vendorName} has an account. Generate a fresh link to sign them in.`
            : `Creates an account for ${vendorName} and a one-time sign-in link.`}
        </p>
      </div>

      <form action={formAction}>
        <input type="hidden" name="workOrderId" value={workOrderId} />
        <input type="hidden" name="vendorId" value={vendorId} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending
            ? "Generating…"
            : invited
              ? "New sign-in link"
              : "Create sign-in link"}
        </Button>
      </form>

      <FormError message={state.error} />

      {state.inviteUrl ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="inviteUrl">Sign-in link</Label>
          <div className="flex gap-2">
            {/* readOnly rather than disabled: a disabled input cannot be
                selected or copied, which is the only thing this field is for. */}
            <Input
              ref={linkRef}
              id="inviteUrl"
              readOnly
              value={state.inviteUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={copyLink}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Single use, and it expires in an hour. It is shown once — nothing
            stores it, so generate a new one rather than looking for this again.
          </p>
        </div>
      ) : null}
    </div>
  );
}
