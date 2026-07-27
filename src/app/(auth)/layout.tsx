/**
 * Shell for the signed-out routes. Presentational only — the "already signed
 * in, go to the dashboard" check lives in each page, not here, because a layout
 * does not re-render on client-side navigation.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">RealtyWorks</h1>
        <p className="text-muted-foreground text-sm">
          Maintenance and repair operations
        </p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
