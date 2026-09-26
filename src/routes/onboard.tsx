import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { PayDesk } from "@/components/pay/PayDesk";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { beginXConnect } from "@/lib/xpulse/api";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

type OnboardSearch = { x?: string; reason?: string };
const X_NOTES: Record<string, string> = {
  linked: "X API connected. You can sync posts from your Chamber.",
  missing: "X did not return a code. Try connecting again.",
  state: "That X API connection expired. Try again.",
  token: "X did not issue a token.",
  session: "Sign in with your wallet again, then connect X.",
};

export const Route = createFileRoute("/onboard")({
  validateSearch: (search: Record<string, unknown>): OnboardSearch => ({
    x: typeof search.x === "string" ? search.x : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  head: () => ({ meta: [{ title: "Your XPulse access · XPulse" }] }),
  component: OnboardPage,
});

function OnboardPage() {
  const { user, isPending } = useCurrentUserState();
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (isPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
        <TopNav />
        <p className="kicker">Checking session</p>
      </main>
    );
  }
  if (!user) return <Navigate to="/login" />;

  const xNote =
    search.x === "linked"
      ? X_NOTES.linked
      : search.x === "error"
        ? X_NOTES[search.reason ?? ""] ?? "Could not connect X."
        : null;

  async function connectX() {
    setBusy(true);
    setNote(null);

    try {
      const result = await beginXConnect();
      if (result.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      setNote(result.message ?? "Could not start X connection.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not start X connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
      <TopNav />

      {xNote ? (
        <p className="panel px-4 py-3 text-sm text-fg" role="status">
          {xNote}
        </p>
      ) : null}

      <section className="panel p-5">
        <p className="kicker">Your account</p>
        <h1 className="mt-2 text-2xl">Wallet verified.</h1>
        <p className="mt-2 text-sm text-muted">
          Your Solana wallet is your XPulse identity. The 7-day Pro trial starts automatically for this wallet.
        </p>

        <Button disabled={busy} onClick={() => void connectX()} className="mt-4">
          {busy ? "Opening X…" : "Connect X account"}
        </Button>

        {note ? (
          <p className="mt-3 text-sm text-muted" role="status" aria-live="polite">
            {note}
          </p>
        ) : null}
      </section>

      <PayDesk />
    </main>
  );
}
