import { createFileRoute, Navigate } from "@tanstack/react-router";
import { PayDesk } from "@/components/pay/PayDesk";
import { TopNav } from "@/components/top-nav";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/onboard")({
  head: () => ({ meta: [{ title: "Your XPulse access · XPulse" }] }),
  component: OnboardPage,
});

function OnboardPage() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
        <TopNav />
        <p className="kicker">Checking session</p>
      </main>
    );
  }
  if (!user) return <Navigate to="/login" />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
      <TopNav />

      <section className="panel p-5">
        <p className="kicker">Your account</p>
        <h1 className="mt-2 text-2xl">Wallet verified.</h1>
        <p className="mt-2 text-sm text-muted">
          Your Solana wallet is your XPulse identity. The 7-day Pro trial starts automatically for
          this wallet. Analyze any public post by pasting its link in the Chamber — no X login or X
          API connection required.
        </p>
      </section>

      <PayDesk />
    </main>
  );
}
