import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { PulseCanvas } from "@/components/scene/PulseCanvas";
import { AnalyzeLinkField } from "@/components/pulse/AnalyzeLinkField";
import { Button, fieldClass } from "@/components/ui/button";
import { beginXConnect, compareXUrls, importPost, syncPosts } from "@/lib/xpulse/api";
import { extractPostId, formatCompact, formatDwell, formatFull, formatMaybe, formatPct, formatWhen } from "@/lib/xpulse/format";
import { engagementRate, publicMetricsEngagement, writingSignals } from "@/lib/xpulse/metrics";
import { usePulseStore, type ChamberView } from "@/lib/xpulse/store";
import type { ImportInput, PostType, PublicCompareResult, PublicXPost, PulseModel, PulsePost, WritingSignals } from "@/lib/xpulse/types";

const VIEWS: { id: ChamberView; label: string; key: string }[] = [
  { id: "overview", label: "Overview", key: "1" },
  { id: "graph", label: "Signal graph", key: "2" },
  { id: "compare", label: "Compare", key: "3" },
  { id: "library", label: "Link library", key: "4" },
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

function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const apply = () => setCompact(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return compact;
}

export function Chamber({ model, onReload }: { model: PulseModel; onReload?: () => void }) {
  const compact = useCompact();
  const view = usePulseStore((s) => s.view);
  const setView = usePulseStore((s) => s.setView);
  const focusId = usePulseStore((s) => s.focusId);
  const setFocus = usePulseStore((s) => s.setFocus);
  const reset = usePulseStore((s) => s.reset);
  const [compare, setCompare] = useState<PublicCompareResult | null>(null);
  const pendingId = useRef<string | null>(null);

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

  const activeId = model.posts.some((post) => post.id === focusId) ? focusId : (model.posts[0]?.id ?? null);
  const selectedPost = activeId ? model.posts.find((post) => post.id === activeId) : undefined;
  const signals = selectedPost ? writingSignals(selectedPost.text) : null;
  const graphPost = view === "compare" ? undefined : selectedPost;

  return (
    <div className="relative h-dvh overflow-hidden bg-bg text-fg">
      <div className="absolute inset-0">
        <PulseCanvas
          model={model}
          selectedPost={graphPost}
          compare={view === "compare" ? compare : null}
          mode="chamber"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border-b border-line/80 bg-bg/70 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="shrink-0" aria-label="XPulse home">
              <BrandMark />
            </Link>
            <div className="min-w-0">
              <Link to="/" className="wordmark text-sm">XPulse</Link>
              <p className="truncate font-mono text-xs tracking-wide text-muted">
                {model.mode === "sample" ? "SAMPLE CHAMBER" : "PERSONAL CHAMBER"}
                {" · "}
                {model.handle ? `@${model.handle.replace(/^@/, "")}` : model.creatorName}
              </p>
            </div>
          </div>
          <Link to={model.mode === "sample" ? "/onboard" : "/studio"} className="inline-flex h-11 items-center text-sm text-muted hover:text-accent">
            {model.mode === "sample" ? "Unlock yours" : "Sample"}
          </Link>
        </header>

        {model.mode === "account" ? (
          <div className="pointer-events-auto mx-auto w-full max-w-3xl px-4 sm:px-6">
            <AnalyzeLinkField
              compact
              onImported={(id) => {
                if (id) pendingId.current = id;
                onReload?.();
              }}
            />
          </div>
        ) : null}

        <p className="pointer-events-none px-4 pt-3 font-mono text-xs tracking-widest text-accent/90 sm:px-6">
          {view === "compare"
            ? compare
              ? "Compare graph · reference against the post to improve"
              : "Compare graph · paste both links"
            : selectedPost
              ? `Graph source · this link only${compact ? "" : ` · ${formatCompact(selectedPost.metrics.impressions)} views`}`
              : "Graph source · choose a link"}
        </p>

        <div className="flex-1" />
        <div className="flex flex-col gap-3 p-3 sm:p-6 md:flex-row md:items-end md:justify-between">
          <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto" role="tablist" aria-label="Chamber views">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => setView(item.id)}
                className={`tap h-11 shrink-0 rounded-sm px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${view === item.id ? "tab-on" : "border border-line bg-bg/75 text-muted backdrop-blur-sm hover:border-accent/50 hover:text-fg"}`}
              >
                {item.label}
                <span className="ml-2 hidden font-mono text-xs opacity-60 sm:inline">{item.key}</span>
              </button>
            ))}
          </div>
          <section className="panel pointer-events-auto max-h-[38vh] w-full overflow-auto p-4 backdrop-blur-md sm:max-h-[48vh] md:max-h-[70vh] md:w-[28rem]">
            {view === "overview" ? <OverviewPane post={selectedPost} signals={signals} onLibrary={() => setView("library")} /> : null}
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
        </div>
      </div>
    </div>
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

function OverviewPane({ post, signals, onLibrary }: { post?: PulsePost; signals: WritingSignals | null; onLibrary: () => void }) {
  if (!post) return <EmptyState text="Choose a link in Link library. The graph will use only that post." />;
  const metrics = post.metrics;
  return (
    <div>
      <p className="text-xs text-subtle">Selected link · {formatWhen(post.publishedAt)}</p>
      <h2 className="mt-1 text-lg font-medium">What this post is doing</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <Stat label="Views" value={formatFull(metrics.impressions)} accent />
        <Stat label="Engagement" value={formatPct(engagementRate(metrics))} />
        <Stat label="Likes" value={formatFull(metrics.likes)} />
        <Stat label="Reposts" value={formatFull(metrics.reposts)} />
        <Stat label="Replies" value={formatFull(metrics.replies)} />
        <Stat label="Bookmarks" value={formatFull(metrics.bookmarks)} />
        <Stat label="Opens" value={formatMaybe(metrics.detailExpands)} />
        <Stat label="Dwell" value={formatDwell(metrics.dwellMs)} />
      </dl>
      <p className="mt-4 text-sm text-muted">Back bars are the writing signals of this text. Front bars are its own counts. Nothing from the rest of the account is mixed in.</p>
      {signals ? <SignalGrid signals={signals} /> : null}
      <p className="mt-4 text-sm text-fg">{post.text}</p>
      <button type="button" onClick={onLibrary} className="mt-4 h-11 text-sm text-muted hover:text-fg">
        Choose another link
      </button>
    </div>
  );
}

function GraphPane({ post, signals }: { post?: PulsePost; signals: WritingSignals | null }) {
  if (!post || !signals) return <EmptyState text="Choose a link in Link library to build its signal graph." />;
  return (
    <div>
      <p className="text-xs tracking-widest text-accent">SELECTED LINK ONLY</p>
      <h2 className="mt-1 text-lg font-medium">Writing signal graph</h2>
      <p className="mt-2 text-sm text-muted">The back row is how this post is written. The front row is how this post performed. Both rows use this link alone.</p>
      <SignalGrid signals={signals} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Views" value={formatFull(post.metrics.impressions)} />
        <Stat label="Engagement" value={formatPct(engagementRate(post.metrics))} />
        <Stat label="Dwell" value={formatDwell(post.metrics.dwellMs)} />
        <Stat label="Opens" value={formatMaybe(post.metrics.detailExpands)} />
      </div>
    </div>
  );
}

function SignalGrid({ signals }: { signals: WritingSignals }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {(Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[]).map((key) => (
        <div key={key} className="rounded-md border border-line bg-bg/60 p-2 transition-[border-color] duration-200 hover:border-accent/40">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{SIGNAL_LABELS[key]}</span>
            <span className="font-mono text-fg">{signals[key]}</span>
          </div>
          <div className="mt-2 h-1 bg-line">
            <div className="meter" style={{ width: `${signals[key]}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ComparePane({ result, onResult }: { result: PublicCompareResult | null; onResult: (value: PublicCompareResult | null) => void }) {
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
    <div>
      <p className="text-xs tracking-widest text-accent">TWO PUBLIC LINKS</p>
      <h2 className="mt-1 text-lg font-medium">Viral example against the post to improve</h2>
      <p className="mt-2 text-sm text-muted">Link 1 is the reference. Link 2 is yours. The graph and the list below mark only where link 2 falls short.</p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs text-muted">
          Viral example
          <input className={fieldClass} value={viralUrl} onChange={(event) => setViralUrl(event.target.value)} placeholder="https://x.com/…/status/…" />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Post to improve
          <input className={fieldClass} value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://x.com/…/status/…" />
        </label>
        <Button type="button" disabled={busy} onClick={() => void compare()}>
          {busy ? "Comparing…" : "Compare posts"}
        </Button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
      {result ? <CompareReport result={result} /> : <p className="mt-4 text-sm text-subtle">The 3D graph switches to this pair after both links resolve. Red wireframes are the gap.</p>}
    </div>
  );
}

function CompareReport({ result }: { result: PublicCompareResult }) {
  const viralEngagement = publicMetricsEngagement(result.viral.metrics);
  const targetEngagement = publicMetricsEngagement(result.target.metrics);
  const shortfalls = result.gaps.length + result.deficits.length;
  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-3 border-y border-line py-3">
        <CompareSide title="Viral example" post={result.viral} engagement={viralEngagement} />
        <CompareSide title="Post to improve" post={result.target} engagement={targetEngagement} warn />
      </div>
      <h3 className="mt-5 text-sm font-medium">Where the post to improve falls short</h3>
      {shortfalls === 0 ? (
        <p className="mt-2 text-sm text-accent">No material gap. This post already matches the reference on writing and on the public rates we could read.</p>
      ) : (
        <div className="mt-2 grid gap-2">
          {result.gaps.map((gap) => (
            <article key={gap.signal} className="rounded-md border border-danger/40 bg-bg/60 p-3">
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
            <article key={deficit.key} className="rounded-md border border-danger/40 bg-bg/60 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{deficit.label}</span>
                <span className="font-mono text-danger">{deficit.targetDisplay}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted">Reference {deficit.viralDisplay} · yours {deficit.targetDisplay}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MiniBar label="Reference" value={100} tone="reference" />
                <MiniBar label="Yours" value={Math.max(4, Math.round((1 - deficit.shortfall) * 100))} tone="gap" />
              </div>
              <p className="mt-2 text-sm text-fg">{deficit.note}</p>
            </article>
          ))}
        </div>
      )}
      {result.viral.metrics.views == null || result.target.metrics.views == null ? (
        <p className="mt-3 text-xs text-subtle">Views were missing on at least one public payload, so rate gaps that need views were left out. Writing gaps still apply.</p>
      ) : null}
    </div>
  );
}

function MiniBar({ label, value, tone }: { label: string; value: number; tone: "reference" | "gap" }) {
  return (
    <div>
      <p className="text-xs text-subtle">{label} {value}</p>
      <div className="mt-1 h-1 rounded-full bg-line">
        <div className={`h-1 rounded-full ${tone === "gap" ? "bg-danger" : "bg-fg"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function CompareSide({ title, post, engagement, warn = false }: { title: string; post: PublicXPost; engagement: number | null; warn?: boolean }) {
  return (
    <div>
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
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <p className="text-xs tracking-widest text-accent">LINK LIBRARY</p>
      <h2 className="mt-1 text-lg font-medium">Choose the link the graph should read</h2>
      <p className="mt-2 text-sm text-muted">One link at a time. Selecting a post replaces the graph. It does not average the account.</p>
      {model.posts.length === 0 ? (
        <EmptyState text="No links yet. Paste one above, sync from X, or add the numbers by hand." />
      ) : (
        <ul className="mt-3 grid gap-2">
          {model.posts.map((post) => (
            <li key={post.id}>
              <button
                type="button"
                onClick={() => onFocus(post.id)}
                className={`lift-card flex w-full flex-col gap-1 rounded-md border px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${focusId === post.id ? "border-accent/70 bg-accent/10 text-fg" : "border-line bg-bg/40 text-fg"}`}
              >
                <span className="font-mono text-xs tracking-wide text-subtle uppercase">{post.type} · {formatWhen(post.publishedAt)}</span>
                <span className="line-clamp-3 text-sm">{post.text}</span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {formatFull(post.metrics.impressions)} views · {formatPct(engagementRate(post.metrics))} engagement
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {model.mode === "account" ? (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <p className="text-xs text-subtle">Bring another link in</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void syncPosts()
                  .then((result) => {
                    setNote(result.ok ? `Synced ${result.imported} posts from X.` : "Could not sync from X.");
                    if (result.ok) onReload?.();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Sync from X
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void beginXConnect()
                  .then((result) => {
                    if (result.ok && "url" in result && result.url) {
                      window.location.href = result.url;
                      return;
                    }
                    setNote("message" in result && result.message ? result.message : "Could not start X.");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {model.xApiLinked ? "Reconnect X" : "Connect X API"}
            </Button>
          </div>
          <ImportForm
            busy={busy}
            onSubmit={async (input) => {
              setBusy(true);
              const result = await importPost({ data: input });
              setNote(result.message);
              if (result.ok) onReload?.();
              setBusy(false);
            }}
          />
          {note ? <p className="text-sm text-muted">{note}</p> : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">This set is a rehearsal. It is not your account.</p>
      )}
    </div>
  );
}

function ImportForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: ImportInput) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [xPostId, setXPostId] = useState("");
  const [type, setType] = useState<PostType>("tweet");
  const [text, setText] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [impressions, setImpressions] = useState("0");
  const [likes, setLikes] = useState("0");
  const [replies, setReplies] = useState("0");
  const [reposts, setReposts] = useState("0");
  const [bookmarks, setBookmarks] = useState("0");
  const [profileClicks, setProfileClicks] = useState("0");
  const [linkClicks, setLinkClicks] = useState("0");
  const [detailExpands, setDetailExpands] = useState("0");
  const [dwell, setDwell] = useState("");

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Add numbers by hand
      </Button>
    );
  }

  const num = (value: string) => Math.max(0, Math.floor(Number(value) || 0));

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          xPostId: extractPostId(xPostId),
          type,
          text,
          publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
          impressions: num(impressions),
          likes: num(likes),
          replies: num(replies),
          reposts: num(reposts),
          bookmarks: num(bookmarks),
          profileClicks: num(profileClicks),
          linkClicks: num(linkClicks),
          detailExpands: num(detailExpands),
          dwellMs: dwell.trim() === "" ? null : num(dwell) * 1000,
        });
      }}
    >
      <input className={fieldClass} placeholder="Post URL or id" value={xPostId} onChange={(event) => setXPostId(event.target.value)} required />
      <select className={fieldClass} value={type} onChange={(event) => setType(event.target.value as PostType)}>
        <option value="tweet">Post</option>
        <option value="thread">Thread</option>
        <option value="article">Article</option>
      </select>
      <textarea className={`${fieldClass} h-24 py-2`} placeholder="Text" value={text} onChange={(event) => setText(event.target.value)} required />
      <input className={fieldClass} type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Num label="Views" value={impressions} onChange={setImpressions} />
        <Num label="Opens" value={detailExpands} onChange={setDetailExpands} />
        <Num label="Likes" value={likes} onChange={setLikes} />
        <Num label="Replies" value={replies} onChange={setReplies} />
        <Num label="Reposts" value={reposts} onChange={setReposts} />
        <Num label="Bookmarks" value={bookmarks} onChange={setBookmarks} />
        <Num label="Profile clicks" value={profileClicks} onChange={setProfileClicks} />
        <Num label="Link clicks" value={linkClicks} onChange={setLinkClicks} />
      </div>
      <input className={fieldClass} inputMode="numeric" placeholder="Dwell seconds, if known" value={dwell} onChange={(event) => setDwell(event.target.value)} />
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save this link"}</Button>
    </form>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-xs text-muted">
      {label}
      <input className={fieldClass} inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-4 border border-dashed border-line px-3 py-4">
      <p className="kicker">Waiting</p>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}
