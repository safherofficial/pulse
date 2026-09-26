import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { PulseCanvas } from "@/components/scene/PulseCanvas";
import { AnalyzeLinkField } from "@/components/pulse/AnalyzeLinkField";
import { Button, fieldClass } from "@/components/ui/button";
import { clearPosts, compareXUrls, deletePosts, enrichAnalysis, rewriteEnriched } from "@/lib/xpulse/api";
import type { EnrichedAnalysis, EnrichedRewrite } from "@/lib/xpulse/enrich";
import {
  formatCompact,
  formatDwell,
  formatFull,
  formatMaybe,
  formatPct,
  formatWhen,
} from "@/lib/xpulse/format";
import { engagementRate, publicMetricsEngagement, writingSignals } from "@/lib/xpulse/metrics";
import { scoreDelta, suggestEdits } from "@/lib/xpulse/rewrite";
import { usePulseStore, type ChamberView } from "@/lib/xpulse/store";
import type {
  PublicCompareResult,
  PublicXPost,
  PulseModel,
  PulsePost,
  WritingSignals,
} from "@/lib/xpulse/types";

const VIEWS: { id: ChamberView; label: string; short: string; key: string }[] = [
  { id: "overview", label: "Overview", short: "Overview", key: "1" },
  { id: "graph", label: "Signals", short: "Signals", key: "2" },
  { id: "compare", label: "Compare", short: "Compare", key: "3" },
  { id: "library", label: "Library", short: "Library", key: "4" },
];

const SIGNAL_LABELS: Record<keyof WritingSignals, string> = {
  hook: "Hook",
  clarity: "Clarity",
  curiosity: "Curiosity",
  specificity: "Specificity",
  emotion: "Emotion",
  shareability: "Shareability",
  readability: "Readability",
  structure: "Structure",
};

const SIGNAL_HINTS: Record<keyof WritingSignals, string> = {
  hook: "First line pull — does it stop the scroll?",
  clarity: "How easy the idea is to grasp in one pass",
  curiosity: "Open loops that make people keep reading",
  specificity: "Concrete detail vs vague claims",
  emotion: "Felt charge without empty hype",
  shareability: "Would someone forward this as-is?",
  readability: "Rhythm, length, and scan-ability",
  structure: "Setup → point → payoff shape",
};

function overallWritingScore(signals: WritingSignals): number {
  const values = Object.values(signals);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

function signalTone(score: number): "strong" | "mid" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 45) return "mid";
  return "weak";
}

export function Chamber({ model, onReload }: { model: PulseModel; onReload?: () => void }) {
  const view = usePulseStore((s) => s.view);
  const setView = usePulseStore((s) => s.setView);
  const focusId = usePulseStore((s) => s.focusId);
  const setFocus = usePulseStore((s) => s.setFocus);
  const reset = usePulseStore((s) => s.reset);
  const [compare, setCompare] = useState<PublicCompareResult | null>(null);
  const pendingId = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    reset();
    setCompare(null);
    pendingId.current = null;
  }, [reset, model.mode, model.creatorName]);

  useEffect(() => {
    if (model.posts.length === 0) return;
    const pending = pendingId.current;
    if (pending && model.posts.some((post) => post.id === pending)) {
      setFocus(pending);
      pendingId.current = null;
      return;
    }
    if (!focusId || !model.posts.some((post) => post.id === focusId)) setFocus(model.posts[0]!.id);
  }, [focusId, model.posts, setFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const next = VIEWS.find((item) => item.key === event.key);
      if (next) setView(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);

  const activeId = model.posts.some((post) => post.id === focusId) ? focusId : (model.posts[0]?.id ?? null);
  const selectedPost = activeId ? model.posts.find((post) => post.id === activeId) : undefined;
  const signals = selectedPost ? writingSignals(selectedPost.text) : null;
  const graphPost = view === "compare" ? undefined : selectedPost;

  return (
    <div className="relative min-h-dvh bg-bg text-fg">
      {/* Ambient 3D — fixed, non-interactive, never steals scroll */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.55]" aria-hidden>
        <PulseCanvas
          model={model}
          selectedPost={graphPost}
          compare={view === "compare" ? compare : null}
          mode="chamber"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
      </div>

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-line/80 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Link to="/" className="shrink-0" aria-label="XPulse home">
                <BrandMark />
              </Link>
              <div className="min-w-0">
                <Link to="/" className="wordmark text-sm">
                  XPulse
                </Link>
                <p className="truncate font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
                  {model.mode === "sample" ? "Sample chamber" : "Personal chamber"}
                  {" · "}
                  {model.handle ? `@${model.handle.replace(/^@/, "")}` : model.creatorName}
                </p>
              </div>
            </div>
            <Link
              to={model.mode === "sample" ? "/onboard" : "/studio"}
              className="inline-flex h-10 items-center text-sm text-muted transition-colors hover:text-accent"
            >
              {model.mode === "sample" ? "Unlock yours" : "Sample"}
            </Link>
          </div>

          {model.mode === "account" ? (
            <div className="mx-auto max-w-6xl border-t border-line/50 px-4 py-3 sm:px-6">
              <AnalyzeLinkField
                compact
                onImported={(id) => {
                  if (id) pendingId.current = id;
                  onReload?.();
                }}
              />
            </div>
          ) : null}

          <nav
            className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6"
            role="tablist"
            aria-label="Chamber views"
          >
            {VIEWS.map((item) => {
              const on = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setView(item.id)}
                  className={`tap relative h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    on
                      ? "bg-accent text-accent-fg shadow-[0_0_24px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]"
                      : "border border-line/80 bg-surface/60 text-muted hover:border-accent/40 hover:text-fg"
                  }`}
                >
                  {item.short}
                  <span className={`ml-2 font-mono text-[10px] ${on ? "opacity-70" : "opacity-40"}`}>
                    {item.key}
                  </span>
                </button>
              );
            })}
          </nav>
        </header>

        <main
          ref={mainRef}
          className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
        >
          {selectedPost && view !== "library" ? (
            <FocusBanner post={selectedPost} onOpenLibrary={() => setView("library")} />
          ) : null}

          <section className="rise mt-4">
            {view === "overview" ? (
              <OverviewPane post={selectedPost} signals={signals} onLibrary={() => setView("library")} />
            ) : null}
            {view === "graph" ? <GraphPane post={selectedPost} signals={signals} /> : null}
            {view === "compare" ? <ComparePane result={compare} onResult={setCompare} /> : null}
            {view === "library" ? (
              <LinkLibrary
                model={model}
                focusId={activeId}
                onFocus={(id) => {
                  setFocus(id);
                  setView("overview");
                }}
                onReload={onReload}
              />
            ) : null}
          </section>

          <p className="mt-10 pb-8 text-center font-mono text-[11px] tracking-widest text-subtle uppercase">
            Keys 1–4 switch views · one link drives the graph
          </p>
        </main>
      </div>
    </div>
  );
}

function FocusBanner({ post, onOpenLibrary }: { post: PulsePost; onOpenLibrary: () => void }) {
  const eng = engagementRate(post.metrics);
  return (
    <div className="panel hud-corners overflow-hidden p-4 sm:p-5">
      <span className="corner corner-tl" />
      <span className="corner corner-tr" />
      <span className="corner corner-bl" />
      <span className="corner corner-br" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
            Focus · {post.type} · {formatWhen(post.publishedAt)}
          </p>
          <p className="mt-2 line-clamp-3 text-base leading-relaxed text-fg sm:text-lg">{post.text}</p>
        </div>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="tap shrink-0 rounded-full border border-line bg-bg/50 px-3 py-1.5 text-xs text-muted hover:border-accent/50 hover:text-accent"
        >
          Change link
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Views" value={formatFull(post.metrics.impressions)} accent />
        <Kpi label="Engagement" value={formatPct(eng)} />
        <Kpi label="Likes" value={formatFull(post.metrics.likes)} />
        <Kpi label="Reposts" value={formatFull(post.metrics.reposts)} />
      </div>
    </div>
  );
}

function Kpi({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2.5">
      <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
      <p className={`mt-1 font-mono text-xl tabular-nums sm:text-2xl ${accent ? "text-accent" : "text-fg"}`}>
        {value}
      </p>
    </div>
  );
}

function OverviewPane({
  post,
  signals,
  onLibrary,
}: {
  post?: PulsePost;
  signals: WritingSignals | null;
  onLibrary: () => void;
}) {
  if (!post) {
    return <EmptyState text="Pick a link in Library. The chamber reads one post at a time — never averages the whole account." />;
  }
  const metrics = post.metrics;
  const score = signals ? overallWritingScore(signals) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="space-y-5">
        <div className="panel p-5">
          <p className="kicker">Performance</p>
          <h2 className="mt-1 text-2xl tracking-tight">What this post did</h2>
          <p className="mt-2 text-sm text-muted">
            Counts belong only to this link. Nothing from the rest of the account is mixed in.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Views" value={formatFull(metrics.impressions)} accent />
            <Stat label="Engagement" value={formatPct(engagementRate(metrics))} />
            <Stat label="Likes" value={formatFull(metrics.likes)} />
            <Stat label="Replies" value={formatFull(metrics.replies)} />
            <Stat label="Reposts" value={formatFull(metrics.reposts)} />
            <Stat label="Bookmarks" value={formatFull(metrics.bookmarks)} />
            <Stat label="Opens" value={formatMaybe(metrics.detailExpands)} />
            <Stat label="Dwell" value={formatDwell(metrics.dwellMs)} />
            <Stat label="Profile clicks" value={formatMaybe(metrics.profileClicks)} />
          </dl>
          <div className="mt-6">
            <p className="mb-2 font-mono text-[11px] tracking-wide text-subtle uppercase">Engagement mix</p>
            <LinkMetricsChart post={post} />
          </div>
        </div>

        <div className="panel p-5">
          <p className="kicker">Copy</p>
          <h2 className="mt-1 text-xl tracking-tight">Full text</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg/95">{post.text}</p>
          <button type="button" onClick={onLibrary} className="mt-5 h-11 text-sm text-muted hover:text-fg">
            Choose another link →
          </button>
        </div>

        <RewriteCoach key={post.id} post={post} />
      </div>

      <div className="space-y-5">
        {signals && score != null ? (
          <div className="panel p-5">
            <p className="kicker">Writing DNA</p>
            <h2 className="mt-1 text-2xl tracking-tight">How it is written</h2>
            <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <ScoreRing score={score} />
              <p className="flex-1 text-sm leading-relaxed text-muted">
                Average of eight writing signals on this text alone. High scores mean the post is built to
                stop the scroll and travel; low scores flag the levers to rewrite first.
              </p>
            </div>
            <SignalRankList signals={signals} limit={5} />
            <p className="mt-4 text-xs text-subtle">Open the Signals tab for the full ranked map with hints.</p>
          </div>
        ) : null}
        {signals ? (
          <div className="panel p-5">
            <p className="kicker">All signals</p>
            <SignalBars signals={signals} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RewriteCoach({ post }: { post: PulsePost }) {
  const localSuggestions = suggestEdits(post.text);
  const [enrichment, setEnrichment] = useState<EnrichedAnalysis | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichedRewrite | null>(null);
  const [variant, setVariant] = useState(0);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEnrichBusy(true);
    setEnrichError(null);
    void enrichAnalysis({
      data: {
        text: post.text,
        xPostId: post.xPostId,
        metrics: {
          impressions: post.metrics.impressions,
          likes: post.metrics.likes,
          replies: post.metrics.replies,
          reposts: post.metrics.reposts,
          bookmarks: post.metrics.bookmarks,
          profileClicks: post.metrics.profileClicks,
          linkClicks: post.metrics.linkClicks,
          detailExpands: post.metrics.detailExpands,
          dwellMs: post.metrics.dwellMs,
        },
      },
    })
      .then((payload) => {
        if (!cancelled) setEnrichment(payload as EnrichedAnalysis);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setEnrichError(reason instanceof Error ? reason.message : "Enrichment unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setEnrichBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id, post.text, post.xPostId]);

  const suggestions = enrichment?.suggestions ?? localSuggestions;
  const fixes = suggestions.filter((s) => s.priority !== "keep");
  const delta = result ? scoreDelta(result.before, result.after) : null;

  async function runRewrite() {
    setRewriteBusy(true);
    setCopied(false);
    try {
      const nextVariant = variant;
      const payload = (await rewriteEnriched({ data: { text: post.text, variant: nextVariant } })) as EnrichedRewrite;
      setResult(payload);
      setVariant((v) => v + 1);
    } catch (reason) {
      setEnrichError(reason instanceof Error ? reason.message : "Rewrite failed.");
    } finally {
      setRewriteBusy(false);
    }
  }

  async function copyRewrite() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="panel p-5">
      <p className="kicker">Coach · public enrichment</p>
      <h2 className="mt-1 text-xl tracking-tight">Suggested edits</h2>
      <p className="mt-2 text-sm text-muted">
        Local viral signals plus free public APIs (LanguageTool, Datamuse, VxTwitter / FxTwitter mirrors).
      </p>

      {enrichBusy ? (
        <p className="mt-3 font-mono text-xs text-subtle skeleton">Pulling public enrichments…</p>
      ) : null}
      {enrichError ? (
        <p className="mt-3 text-xs text-muted" role="status">
          {enrichError} — local coach still works.
        </p>
      ) : null}

      {enrichment?.viral ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-subtle uppercase">Viral score</p>
            <p className="mt-1 font-mono text-xl text-accent tabular-nums">{enrichment.viral.score}</p>
          </div>
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-subtle uppercase">Eng. rate</p>
            <p className="mt-1 font-mono text-xl text-fg tabular-nums">
              {enrichment.viral.metrics.engagementRate == null
                ? "—"
                : `${enrichment.viral.metrics.engagementRate}%`}
            </p>
          </div>
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-subtle uppercase">LT issues</p>
            <p className="mt-1 font-mono text-xl text-fg tabular-nums">{enrichment.languageTool.length}</p>
          </div>
          <div className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2">
            <p className="text-[11px] text-subtle uppercase">Sources</p>
            <p className="mt-1 font-mono text-[11px] leading-snug text-muted">
              {enrichment.sources.slice(0, 3).join(" · ")}
            </p>
          </div>
        </div>
      ) : null}

      {enrichment?.viral?.detected?.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {enrichment.viral.detected.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-accent"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {fixes.length === 0 ? (
        <p className="mt-4 text-sm text-accent">Signals are solid. A rewrite will only polish structure.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {fixes.map((item) => (
            <li
              key={item.signal}
              className={`rounded-lg border px-3 py-3 ${
                item.priority === "fix"
                  ? "border-danger/40 bg-danger/5"
                  : "border-line/70 bg-bg/40"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-fg">{item.label}</span>
                <span
                  className={`font-mono text-xs tabular-nums ${
                    item.priority === "fix" ? "text-danger" : "text-muted"
                  }`}
                >
                  {item.score}
                  <span className="ml-2 uppercase tracking-wider opacity-70">{item.priority}</span>
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted">{item.action}</p>
            </li>
          ))}
        </ul>
      )}

      {enrichment?.languageTool?.length ? (
        <div className="mt-4">
          <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">LanguageTool</p>
          <ul className="mt-2 space-y-1.5">
            {enrichment.languageTool.slice(0, 5).map((match, index) => (
              <li key={`${match.ruleId}-${index}`} className="text-sm text-muted">
                <span className="text-fg">{match.shortMessage || match.category}</span>
                {" — "}
                {match.message}
                {match.replacements[0] ? (
                  <span className="font-mono text-xs text-accent"> → {match.replacements[0]}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enrichment?.vocabulary && Object.keys(enrichment.vocabulary).length > 0 ? (
        <div className="mt-4">
          <p className="font-mono text-[11px] tracking-widest text-subtle uppercase">Datamuse lexicon</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {Object.entries(enrichment.vocabulary).map(([word, alts]) => (
              <li key={word} className="rounded-md border border-line/70 bg-bg/40 px-2 py-1 text-xs text-muted">
                <span className="text-fg">{word}</span>
                {alts.length ? ` → ${alts.slice(0, 3).join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" disabled={rewriteBusy} onClick={() => void runRewrite()}>
          {rewriteBusy ? "Rewriting…" : result ? `Rewrite again · v${variant + 1}` : "Rewrite this post"}
        </Button>
        {result ? (
          <Button type="button" variant="quiet" onClick={() => void copyRewrite()}>
            {copied ? "Copied" : "Copy rewrite"}
          </Button>
        ) : null}
      </div>

      {result ? (
        <div className="mt-5 rounded-lg border border-accent/35 bg-accent/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] tracking-[0.14em] text-accent uppercase">
              Autonomous rewrite · enriched
            </p>
            {delta ? (
              <p className="font-mono text-xs text-muted tabular-nums">
                Score {delta.avgBefore} → <span className="text-accent">{delta.avgAfter}</span>
                {result.viral ? (
                  <span className="ml-2">· viral {result.viral.score}</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg">{result.text}</p>
          {result.applied.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {result.applied.map((note) => (
                <li
                  key={note}
                  className="rounded-full border border-line/80 bg-bg/50 px-2.5 py-0.5 font-mono text-[10px] tracking-wide text-muted"
                >
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
          {result.sources?.length ? (
            <p className="mt-3 font-mono text-[10px] tracking-wide text-subtle">
              Sources: {result.sources.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-subtle">
          One click runs LanguageTool + Datamuse vocabulary swaps, then the viral rewrite engine (hook,
          specificity, structure, stakes).
        </p>
      )}
    </div>
  );
}

function GraphPane({ post, signals }: { post?: PulsePost; signals: WritingSignals | null }) {
  if (!post || !signals) {
    return <EmptyState text="Choose a link in Library to open its writing signal map." />;
  }
  const score = overallWritingScore(signals);
  const ranked = (Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[])
    .map((key) => ({ key, score: signals[key] }))
    .sort((a, b) => b.score - a.score);

  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="panel flex flex-col items-center p-6 text-center">
        <p className="kicker">Composite</p>
        <h2 className="mt-1 text-2xl tracking-tight">Signal score</h2>
        <div className="mt-8">
          <ScoreRing score={score} size="lg" />
        </div>
        <p className="mt-6 max-w-xs text-sm text-muted">
          One number from eight writing dimensions on this post. Performance metrics sit beside — they never
          dilute the writing score.
        </p>
        <div className="mt-6 grid w-full grid-cols-2 gap-3 text-left">
          <div className="rounded-lg border border-line/70 bg-bg/40 p-3">
            <p className="text-[11px] text-subtle uppercase">Strongest</p>
            <p className="mt-1 font-medium text-signal">{SIGNAL_LABELS[strongest!.key]}</p>
            <p className="font-mono text-sm text-fg">{strongest!.score}</p>
          </div>
          <div className="rounded-lg border border-line/70 bg-bg/40 p-3">
            <p className="text-[11px] text-subtle uppercase">Weakest</p>
            <p className="mt-1 font-medium text-danger">{SIGNAL_LABELS[weakest!.key]}</p>
            <p className="font-mono text-sm text-fg">{weakest!.score}</p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="panel p-5">
          <p className="kicker">Writing map</p>
          <h2 className="mt-1 text-xl tracking-tight">Every signal, ranked</h2>
          <p className="mt-2 text-sm text-muted">
            Bars are writing quality only. Hover any row for what it measures.
          </p>
          <SignalBars signals={signals} ranked showHints />
        </div>

        <div className="panel p-5">
          <p className="kicker">Same link · performance</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Views" value={formatFull(post.metrics.impressions)} accent />
            <Kpi label="Engagement" value={formatPct(engagementRate(post.metrics))} />
            <Kpi label="Dwell" value={formatDwell(post.metrics.dwellMs)} />
            <Kpi label="Opens" value={formatMaybe(post.metrics.detailExpands)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreRing({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const r = size === "lg" ? 54 : 42;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const dim = size === "lg" ? 140 : 112;
  const tone = signalTone(score);
  const stroke =
    tone === "strong" ? "var(--color-signal)" : tone === "mid" ? "var(--color-accent)" : "var(--color-danger)";

  return (
    <div className="relative shrink-0" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90">
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={size === "lg" ? 10 : 8}
        />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={size === "lg" ? 10 : 8}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
          style={{
            filter: `drop-shadow(0 0 10px color-mix(in srgb, ${stroke} 55%, transparent))`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className={`font-mono font-semibold tabular-nums leading-none ${size === "lg" ? "text-4xl" : "text-3xl"}`}>
            {score}
          </p>
          <p className="mt-1 font-mono text-[10px] tracking-widest text-subtle uppercase">/ 100</p>
        </div>
      </div>
    </div>
  );
}

function SignalBars({
  signals,
  ranked = false,
  showHints = false,
}: {
  signals: WritingSignals;
  ranked?: boolean;
  showHints?: boolean;
}) {
  const keys = (Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[]).slice();
  if (ranked) keys.sort((a, b) => signals[b] - signals[a]);

  return (
    <ul className="mt-4 space-y-3">
      {keys.map((key) => {
        const score = signals[key];
        const tone = signalTone(score);
        const barColor =
          tone === "strong" ? "bg-signal" : tone === "mid" ? "bg-accent" : "bg-danger";
        return (
          <li key={key} className="group">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-fg">{SIGNAL_LABELS[key]}</span>
              <span className="font-mono text-sm tabular-nums text-fg">{score}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/80">
              <div
                className={`h-full rounded-full ${barColor} transition-[width] duration-500 ease-out`}
                style={{
                  width: `${score}%`,
                  boxShadow: `0 0 12px color-mix(in srgb, ${
                    tone === "strong"
                      ? "var(--color-signal)"
                      : tone === "mid"
                        ? "var(--color-accent)"
                        : "var(--color-danger)"
                  } 50%, transparent)`,
                }}
              />
            </div>
            {showHints ? (
              <p className="mt-1 max-h-0 overflow-hidden text-xs text-subtle opacity-0 transition-all group-hover:max-h-10 group-hover:opacity-100">
                {SIGNAL_HINTS[key]}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SignalRankList({ signals, limit }: { signals: WritingSignals; limit: number }) {
  const ranked = (Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[])
    .map((key) => ({ key, score: signals[key] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return (
    <ol className="mt-6 space-y-2">
      {ranked.map((item, index) => (
        <li
          key={item.key}
          className="flex items-center gap-3 rounded-md border border-line/60 bg-bg/30 px-3 py-2"
        >
          <span className="font-mono text-xs text-subtle tabular-nums w-5">{index + 1}</span>
          <span className="flex-1 text-sm">{SIGNAL_LABELS[item.key]}</span>
          <span className="font-mono text-sm text-accent tabular-nums">{item.score}</span>
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg tabular-nums ${accent ? "text-accent" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function ComparePane({
  result,
  onResult,
}: {
  result: PublicCompareResult | null;
  onResult: (value: PublicCompareResult | null) => void;
}) {
  const [viralUrl, setViralUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    if (!viralUrl.trim() || !targetUrl.trim()) {
      setError("Paste the viral example and the post you want to improve.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await compareXUrls({ data: { viralUrl: viralUrl.trim(), targetUrl: targetUrl.trim() } });
      if (!response || !("viral" in response) || !("target" in response) || !("deficits" in response)) {
        throw new Error("Could not compare these X posts.");
      }
      onResult(response);
    } catch (reason) {
      onResult(null);
      setError(reason instanceof Error ? reason.message : "Could not compare these X posts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="panel p-5">
        <p className="kicker">Two public links</p>
        <h2 className="mt-1 text-2xl tracking-tight">Viral vs yours</h2>
        <p className="mt-2 text-sm text-muted">
          Link 1 is the reference. Link 2 is the post to improve. Gaps are marked only where yours falls short.
        </p>
        <div className="mt-5 grid gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Viral example
            <input
              className={fieldClass}
              value={viralUrl}
              onChange={(event) => setViralUrl(event.target.value)}
              placeholder="https://x.com/…/status/…"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Post to improve
            <input
              className={fieldClass}
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://x.com/…/status/…"
            />
          </label>
          <Button type="button" disabled={busy} onClick={() => void compare()}>
            {busy ? "Comparing…" : "Compare posts"}
          </Button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="panel p-5">
        {result ? (
          <CompareReport result={result} />
        ) : (
          <div className="flex h-full min-h-[220px] flex-col justify-center">
            <p className="kicker">Awaiting pair</p>
            <p className="mt-3 max-w-md text-sm text-muted">
              After both links resolve, you get a side-by-side scorecard and a list of concrete gaps — writing
              and public rates — with advice on each shortfall.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CompareReport({ result }: { result: PublicCompareResult }) {
  const viralEngagement = publicMetricsEngagement(result.viral.metrics);
  const targetEngagement = publicMetricsEngagement(result.target.metrics);
  const shortfalls = result.gaps.length + result.deficits.length;
  return (
    <div>
      <p className="kicker">Scorecard</p>
      <h2 className="mt-1 text-xl tracking-tight">Where the post falls short</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CompareSide title="Viral example" post={result.viral} engagement={viralEngagement} />
        <CompareSide title="Post to improve" post={result.target} engagement={targetEngagement} warn />
      </div>
      <h3 className="mt-6 text-sm font-medium">Gaps</h3>
      {shortfalls === 0 ? (
        <p className="mt-2 text-sm text-accent">
          No material gap. This post already matches the reference on writing and on the public rates we could
          read.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {result.gaps.map((gap) => (
            <article key={gap.signal} className="rounded-lg border border-danger/35 bg-bg/50 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{gap.label}</span>
                <span className="font-mono text-danger">-{gap.gap}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MiniBar label="Reference" value={gap.viral} tone="reference" />
                <MiniBar label="Yours" value={gap.target} tone="gap" />
              </div>
              <p className="mt-2 text-sm text-fg">{gap.advice}</p>
            </article>
          ))}
          {result.deficits.map((deficit) => (
            <article key={deficit.key} className="rounded-lg border border-danger/35 bg-bg/50 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{deficit.label}</span>
                <span className="font-mono text-danger">{deficit.targetDisplay}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted">
                Reference {deficit.viralDisplay} · yours {deficit.targetDisplay}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MiniBar label="Reference" value={100} tone="reference" />
                <MiniBar
                  label="Yours"
                  value={Math.max(4, Math.round((1 - deficit.shortfall) * 100))}
                  tone="gap"
                />
              </div>
              <p className="mt-2 text-sm text-fg">{deficit.note}</p>
            </article>
          ))}
        </div>
      )}
      {result.viral.metrics.views == null || result.target.metrics.views == null ? (
        <p className="mt-3 text-xs text-subtle">
          Views were missing on at least one public payload, so rate gaps that need views were left out.
          Writing gaps still apply.
        </p>
      ) : null}
    </div>
  );
}

function MiniBar({ label, value, tone }: { label: string; value: number; tone: "reference" | "gap" }) {
  return (
    <div>
      <p className="text-xs text-subtle">
        {label} {value}
      </p>
      <div className="mt-1 h-1.5 rounded-full bg-line">
        <div
          className={`h-1.5 rounded-full ${tone === "gap" ? "bg-danger" : "bg-fg"}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function CompareSide({
  title,
  post,
  engagement,
  warn = false,
}: {
  title: string;
  post: PublicXPost;
  engagement: number | null;
  warn?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-danger/40 bg-danger/5" : "border-line bg-bg/40"}`}>
      <p className={`text-xs ${warn ? "text-danger" : "text-subtle"}`}>{title}</p>
      <p className="mt-1 text-sm text-fg">@{post.author.handle || "unknown"}</p>
      <p className="mt-1 line-clamp-4 text-sm text-muted">{post.text}</p>
      <p className="mt-2 font-mono text-xs text-muted">
        {post.metrics.views == null ? "Views unavailable" : `${formatFull(post.metrics.views)} views`}
        {" · "}
        {engagement == null ? "eng. n/a" : formatPct(engagement)}
      </p>
    </div>
  );
}

function LinkLibrary({
  model,
  focusId,
  onFocus,
  onReload,
}: {
  model: PulseModel;
  focusId: string | null;
  onFocus: (id: string) => void;
  onReload?: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === model.posts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(model.posts.map((p) => p.id)));
    }
  }

  async function removeSelected() {
    if (!selected.size) return;
    if (model.mode === "sample") {
      setNote("Sample library cannot be edited. Unlock Your Chamber to manage real history.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await deletePosts({ data: { ids: [...selected] } });
      setSelected(new Set());
      onReload?.();
      setNote("Selected items removed.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!model.posts.length) return;
    if (model.mode === "sample") {
      setNote("Sample library cannot be edited. Unlock Your Chamber to manage real history.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await clearPosts();
      setSelected(new Set());
      onReload?.();
      setNote("History cleared.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not clear history.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5">
      <p className="kicker">History</p>
      <h2 className="mt-1 text-2xl tracking-tight">Your links</h2>
      <p className="mt-2 text-sm text-muted">
        One link at a time drives the graph. Select items to remove them from history.
      </p>
      {model.posts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="quiet" onClick={toggleAll} disabled={busy}>
            {selected.size === model.posts.length ? "Deselect all" : "Select all"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy || selected.size === 0}
            onClick={() => void removeSelected()}
          >
            Delete selected ({selected.size})
          </Button>
          <Button type="button" variant="quiet" disabled={busy} onClick={() => void removeAll()}>
            Clear all
          </Button>
        </div>
      ) : null}
      {note ? (
        <p className="mt-3 text-sm text-muted" role="status">
          {note}
        </p>
      ) : null}
      {model.posts.length === 0 ? (
        <EmptyState text="No links yet. Paste a post URL in the field above to analyze one." />
      ) : (
        <ul className="mt-4 grid gap-2">
          {model.posts.map((post) => {
            const on = focusId === post.id;
            const checked = selected.has(post.id);
            return (
              <li key={post.id} className="flex items-stretch gap-2">
                <label className="flex items-center px-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(post.id)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    aria-label={`Select ${post.type}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onFocus(post.id)}
                  className={`lift-card flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    on ? "border-accent/70 bg-accent/10 text-fg" : "border-line bg-bg/40 text-fg"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tracking-wide text-subtle uppercase">
                      {post.type} · {formatWhen(post.publishedAt)}
                    </span>
                    {on ? (
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 font-mono text-[10px] tracking-wider text-accent uppercase">
                        Focus
                      </span>
                    ) : null}
                  </div>
                  <span className="line-clamp-3 text-sm leading-relaxed">{post.text}</span>
                  <span className="font-mono text-xs text-muted tabular-nums">
                    {formatCompact(post.metrics.impressions)} views · {formatPct(engagementRate(post.metrics))}{" "}
                    engagement
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {model.mode === "sample" ? (
        <p className="mt-4 text-sm text-muted">This set is a rehearsal. It is not your account.</p>
      ) : null}
    </div>
  );
}


function LinkMetricsChart({ post }: { post: PulsePost }) {
  const m = post.metrics;
  const data = [
    { name: "Likes", value: m.likes, fill: "var(--color-accent)" },
    { name: "Replies", value: m.replies, fill: "var(--color-signal)" },
    { name: "Reposts", value: m.reposts, fill: "var(--color-flare)" },
    { name: "Saves", value: m.bookmarks, fill: "#7dd3fc" },
    { name: "Profile", value: m.profileClicks || 0, fill: "#a78bfa" },
  ].filter((d) => d.value > 0);
  if (!data.length) {
    return <p className="text-sm text-muted">No engagement breakdown available for this link.</p>;
  }
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--color-subtle)", fontSize: 11 }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-subtle)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--color-accent) 8%, transparent)" }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="kicker">Waiting</p>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted">{text}</p>
    </div>
  );
}
