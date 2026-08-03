import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A plain `<select>`, styled to match `Input`.
 *
 * Deliberately not shadcn's Radix Select. That one renders a listbox of divs and
 * needs a hidden native control to participate in a form POST at all; this is a
 * real form control, so it submits with the server action, works before hydration,
 * and gives phone users their platform's native picker — which matters, because
 * the vendor half of this app is used on a phone (CLAUDE.md §2).
 *
 * Named `native-select` rather than `select` so a later
 * `pnpm dlx shadcn@latest add select` cannot silently overwrite it.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
