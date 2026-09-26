import { createFileRoute, Navigate } from "@tanstack/react-router";
import { WalletLogin } from "@/components/pay/WalletLogin";
import { TopNav } from "@/components/top-nav";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Wallet sign in · XPulse" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
        <TopNav />
        <p className="kicker">Checking session</p>
      </main>
    );
  }

  if (user) {
    return <Navigate to="/onboard" />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6">
      <TopNav />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="panel max-w-md p-5 sm:p-6">
          <p className="kicker">Wallet authentication only</p>
          <h1 className="mt-3 text-3xl">Connect wallet</h1>
          <p className="mt-3 text-muted">
            XPulse uses a Solana wallet signature for authentication. No email. The address is the account.
          </p>
          <div className="mt-6">
            <WalletLogin />
          </div>
        </div>
        <aside className="panel hidden p-6 lg:block">
          <p className="kicker">What the signature does</p>
          <ol className="mt-4 grid gap-4">
            <li>
              <p className="font-mono text-xs text-accent">01</p>
              <p className="mt-1 text-sm text-fg">Connect Phantom, Solflare, Backpack, or Glow.</p>
            </li>
            <li>
              <p className="font-mono text-xs text-accent">02</p>
              <p className="mt-1 text-sm text-fg">Sign one message. It does not move SOL.</p>
            </li>
            <li>
              <p className="font-mono text-xs text-accent">03</p>
              <p className="mt-1 text-sm text-fg">The same wallet later owns the trial and the lifetime unlock.</p>
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
