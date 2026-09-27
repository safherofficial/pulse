import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { runEditor, optimizationStatus } from "@/lib/xpulse/api";
import type { ContentKind } from "@/lib/xpulse/content-score";
import { baselineContent } from "@/lib/xpulse/optimize/baseline";
import {
  EDITOR_HANDOFF_KEY,
  parseEditorHandoff,
  runEditorPipeline,
  type EditorDossier,
  type EditorHandoff,
  type EditorMode,
  type NamedScore,
} from "@/lib/xpulse/editor/pipeline";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: AnalyzePage,
});

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: "ANALYZE", label: "Analyze" },
  { id: "IMPROVE", label: "Improve" },
  { id: "REWRITE", label: "Rewrite" },
  { id: "SHORTEN", label: "Shorten" },
  { id: "EXPAND", label: "Expand" },
  { id: "MAKE_POST", label: "Post" },
  { id: "MAKE_THREAD", label: "Thread" },
  { id: "MAKE_ARTICLE", label: "Article" },
  { id: "IMPROVE_HOOK", label: "Hook" },
  { id: "IMPROVE_STRUCTURE", label: "Structure" },
  { id: "FACT_CHECK", label: "Fact check" },
  { id: "SCORE", label: "Score" },
];

const SCORE_ROWS: Array<{ key: keyof NamedScore; label: string }> = [
  { key: "hook", label: "Hook" },
  { key: "clarity", label: "Clarity" },
  { key: "structure", label: "Structure" },
  { key: "specificity", label: "Specificity" },
  { key: "originality", label: "Originality" },
  { key: "readability", label: "Readability" },
  { key: "valueDensity", label: "Value density" },
  { key: "engagementPotential", label: "Engagement potential" },
  { key: "credibility", label: "Credibility" },
];

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
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [mode, setMode] = useState<EditorMode>("ANALYZE");
  const [dossier, setDossier] = useState<EditorDossier | null>(null);
  const [token, setToken] = useState<EditorHandoff["token"]>(null);
  const [busy, setBusy] = useState<EditorMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  useEffect(() => {
    const parsed = parseEditorHandoff(sessionStorage.getItem(EDITOR_HANDOFF_KEY));
    if (!parsed) return;
    sessionStorage.removeItem(EDITOR_HANDOFF_KEY);
    setText(parsed.text);
    setKind(parsed.kind);
    setToken(parsed.token);
    void execute("ANALYZE", parsed.text, "", parsed.kind);
    // Handoff is read once on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function execute(nextMode: EditorMode, draft = text, page = url, nextKind = kind) {
    if (!draft.trim() && !page.trim()) return;
    setBusy(nextMode);
    setMode(nextMode);
    setNotice(null);
    try {
      const result = (await runEditor({
        data: { text: draft, url: page, mode: nextMode, kind: nextKind },
      })) as EditorDossier;
      setDossier(result);
    } catch {
      setDossier(
        runEditorPipeline({
          text: draft,
          mode: nextMode,
          kind: nextKind,
          logic: baselineContent(),
        }),
      );
      setNotice("Live editor path unavailable. Local score and craft rules still ran. Paste the text if a URL could not be read.");
    } finally {
      setBusy(null);
    }
  }

  const beats =
    dossier?.output.kind === "thread"
      ? dossier.output.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
      : [];

  return (
    <WorkspaceShell active="/analyze" kicker="Editor" title="Analyze & improve">
      {token ? (
        <section className="panel space-y-1 p-4 sm:p-5">
          <p className="kicker">Token context</p>
          <p className="text-sm text-fg">
            {token.symbol} · {token.name}
            {token.state ? ` · ${token.state}` : ""}
          </p>
          <p className="break-all font-mono text-xs text-subtle">{token.address}</p>
          {token.headline ? <p className="text-sm text-muted">{token.headline}</p> : null}
          {token.rugLine ? <p className="text-sm text-muted">{token.rugLine}</p> : null}
        </section>
      ) : null}

      <section className="panel space-y-4 p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Draft</span>
          <textarea
            className="mt-2 min-h-40 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="Paste a post, thread, article, note, or headline. Facts in the draft stay facts."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="kicker">Public URL, optional</span>
          <input
            className="mt-2 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="x.com status, article, or token page. If it cannot be read, paste the text."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["post", "thread", "article"] as ContentKind[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-md border px-3 py-2 font-mono text-xs uppercase ${
                kind === item ? "border-accent text-accent" : "border-line text-muted"
              }`}
              onClick={() => setKind(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {MODES.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={mode === item.id ? "primary" : "quiet"}
              disabled={busy !== null || (!text.trim() && !url.trim())}
              onClick={() => void execute(item.id)}
            >
              {busy === item.id ? "Working…" : item.label}
            </Button>
          ))}
        </div>
        {notice ? (
          <p className="text-sm text-danger" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      {dossier ? <DossierView dossier={dossier} beats={beats} onUse={() => {
        setText(dossier.output.text);
        setKind(dossier.output.kind);
      }} /> : null}

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

function DossierView({
  dossier,
  beats,
  onUse,
}: {
  dossier: EditorDossier;
  beats: string[];
  onUse: () => void;
}) {
  const delta = dossier.score.delta;
  return (
    <>
      <section className="panel space-y-3 p-4 sm:p-5">
        <p className="kicker">Score · {dossier.output.source} · {dossier.output.kind}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Meter label="Original" value={dossier.score.original.total} />
          <Meter label="Improved" value={dossier.score.improved.total} />
          <Meter label="Delta" value={`${delta > 0 ? "+" : ""}${delta}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-subtle">
              <tr>
                <th className="py-1 pr-3 font-normal">Dimension</th>
                <th className="py-1 pr-3 font-normal">Before</th>
                <th className="py-1 pr-3 font-normal">After</th>
                <th className="py-1 font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {SCORE_ROWS.map((row) => {
                const before = dossier.score.original[row.key];
                const after = dossier.score.improved[row.key];
                const change = typeof before === "number" && typeof after === "number" ? after - before : null;
                return (
                  <tr key={row.key} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-fg">{row.label}</td>
                    <td className="py-1.5 pr-3 text-muted">{before ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-muted">{after ?? "—"}</td>
                    <td className="py-1.5 text-muted">{change == null ? "—" : `${change > 0 ? "+" : ""}${change}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-subtle">
          Scores are scoreContent plus the specificity signal. They are not impressions.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel space-y-2 p-4 sm:p-5">
          <p className="kicker">Analysis</p>
          <Block title="Detected" body={`${dossier.input.language} · ${dossier.input.format} · ${dossier.input.intent}`} />
          <List title="What works" items={dossier.analysis.works} />
          <List title="What does not" items={dossier.analysis.limits} />
          <List title="Why" items={dossier.analysis.why} />
          <List title="Risk" items={dossier.analysis.risks} />
          <List title="Viral patterns" items={dossier.analysis.viral} />
          {dossier.input.entities.tickers.length ? (
            <p className="text-xs text-muted">Tickers: {dossier.input.entities.tickers.join(" ")}</p>
          ) : null}
          {dossier.url ? (
            <p className="text-xs text-muted">
              URL {dossier.url.kind} · {dossier.url.status}
              {dossier.url.reason ? ` · ${dossier.url.reason}` : ""}
            </p>
          ) : null}
        </article>
        <article className="panel space-y-2 p-4 sm:p-5">
          <p className="kicker">Improvement plan</p>
          <ol className="space-y-2">
            {dossier.plan.map((item, index) => (
              <li key={`${item.action}-${item.target}-${index}`} className="text-sm">
                <p className="text-fg">
                  {index + 1}. {item.action} · {item.target}
                </p>
                <p className="text-muted">{item.reason}</p>
                <p className="text-xs text-subtle">
                  Impact {item.expectedImpact} · priority {item.priority}
                </p>
              </li>
            ))}
          </ol>
          <p className="text-xs text-subtle">
            Facts {dossier.validation.factsPreserved ? "kept" : "failed"} · numbers{" "}
            {dossier.validation.numbersPreserved ? "kept" : "failed"} · language{" "}
            {dossier.validation.languageKept ? "kept" : "failed"} · promo{" "}
            {dossier.validation.promoAdded ? "added" : "not added"}
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel space-y-2 p-4 sm:p-5">
          <p className="kicker">Original</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted">{dossier.input.text || "No text."}</pre>
        </article>
        <article className="panel space-y-3 p-4 sm:p-5">
          <p className="kicker">Improved</p>
          {beats.length > 1 ? (
            <ol className="space-y-2">
              {beats.map((beat, index) => (
                <li key={index} className="rounded-md border border-line bg-surface-2/50 px-3 py-3">
                  <p className="font-mono text-[10px] text-subtle">{index + 1}/{beats.length}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg">{beat}</p>
                </li>
              ))}
            </ol>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{dossier.output.text || "No text."}</pre>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="quiet" onClick={() => void navigator.clipboard.writeText(dossier.output.text)}>
              Copy
            </Button>
            <Button type="button" variant="quiet" onClick={onUse}>
              Use as draft
            </Button>
          </div>
          <ul className="space-y-1 text-xs text-subtle">
            {dossier.output.notes.slice(0, 6).map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel space-y-2 p-4 sm:p-5">
        <p className="kicker">Diff</p>
        <ul className="space-y-1 font-mono text-xs">
          {dossier.diff.length ? dossier.diff.map((mark, index) => (
            <li
              key={`${mark.type}-${index}`}
              className={
                mark.type === "added" ? "text-accent" : mark.type === "removed" ? "text-danger line-through" : "text-muted"
              }
            >
              {mark.type === "added" ? "+ " : mark.type === "removed" ? "− " : "  "}
              {mark.text}
            </li>
          )) : (
            <li className="text-muted">No line changes.</li>
          )}
        </ul>
      </section>
    </>
  );
}

function Meter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-line px-3 py-3">
      <p className="font-mono text-[10px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-1 text-2xl text-fg">{value}</p>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm text-fg">{title}</p>
      <p className="text-sm text-muted">{body}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-sm text-fg">{title}</p>
      <ul className="mt-1 space-y-1 text-sm text-muted">
        {items.slice(0, 5).map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
