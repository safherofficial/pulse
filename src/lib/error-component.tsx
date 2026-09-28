import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={1.75} />
      </span>
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-muted">{errorMessage(error)}</p>
    </main>
  );
}

export function AppNotFoundComponent() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">404</p>
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="max-w-md text-sm text-muted">This address is not part of XPulse.</p>
      <Link to="/" className="mt-2 inline-flex h-11 items-center text-sm text-accent hover:underline">
        Back to XPulse
      </Link>
    </main>
  );
}
