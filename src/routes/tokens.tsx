import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import {
  explorerUrl,
  researchToken,
  type TokenIntel,
  type TokenSearchHit,
} from "@/lib/xpulse/token-intel";
import { generateFromToken } from "@/lib/xpulse/content-create";
import type { ContentKind } from "@/lib/xpulse/content-score";
import { ScoreCard } from "@/components/intel/ScoreCard";

export const Route = createFileRoute("/tokens")({
  head: () => ({ meta: [{ title: "Token intelligence · XPulse" }] }),
  component: TokensPage,
});

function formatUsd(n: number | null) {
  if (n == null) return "Data unavailable";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | null) {
  if (n == null) return "Data unavailable";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

function TokensPage() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<TokenSearchHit[] | null>(null);
  const [intel, setIntel] = useState<TokenIntel | null>(null);
  const [content, setContent] = useState<ReturnType<typeof generateFromToken> | null>(null);
  const [copied, setCopied] = useState(false);

  async function runSearch(value?: string) {
    const q = (value ?? query).trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setHits(null);
    setIntel(null);
    setContent(null);
    try {
      const result = await researchToken(q);
      if (result.kind === "empty") {
        setError("No matching Solana token found. Check the name or contract address.");
      } else if (result.kind === "choices") {
        setHits(result.hits);
      } else {
        setIntel(result.intel);
      }
    } catch {
      setError("Some market data is temporarily unavailable. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  async function selectHit(address: string) {
    setQuery(address);
    await runSearch(address);
  }

  function copyCa(address: string) {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function createContent(kind: ContentKind) {
    if (!intel) return;
    setContent(generateFromToken(intel, kind));
  }

  return (
    <WorkspaceShell
      active="/tokens"
      kicker="Solana"
      title="Token intelligence"
    >
      <section className="panel p-4 sm:p-5">
        <label className="block">
          <span className="kicker">Search</span>
          <input
            className="mt-2 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg outline-none ring-accent focus:ring-1"
            placeholder="Token name or contract address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
          />
        </label>
        <p className="mt-2 text-xs text-subtle">
          Examples: BONK · SOL · paste a Solana contract address
        </p>
        <Button
          type="button"
          className="mt-4"
          disabled={busy || !query.trim()}
          onClick={() => void runSearch()}
        >
          {busy ? "Researching…" : "Research token"}
        </Button>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="status">
            {error}
          </p>
        ) : null}
      </section>

      {hits && hits.length > 0 ? (
        <section className="panel p-4">
          <p className="kicker">Multiple matches</p>
          <p className="mt-1 text-sm text-muted">Select the correct token.</p>
          <ul className="mt-4 space-y-2">
            {hits.map((h) => (
              <li key={h.address}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-3 text-left transition hover:border-accent/40"
                  onClick={() => void selectHit(h.address)}
                >
                  {h.logoUrl ? (
                    <img src={h.logoUrl} alt="" className="h-9 w-9 rounded-full" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-line font-mono text-xs">
                      {h.symbol.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">
                      {h.name}{" "}
                      <span className="text-muted">({h.symbol})</span>
                    </span>
                    <span className="block truncate font-mono text-xs text-subtle">
                      {h.address}
                    </span>
                  </span>
                  <span className="text-right text-xs text-muted">
                    {formatPrice(h.priceUsd)}
                    <br />
                    Liq {formatUsd(h.liquidityUsd)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {intel ? (
        <>
          <section className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-4">
              {intel.identity.logoUrl ? (
                <img
                  src={intel.identity.logoUrl}
                  alt=""
                  className="h-14 w-14 rounded-full border border-line"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <h2 className="text-xl">
                  {intel.identity.name}{" "}
                  <span className="text-muted">({intel.identity.symbol})</span>
                </h2>
                <p className="mt-1 font-mono text-xs text-subtle break-all">
                  {intel.identity.address}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="quiet" onClick={() => copyCa(intel.identity.address)}>
                    {copied ? "Copied" : "Copy CA"}
                  </Button>
                  <a
                    className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
                    href={explorerUrl(intel.identity.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open explorer
                  </a>
                  {intel.identity.website ? (
                    <a
                      className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
                      href={intel.identity.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Website
                    </a>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-subtle">
                Data updated{" "}
                {new Date(intel.freshness).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Price", formatPrice(intel.market.priceUsd)],
                [
                  "24h",
                  intel.market.priceChange24h != null
                    ? `${intel.market.priceChange24h >= 0 ? "+" : ""}${intel.market.priceChange24h.toFixed(1)}%`
                    : "Data unavailable",
                ],
                ["Liquidity", formatUsd(intel.market.liquidityUsd)],
                ["24h volume", formatUsd(intel.market.volume24h)],
                ["Market cap", formatUsd(intel.market.marketCap)],
                ["FDV", formatUsd(intel.market.fdv)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-line bg-surface-2/50 px-3 py-3">
                  <p className="text-xs text-subtle">{label}</p>
                  <p className="mt-1 font-mono text-sm text-fg">{value}</p>
                </div>
              ))}
            </div>

            {intel.chart.length > 1 ? (
              <div className="mt-6">
                <p className="kicker">Price path (approx.)</p>
                <MiniSpark points={intel.chart.map((p) => p.price)} />
              </div>
            ) : null}
          </section>

          <section className="panel space-y-4 p-4 sm:p-5">
            <p className="kicker">Analysis</p>
            <AnalysisBlock title="Snapshot" body={intel.analysis.snapshot} />
            <AnalysisBlock title="Market structure" body={intel.analysis.marketStructure} />
            <AnalysisBlock title="Liquidity" body={intel.analysis.liquidity} />
            <AnalysisBlock title="Activity" body={intel.analysis.activity} />
            <AnalysisBlock title="Narrative" body={intel.analysis.narrative} />
            <div>
              <p className="text-sm text-fg">Risks / flags</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {intel.analysis.risks.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-subtle">
              Informational only. Not financial advice. Missing fields are marked unavailable —
              never estimated.
            </p>
          </section>

          <section className="panel p-4 sm:p-5">
            <p className="kicker">Create content from this research</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["post", "thread", "article"] as ContentKind[]).map((k) => (
                <Button key={k} type="button" variant="quiet" onClick={() => createContent(k)}>
                  {k === "post" ? "Post" : k === "thread" ? "Thread" : "Article"}
                </Button>
              ))}
              <Link to="/create" className="inline-flex h-11 items-center px-3 text-sm text-accent">
                Open full create workspace →
              </Link>
            </div>
          </section>

          {content ? (
            <section className="space-y-4">
              <div className="panel p-4 sm:p-5">
                <p className="kicker">
                  {content.kind} · {content.angle.label}
                </p>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
                  {content.text}
                </pre>
                <Button
                  type="button"
                  className="mt-4"
                  variant="quiet"
                  onClick={() => void navigator.clipboard.writeText(content.text)}
                >
                  Copy
                </Button>
              </div>
              <ScoreCard report={content.score} />
            </section>
          ) : null}
        </>
      ) : null}
    </WorkspaceShell>
  );
}

function AnalysisBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm text-fg">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

function MiniSpark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 320;
  const h = 64;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full max-w-md text-accent" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
