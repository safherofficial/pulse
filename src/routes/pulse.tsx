import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chamber } from "@/components/chamber/Chamber";
import { getOverview } from "@/lib/xpulse/api";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { PulseModel } from "@/lib/xpulse/types";

const LOCK_RETRIES = 3;
const LOCK_RETRY_DELAY_MS = 250;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export const Route = createFileRoute("/pulse")({
  head: () => ({ meta: [{ title: "Your chamber · XPulse" }] }),
  component: PulsePage,
});

function PulsePage() {
  const { user, isPending } = useCurrentUserState();
  const [model, setModel] = useState<PulseModel | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setLocked(false);

    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        const overview = await getOverview();

        if (!overview.locked) {
          setLocked(false);
          setModel({
            mode: "account",
            creatorName: overview.creatorName,
            handle: overview.handle,
            posts: overview.posts,
            heatmap: overview.heatmap,
            heatmapLabel: overview.heatmapLabel,
            link: overview.link,
            xApiLinked: overview.xApiLinked,
          });
          return;
        }

        if (attempt < LOCK_RETRIES - 1) {
          await wait(LOCK_RETRY_DELAY_MS);
          continue;
        }

        setModel(null);
        setLocked(true);
      } catch (reason: unknown) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load your chamber.",
        );
        return;
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load, tick]);

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6">
        <p className="kicker skeleton">Loading chamber</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (locked) {
    return <Navigate to="/onboard" />;
  }

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
        <div className="panel max-w-md p-6">
          <p className="kicker">Chamber offline</p>
          <p className="mt-3 text-fg">{error}</p>
          <Button type="button" className="mt-5" onClick={() => setTick((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (!model) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg px-6">
        <p className="kicker skeleton">Syncing signals</p>
      </main>
    );
  }

  return (
    <Chamber
      model={model}
      onReload={() => setTick((n) => n + 1)}
    />
  );
}
