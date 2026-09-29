import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { runEditor, reviseEditor, optimizationStatus } from "@/lib/xpulse/api";
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
  component: () => <AnalyzePage initialMode="ANALYZE" title="Analyze" active="/analyze" />,
});

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: "ANALYZE", label: "Analyze" },
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

export function AnalyzePage({ initialMode = "ANALYZE", title = "Analyze", active = "/analyze" }: { initialMode?: EditorMode; title?: string; active?: string }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [request, setRequest] = useState("");
  const [kind, setKind] = useState<ContentKind>("post");
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const modes = [{ id: initialMode, label: title }];
  const [dossier, setDossier] = useState<EditorDossier | null>(null);
  const [token, setToken] = useState<EditorHandoff["token"]>(null);
  const [busy, setBusy] = useState<EditorMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [optimization, setOptimization] = useState<OptimizationView | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void optimizationStatus()
      .then((status) => {
        if (cancelled || !status || typeof status !== "object") return;
        const value = status as Partial<OptimizationView>;
        if (
          typeof value.trendVersion !== "string" ||
          typeof value.contentLogicVersion !== "string" ||
          typeof value.nextRunAt !== "string" ||
          !value.schedule
        ) {
          return;
        }
        setOptimization(value as OptimizationView);
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
    void execute(initialMode, parsed.text, "", parsed.kind, initialMode === "REWRITE" ? "Rewrite this content using the analysis pipeline, preserve every factual element, and maximize the validated content and viral-score delta." : "Analyze this content and identify the highest-impact improvements.");
    // Handoff is read once on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function execute(nextMode: EditorMode, draft = text, page = url, nextKind = kind, nextRequest = request) {
    if (!draft.trim() && !page.trim()) return;
    setBusy(nextMode);
    setMode(nextMode);
    setNotice(null);
    try {
      const result = (await runEditor({
        data: { text: draft, url: page, mode: nextMode, kind: nextKind, request: nextRequest },
      })) as EditorDossier;
      if (!result || typeof result !== "object" || !result.output || !result.score || !result.analysis) {
        throw new Error("Editor returned an invalid dossier.");
      }
      setDossier(result);
      setSelectedSuggestions([]);
    } catch {
      try {
        const fallback = runEditorPipeline({
          text: draft,
          mode: nextMode,
          kind: nextKind,
          request: nextRequest,
          logic: baselineContent(),
        });
        setDossier(fallback);
      } catch {
        setDossier(null);
        setNotice("Analyze could not complete this input. Check the text or URL and try again.");
        return;
      }
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
    <>
      {busy !== null ? <ProcessingOverlay mode={busy} /> : null}
      <WorkspaceShell active={active} kicker="Editor" title={title}>
      {token ? (
        <CollapsibleSection kicker="Token" title={`${token.symbol} · ${token.name}`} activityKey={token.address}>
          <p className="kicker">Token context</p>
          <p className="text-sm text-fg">
            {token.symbol} · {token.name}
            {token.state ? ` · ${token.state}` : ""}
          </p>
          <p className="break-all font-mono text-xs text-subtle">{token.address}</p>
          {token.headline ? <p className="text-sm text-muted">{token.headline}</p> : null}
          {token.rugLine ? <p className="text-sm text-muted">{token.rugLine}</p> : null}
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection kicker="Input" title="Content tool" activityKey={dossier ? `${dossier.input.text}|${dossier.output.text}` : null}>
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
          <span className="kicker">What do you want XPulse to do?</span>
          <textarea className="mt-2 min-h-20 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1" placeholder="Find the biggest weakness, improve the hook, make it technical, or turn it into a thread." value={request} onChange={(event) => setRequest(event.target.value)} />
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
          {modes.map((item) => (
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
      </CollapsibleSection>

      {dossier ? <DossierView dossier={dossier} beats={beats} selectedSuggestions={selectedSuggestions} onToggleSuggestion={(id) => setSelectedSuggestions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onRevise={async () => {
        if (!selectedSuggestions.length || !dossier.analysis.ai?.suggestions.length) return;
        setBusy("REWRITE");
        setNotice(null);
        try {
          const selected = dossier.analysis.ai.suggestions.filter((item) => selectedSuggestions.includes(item.id));
          const result = (await reviseEditor({ data: { dossier, selected } })) as EditorDossier;
          setDossier(result);
          setSelectedSuggestions([]);
        } catch {
          setNotice("AI revision failed validation or the model was unavailable. The original draft was kept.");
        } finally {
          setBusy(null);
        }
      }} onUse={() => {
        setText(dossier.output.text);
        setKind(dossier.output.kind);
      }} /> : null}

      {optimization ? (
        <CollapsibleSection kicker="Optimization" title="Daily optimization" activityKey={optimization.lastRun?.id ?? optimization.nextRunAt}>
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
        </CollapsibleSection>
      ) : null}
      </WorkspaceShell>
    </>
  );
}

function ProcessingOverlay({ mode }: { mode: EditorMode }) {
  const label = mode === "REWRITE" ? "Rewriting" : "Analyzing";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6 backdrop-blur-md" role="status" aria-live="polite" aria-label={label}>
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <div className="flex items-center gap-3 text-fg">
          <div className="animate-pulse" aria-hidden><BrandMark /></div>
          <span className="wordmark text-xl tracking-[0.2em]">XPulse</span>
        </div>
        <p className="mt-5 font-mono text-[10px] tracking-[0.28em] text-muted uppercase">{label} task</p>
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        </div>
        <p className="mt-3 text-xs text-subtle">XPulse is processing your request…</p>
      </div>
    </div>
  );
}

function DossierView({
  dossier,
  beats,
  onUse,
  selectedSuggestions,
  onToggleSuggestion,
  onRevise,
}: {
  dossier: EditorDossier;
  beats: string[];
  onUse: () => void;
  selectedSuggestions: string[];
  onToggleSuggestion: (id: string) => void;
  onRevise: () => void;
}) {
  const activityKey = [
    dossier.input.text,
    dossier.output.text,
    dossier.output.kind,
    dossier.output.source,
  ].join("|");
  const delta = dossier.score.delta;

  return (
    <>

      <CollapsibleSection
        kicker="Output"
        title="Original & regenerated content"
        activityKey={activityKey}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-md border border-line bg-surface-2/40 p-4">
            <p className="kicker">Original</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted">{dossier.input.text || "No text."}</pre>
          </article>
          <article className="rounded-md border border-accent/30 bg-accent/5 p-4">
            <p className="kicker">Regenerated</p>
            {beats.length > 1 ? (
              <ol className="mt-2 space-y-2">
                {beats.map((beat, index) => (
                  <li key={index} className="rounded-md border border-line bg-surface-2/50 px-3 py-3">
                    <p className="font-mono text-[10px] text-subtle">{index + 1}/{beats.length}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg">{beat}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{dossier.output.text || "No text."}</pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="quiet" onClick={() => void navigator.clipboard.writeText(dossier.output.text)}>
                Copy
              </Button>
              <Button type="button" variant="quiet" onClick={onUse}>
                Use as draft
              </Button>
              <Button type="button" variant="primary" onClick={() => {
                sessionStorage.setItem(EDITOR_HANDOFF_KEY, JSON.stringify({ text: dossier.output.text, kind: dossier.output.kind, token: null, at: Date.now() } satisfies EditorHandoff));
                window.location.href = "/rewrite";
              }}>
                Rewrite this
              </Button>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-subtle">
              {dossier.output.notes.slice(0, 6).map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          </article>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        kicker="Score"
        title={`Content ${dossier.score.improved.total} · Viral ${dossier.score.improved.viral} · ${dossier.output.source} · ${dossier.output.kind}`}
        activityKey={activityKey}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Meter label="Content · Original" value={dossier.score.original.total} />
          <Meter label="Content · Improved" value={dossier.score.improved.total} />
          <Meter label="Viral · Improved" value={dossier.score.improved.viral} />
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
        <p className="text-xs text-subtle">Scores are scoreContent plus the specificity signal. They are not impressions.</p>
        <p className="text-xs text-subtle">Measured delta: {delta > 0 ? "+" : ""}{delta} content points.</p>
      </CollapsibleSection>

      <CollapsibleSection kicker="Analysis" title="Content analysis" activityKey={activityKey}>
        <Block title="Detected" body={`${dossier.input.language} · ${dossier.input.format} · ${dossier.input.intent}`} />
        <List title="What works" items={dossier.analysis.works} />
        <List title="What does not" items={dossier.analysis.limits} />
        <List title="Why" items={dossier.analysis.why} />
        <List title="Risk" items={dossier.analysis.risks} />
        <List title="Viral patterns" items={dossier.analysis.viral} />
        {dossier.analysis.ai ? (
          <div className="mt-5 rounded-md border border-accent/30 bg-accent/5 p-4">
            <p className="kicker">Live model analysis</p>
            <p className="mt-2 text-sm text-fg">{dossier.analysis.ai.summary}</p>
            <p className="mt-2 font-mono text-[10px] text-subtle">
              {dossier.analysis.ai.trace.provider} · {dossier.analysis.ai.trace.model} · {dossier.analysis.ai.trace.durationMs}ms · attempt {dossier.analysis.ai.trace.attempt}
            </p>
            {dossier.analysis.ai.motivations.length ? (
              <div className="mt-4 space-y-2">
                {dossier.analysis.ai.motivations.slice(0, 8).map((item) => (
                  <div key={item.criterion} className="border-t border-line pt-2">
                    <p className="text-xs text-fg">{item.criterion} · {item.score}/100</p>
                    <p className="text-xs text-muted">{item.reason}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {dossier.analysis.ai.suggestions.length ? (
              <div className="mt-4 space-y-2">
                <p className="kicker">Select interventions</p>
                {dossier.analysis.ai.suggestions.map((item) => (
                  <label key={item.id} className="flex cursor-pointer gap-3 rounded-md border border-line p-3">
                    <input type="checkbox" checked={selectedSuggestions.includes(item.id)} onChange={() => onToggleSuggestion(item.id)} />
                    <span className="text-xs">
                      <span className="block text-fg">{item.criterion} · {item.position || "targeted edit"}</span>
                      <span className="block text-muted">{item.problem}</span>
                      <span className="mt-1 block text-subtle">→ {item.correction}</span>
                    </span>
                  </label>
                ))}
                <Button type="button" variant="primary" disabled={!selectedSuggestions.length} onClick={onRevise}>
                  Apply selected AI changes
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {dossier.input.entities.tickers.length ? (
          <p className="text-xs text-muted">Tickers: {dossier.input.entities.tickers.join(" ")}</p>
        ) : null}
        {dossier.url ? (
          <p className="text-xs text-muted">
            URL {dossier.url.kind} · {dossier.url.status}
            {dossier.url.reason ? ` · ${dossier.url.reason}` : ""}
          </p>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection kicker="Plan" title="Improvement plan" activityKey={activityKey}>
        <ol className="space-y-2">
          {dossier.plan.map((item, index) => (
            <li key={`${item.action}-${item.target}-${index}`} className="text-sm">
              <p className="text-fg">{index + 1}. {item.action} · {item.target}</p>
              <p className="text-muted">{item.reason}</p>
              <p className="text-xs text-subtle">Impact {item.expectedImpact} · priority {item.priority}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-subtle">
          Facts {dossier.validation.factsPreserved ? "kept" : "failed"} · numbers{" "}
          {dossier.validation.numbersPreserved ? "kept" : "failed"} · language{" "}
          {dossier.validation.languageKept ? "kept" : "failed"} · promo{" "}
          {dossier.validation.promoAdded ? "added" : "not added"}
        </p>
      </CollapsibleSection>

      <CollapsibleSection kicker="Diff" title="Transformation diff" activityKey={activityKey}>
        <ul className="space-y-1 font-mono text-xs">
          {dossier.diff.length ? dossier.diff.map((mark, index) => (
            <li
              key={`${mark.type}-${index}`}
              className={mark.type === "added" ? "text-accent" : mark.type === "removed" ? "text-danger line-through" : "text-muted"}
            >
              {mark.type === "added" ? "+ " : mark.type === "removed" ? "− " : "  "}
              {mark.text}
            </li>
          )) : (
            <li className="text-muted">No line changes.</li>
          )}
        </ul>
      </CollapsibleSection>
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
