import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { scoreContent, type ContentKind } from "@/lib/xpulse/content-score";
import {
  generateFromDraft,
  improveForScore,
  type GeneratedContent,
} from "@/lib/xpulse/content-create";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: AnalyzePage,
});

function AnalyzePage() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [report, setReport] = useState<ReturnType<typeof scoreContent> | null>(null);
  const [improved, setImproved] = useState<GeneratedContent | null>(null);

  function analyze() {
    if (!text.trim()) return;
    setReport(scoreContent(text, kind));
    setImproved(null);
  }

  function strongerHook() {
    const lines = text.trim().split(/\n+/);
    const rest = lines.slice(1).join("\n\n");
    const candidates = [
      generateFromDraft(text, kind, "breaking", 0),
      generateFromDraft(text, kind, "data", 2),
      generateFromDraft(text, kind, "why", 4),
    ];
    candidates.sort((a, b) => b.score.total - a.score.total);
    const best = candidates[0]!;
    const hook = best.text.split(/\n+/)[0] ?? best.text;
    setImproved({
      ...best,
      text: rest ? `${hook}\n\n${rest}` : best.text,
      applied: [...best.applied, "Stronger hook pass"],
    });
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
          <Button type="button" disabled={!text.trim()} onClick={analyze}>
            Score
          </Button>
          <Button type="button" variant="quiet" disabled={!text.trim()} onClick={strongerHook}>
            Stronger hook
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!text.trim()}
            onClick={() => {
              const next = improveForScore(text, kind);
              setImproved(next);
              setReport(next.score);
            }}
          >
            Improve score
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!text.trim()}
            onClick={() => {
              const next = generateFromDraft(text, "thread");
              setImproved(next);
              setReport(next.score);
              setKind("thread");
            }}
          >
            Threadify
          </Button>
        </div>
      </section>

      {report ? <ScoreCard report={report} /> : null}

      {improved ? (
        <section className="panel p-4 sm:p-5">
          <p className="kicker">Improved version</p>
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
                setImproved(null);
              }}
            >
              Use as draft
            </Button>
          </div>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
