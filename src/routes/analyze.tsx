import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { scoreContent, type ContentKind, type ContentScoreReport } from "@/lib/xpulse/content-score";
import { improveDraft, optimizationStatus, threadifyDraft, strongerHookDraft } from "@/lib/xpulse/api";
import type { ImproveResult } from "@/lib/xpulse/content-improve";
import { previewTweets } from "@/lib/xpulse/thread-builder";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: AnalyzePage,
});

type OptimizationView = {
  trendVersion: string;
  contentLogicVersion: string;
  nextRunAt: string;
  schedule: { time: string; timezone: string };
  lastRun: { id: string; status: string; dayKey: string; scoreDelta: number | null } | null;
  rulesChanged: string[];
  patternsDiscovered: string[];
  experimentsActive: string[];
  lastScoreDelta: number | null;
  rollbackAvailable: boolean;
};

function AnalyzePage() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [report, setReport] = useState<ContentScoreReport | null>(null);
  const [improved, setImproved] = useState<ImproveResult | null>(null);
  const [busy, setBusy] = useState<"score" | "hook" | "improve" | "thread" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optimization, setOptimization] = useState<OptimizationView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void optimizationStatus()
      .then((status) => {
        if (!cancelled) setOptimization(status as OptimizationView);
      })
      .catch(() => {
        if (!cancelled) setOptimization(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function analyze() {
    if (!text.trim()) return;
    setError(null);
    setImproved(null);
    setReport(scoreContent(text, kind));
  }

  async function run(
    action: "hook" | "improve" | "thread",
    job: () => Promise<ImproveResult>,
    nextKind?: ContentKind,
  ) {
    if (!text.trim()) return;
    setBusy(action);
    setError(null);
    try {
      const next = await job();
      setImproved(next);
      setReport(next.after);
      if (nextKind) setKind(nextKind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Improve is temporarily unavailable.");
    } finally {
      setBusy(null);
    }
  }

  const tweets = improved?.kind === "thread" ? previewTweets(improved.text) : [];

  return (
    <WorkspaceShell active="/analyze" kicker="Editor" title="Analyze & improve">
      <section className="panel space-y-4 p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Paste your draft</span>
          <textarea
            className="mt-2 min-h-40 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="Paste a draft. Include $TICKER, CA, or an X URL if you want live tape."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["post", "thread", "article"] as ContentKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`rounded-md border px-3 py-2 font-mono text-xs uppercase ${
                kind === k ? "border-accent text-accent" : "border-line text-muted"
              }`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!text.trim() || busy !== null} onClick={analyze}>
            Score
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!text.trim() || busy !== null}
            onClick={() =>
              void run("hook", () => strongerHookDraft({ data: { text, kind } }) as Promise<ImproveResult>)
            }
          >
            {busy === "hook" ? "Rewriting hook…" : "Stronger hook"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!text.trim() || busy !== null}
            onClick={() =>
              void run("improve", () => improveDraft({ data: { text, kind } }) as Promise<ImproveResult>)
            }
          >
            {busy === "improve" ? "Improving…" : "Improve score"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!text.trim() || busy !== null}
            onClick={() =>
              void run(
                "thread",
                () => threadifyDraft({ data: { text } }) as Promise<ImproveResult>,
                "thread",
              )
            }
          >
            {busy === "thread" ? "Building thread…" : "Threadify"}
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-danger" role="status">
            {error}
          </p>
        ) : null}
      </section>

      {improved ? (
        <section className="panel space-y-3 p-4 sm:p-5">
          <p className="kicker">
            {improved.kind} · {improved.angle.label} · {improved.source} · {improved.before.total}→
            {improved.after.total}
          </p>
          {tweets.length > 1 ? (
            <ol className="space-y-2">
              {tweets.map((tweet, i) => (
                <li key={i} className="rounded-md border border-line bg-surface-2/50 px-3 py-3">
                  <p className="font-mono text-[10px] text-subtle">{i + 1}/{tweets.length} · {tweet.length} chars</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg">{tweet}</p>
                </li>
              ))}
            </ol>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
              {improved.text}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="quiet"
              onClick={() => void navigator.clipboard.writeText(improved.text)}
            >
              Copy thread
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setText(improved.text);
                setKind(improved.kind);
                setReport(improved.after);
              }}
            >
              Use as draft
            </Button>
          </div>
          <ul className="space-y-1 text-xs text-subtle">
            {improved.applied.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report ? <ScoreCard report={report} /> : null}

      {optimization ? (
        <section className="panel space-y-2 p-4 sm:p-5">
          <p className="kicker">Daily optimization</p>
          <p className="text-sm text-fg">
            Viral {optimization.trendVersion} · Content {optimization.contentLogicVersion}
          </p>
          <p className="text-xs text-subtle">
            Next run {new Date(optimization.nextRunAt).toLocaleString()} · {optimization.schedule.time}{" "}
            {optimization.schedule.timezone}
            {optimization.lastRun ? ` · Last ${optimization.lastRun.status} ${optimization.lastRun.dayKey}` : " · No run yet"}
            {optimization.lastScoreDelta == null
              ? " · No measured score gain on the last activation"
              : ` · Benchmark delta ${optimization.lastScoreDelta > 0 ? "+" : ""}${optimization.lastScoreDelta}`}
            {optimization.rollbackAvailable ? " · Rollback stored" : ""}
          </p>
          {optimization.patternsDiscovered.length ? (
            <p className="text-xs text-muted">New patterns: {optimization.patternsDiscovered.join(", ")}</p>
          ) : null}
          {optimization.rulesChanged.length ? (
            <p className="text-xs text-muted">Rule changes: {optimization.rulesChanged.join("; ")}</p>
          ) : null}
          {optimization.experimentsActive.length ? (
            <p className="text-xs text-muted">Experiments: {optimization.experimentsActive.join(", ")}</p>
          ) : null}
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
