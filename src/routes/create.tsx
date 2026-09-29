import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { runEditor } from "@/lib/xpulse/api";
import type { EditorDossier, EditorMode } from "@/lib/xpulse/editor/pipeline";
import type { ContentKind } from "@/lib/xpulse/content-score";

export const Route = createFileRoute("/create")({
  head: () => ({ meta: [{ title: "Create · XPulse" }] }),
  component: CreatePage,
});

const MODES: Array<{ kind: ContentKind; mode: EditorMode; label: string }> = [
  { kind: "post", mode: "MAKE_POST", label: "Post" },
  { kind: "thread", mode: "MAKE_THREAD", label: "Thread" },
  { kind: "article", mode: "MAKE_ARTICLE", label: "Article" },
];

const ANGLES = [
  { id: "hook", label: "Strong hook", hint: "Lead with the most important tension or fact." },
  { id: "data", label: "Data-first", hint: "Put measurable evidence before interpretation." },
  { id: "why", label: "Why it matters", hint: "Connect the source material to a concrete implication." },
  { id: "story", label: "Narrative", hint: "Build setup → tension → turn without inventing facts." },
  { id: "technical", label: "Technical", hint: "Prefer mechanisms, specifics and precise language." },
];

function scoreTone(score: number) {
  if (score >= 75) return "text-signal";
  if (score >= 55) return "text-accent";
  return "text-danger";
}

function CreatePage() {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [angle, setAngle] = useState("hook");
  const [result, setResult] = useState<EditorDossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mode = MODES.find((item) => item.kind === kind) ?? MODES[0]!;

  async function generate() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = (await runEditor({
        data: {
          text: draft.trim(),
          kind,
          mode: mode.mode,
          request: [
            "Create finished publishable content from the supplied source material.",
            "Do not invent facts, numbers, names, tickers or URLs.",
            "Preserve the factual meaning of the source.",
            "Selected editorial angle: " + angle,
            ANGLES.find((item) => item.id === angle)?.hint ?? "",
          ].join(" "),
        },
      })) as EditorDossier;
      if (!next?.output?.text) throw new Error("The writer returned no usable content.");
      setResult(next);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Create could not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function improve() {
    if (!result?.output?.text || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = (await runEditor({
        data: {
          text: result.output.text,
          kind,
          mode: "REWRITE",
          request: "Improve this draft materially. Preserve every factual element and only return a validated transformation that improves the deterministic score.",
        },
      })) as EditorDossier;
      setResult(next);
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Improvement could not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result?.output?.text) return;
    await navigator.clipboard.writeText(result.output.text);
    setNotice("Copied to clipboard.");
    window.setTimeout(() => setNotice(null), 1400);
  }

  const score = result?.score.improved.total ?? null;
  const viral = result?.score.improved.viral ?? null;

  return (
    <WorkspaceShell active="/create" kicker="X content" title="Create">
      <section className="panel overflow-hidden p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
          <div>
            <p className="kicker">Source</p>
            <h2 className="mt-1 text-2xl tracking-tight">Turn raw material into publishable X content.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              XPulse uses the same server-side editorial engine as Analyze: deterministic scoring and rules stay authoritative; the configured AI writes and is then validated.
            </p>
            <textarea
              className="mt-5 min-h-48 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-fg outline-none ring-accent focus:ring-1"
              placeholder="Paste a draft, notes, facts, research or an existing post…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>

          <aside className="rounded-xl border border-line bg-surface-2/40 p-4">
            <p className="kicker">Format</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {MODES.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setKind(item.kind)}
                  className={"rounded-lg border px-2 py-2 text-xs transition " + (
                    kind === item.kind
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-line text-muted hover:text-fg"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="mt-6 kicker">Editorial intent</p>
            <div className="mt-3 space-y-2">
              {ANGLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAngle(item.id)}
                  className={"w-full rounded-lg border px-3 py-2.5 text-left transition " + (
                    angle === item.id
                      ? "border-accent/50 bg-accent/10"
                      : "border-line bg-bg/20 hover:border-accent/30"
                  )}
                >
                  <span className="block text-sm text-fg">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{item.hint}</span>
                </button>
              ))}
            </div>

            <Button
              type="button"
              className="mt-5 w-full"
              disabled={!draft.trim() || busy}
              onClick={() => void generate()}
            >
              {busy ? "Writing…" : "Create with XPulse"}
            </Button>
          </aside>
        </div>
        {notice ? <p className="mt-4 text-xs text-muted" role="status">{notice}</p> : null}
      </section>

      {result ? (
        <section className="panel mt-5 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
            <div>
              <p className="kicker">Validated output · {result.output.source}</p>
              <h2 className="mt-1 text-xl tracking-tight">{result.output.kind}</h2>
            </div>
            <div className="flex items-center gap-3">
              {score != null ? (
                <div className="text-right">
                  <p className={"font-mono text-2xl font-semibold tabular-nums " + scoreTone(score)}>{score}</p>
                  <p className="font-mono text-[10px] tracking-widest text-subtle uppercase">content / 100</p>
                </div>
              ) : null}
              {viral != null ? (
                <div className="border-l border-line pl-3 text-right">
                  <p className="font-mono text-lg tabular-nums text-fg">{viral}</p>
                  <p className="font-mono text-[10px] tracking-widest text-subtle uppercase">viral</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{result.output.text}</pre>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void improve()} disabled={busy}>
                  {busy ? "Improving…" : "Improve"}
                </Button>
                <Button type="button" variant="quiet" onClick={() => void copy()}>
                  Copy
                </Button>
              </div>
            </div>

            <aside className="rounded-xl border border-line bg-surface-2/40 p-4">
              <p className="kicker">What changed</p>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
                {result.output.notes.slice(-6).map((note, index) => (
                  <li key={index}>• {note}</li>
                ))}
              </ul>
              <p className="mt-5 kicker">Weakest levers</p>
              <ul className="mt-3 space-y-2">
                {result.score.dimensions
                  .slice()
                  .sort((a, b) => a.after - b.after)
                  .slice(0, 4)
                  .map((dimension) => (
                    <li key={dimension.key} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted">{dimension.label}</span>
                      <span className="font-mono text-fg">{dimension.after}</span>
                    </li>
                  ))}
              </ul>
            </aside>
          </div>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
