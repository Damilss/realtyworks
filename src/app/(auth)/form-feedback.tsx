/**
 * Error rendering shared by the login and signup forms. Both are announced with
 * `aria-live="polite"`: the messages appear after an async round trip, so a
 * screen-reader user gets nothing without it.
 */

export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) {
    return null;
  }

  return (
    <p className="text-destructive text-sm" aria-live="polite">
      {messages[0]}
    </p>
  );
}

export function FormError({ message }: { message?: string }) {
  return (
    <p
      className="text-destructive min-h-5 text-sm"
      role="alert"
      aria-live="polite"
    >
      {message}
    </p>
  );
}
