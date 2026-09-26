import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import {
  generateFromDraft,
  improveForScore,
  suggestAngles,
  type GeneratedContent,
} from "@/lib/xpulse/content-create";
import type { ContentKind } from "@/lib/xpulse/content-score";

export const Route = createFileRoute("/create")({
  head: () => ({ meta: [{ title: "Create · XPulse" }] }),
  component: CreatePage,
});

function CreatePage() {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [angleId, setAngleId] = useState<string | undefined>();
  const [result, setResult] = useState<GeneratedContent | null>(null);
  const [variant, setVariant] = useState(0);

  const angles = suggestAngles(draft || "general");

  function run() {
    if (!draft.trim()) return;
    const next = generateFromDraft(draft, kind, angleId, variant);
    setResult(next);
  }

  function improve() {
    if (!result) return;
    const next = improveForScore(result.text, kind, variant + 1);
    setVariant((v) => v + 1);
    setResult(next);
  }

  return (
    <WorkspaceShell active="/create" kicker="X content" title="Create & optimize">
      <section className="panel space-y-4 p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Topic, draft, or research notes</span>
          <textarea
            className="mt-2 min-h-36 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="Paste a draft, an idea, or notes from token research…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {(["post", "thread", "article"] as ContentKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`rounded-md border px-3 py-2 font-mono text-xs uppercase tracking-wide ${
                kind === k
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:text-fg"
              }`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <div>
          <p className="kicker">Angles</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {angles.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`rounded-md border px-3 py-3 text-left transition ${
                  angleId === a.id
                    ? "border-accent bg-accent/10"
                    : "border-line bg-surface-2/40 hover:border-line"
                }`}
                onClick={() => setAngleId(a.id)}
              >
                <span className="block text-sm text-fg">{a.label}</span>
                <span className="mt-1 block text-xs text-muted">{a.why}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!draft.trim()} onClick={run}>
            Generate
          </Button>
          {result ? (
            <>
              <Button type="button" variant="quiet" onClick={improve}>
                Improve score
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setVariant((v) => v + 1);
                  setResult(generateFromDraft(draft, kind, angleId, variant + 1));
                }}
              >
                Another version
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => void navigator.clipboard.writeText(result.text)}
              >
                Copy
              </Button>
            </>
          ) : null}
        </div>
      </section>

      {result ? (
        <section className="space-y-4">
          <div className="panel p-4 sm:p-5">
            <p className="kicker">
              {result.kind} · {result.angle.label}
            </p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
              {result.text}
            </pre>
            {result.applied.length ? (
              <ul className="mt-4 space-y-1 text-xs text-subtle">
                {result.applied.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <ScoreCard report={result.score} />
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
