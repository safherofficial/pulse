import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { scoreContent, type ContentKind, type ContentScoreReport } from "@/lib/xpulse/content-score";
import { improveDraft, threadifyDraft, strongerHookDraft } from "@/lib/xpulse/api";
import type { ImproveResult } from "@/lib/xpulse/content-improve";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: AnalyzePage,
});

function AnalyzePage() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [report, setReport] = useState<ContentScoreReport | null>(null);
  const [improved, setImproved] = useState<ImproveResult | null>(null);
  const [busy, setBusy] = useState<"score" | "hook" | "improve" | "thread" | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <WorkspaceShell active="/analyze" kicker="Editor" title="Analyze & improve">
      <section className="panel space-y-4 p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Paste your draft</span>
          <textarea
            className="mt-2 min-h-40 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="Paste a post, thread, or article draft…"
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
            {busy === "thread" ? "Threading…" : "Threadify"}
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-danger" role="status">
            {error}
          </p>
        ) : null}
      </section>

      {improved ? (
        <section className="panel p-4 sm:p-5">
          <p className="kicker">
            {improved.kind} · {improved.angle.label} · {improved.source} · {improved.before.total}→
            {improved.after.total}
          </p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
            {improved.text}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="quiet"
              onClick={() => void navigator.clipboard.writeText(improved.text)}
            >
              Copy
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
          <ul className="mt-3 space-y-1 text-xs text-subtle">
            {improved.applied.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report ? <ScoreCard report={report} /> : null}
    </WorkspaceShell>
  );
}
