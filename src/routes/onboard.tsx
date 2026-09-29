import { createFileRoute, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PayDesk } from "@/components/pay/PayDesk";
import { Button } from "@/components/ui/button";
import { beginXConnect, getMe, syncPosts } from "@/lib/xpulse/api";
import { TopNav } from "@/components/top-nav";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/onboard")({
  head: () => ({ meta: [{ title: "Your XPulse access · XPulse" }] }),
  component: OnboardPage,
});

function OnboardPage() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const search = useSearch({ from: "/onboard" });
  const [xLinked, setXLinked] = useState(false);
  const [xBusy, setXBusy] = useState(false);
  const [xNotice, setXNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getMe().then((me) => {
      if (live) setXLinked(Boolean(me.xApiLinked));
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (search.x !== "error") return;
    const reason = typeof search.reason === "string" ? search.reason.replaceAll("_", " ") : "unknown error";
    setXNotice(`X connection was not completed (${reason}). You can try again.`);
  }, [search.reason, search.x]);

  useEffect(() => {
    if (search.x !== "linked") return;
    let live = true;
    setXBusy(true);
    setXNotice("X connected. Importing your public posts without X API credits…");
    void syncPosts()
      .then((result) => {
        if (!live) return;
        setXLinked(true);
        if (result.imported > 0) {
          setXNotice(`Imported ${result.imported} public posts from X. Opening your Chamber…`);
          window.setTimeout(() => navigate({ to: "/pulse" }), 500);
        } else {
          setXNotice("X connected, but no public posts were returned. Your public-link tools remain available.");
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        setXLinked(true);
        setXNotice(error instanceof Error ? `X connected, but public import failed: ${error.message}` : "X connected, but the first import failed. Try Sync X again.");
      })
      .finally(() => { if (live) setXBusy(false); });
    return () => { live = false; };
  }, [navigate, search.x]);

  async function connectX() {
    setXBusy(true);
    setXNotice(null);
    try {
      const result = await beginXConnect();
      if (!result.ok) {
        setXNotice(result.message);
        return;
      }
      window.location.assign(result.url);
    } catch (error: unknown) {
      setXNotice(error instanceof Error ? error.message : "Could not start X connection.");
    } finally {
      setXBusy(false);
    }
  }

  async function syncX() {
    setXBusy(true);
    setXNotice(null);
    try {
      const result = await syncPosts();
      setXNotice(result.imported > 0 ? `Imported ${result.imported} public posts from X.` : "X is connected, but no public posts were returned.");
      setXLinked(true);
    } catch (error: unknown) {
      setXNotice(error instanceof Error ? error.message : "X sync failed.");
    } finally {
      setXBusy(false);
    }
  }

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
          Your Solana wallet is your XPulse identity. Connect your X account to identify your personal Chamber. Public-link
          analysis remains available without X connection.
        </p>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="kicker">X account</p>
            <h2 className="mt-2 text-xl">Import your posts directly from X</h2>
            <p className="mt-2 text-sm text-muted">
              Authorize XPulse with X OAuth. Your X identity is tied to this XPulse wallet account;
              after connection, Sync X imports your available public posts.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {xLinked ? (
              <Button type="button" variant="quiet" disabled={xBusy} onClick={() => void syncX()}>
                {xBusy ? "Syncing…" : "Sync X"}
              </Button>
            ) : (
              <Button type="button" variant="primary" disabled={xBusy} onClick={() => void connectX()}>
                {xBusy ? "Connecting…" : "Connect X"}
              </Button>
            )}
          </div>
        </div>
        {xNotice ? <p className="mt-2 text-sm text-muted" role="status">{xNotice}</p> : null}
      </section>

      <PayDesk />
    </main>
  );
}
