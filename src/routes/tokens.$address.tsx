import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { generateFromToken } from "@/lib/xpulse/content-create";
import type { ContentKind } from "@/lib/xpulse/content-score";
import {
  explorerUrl,
  researchTokenByAddress,
  type TokenIntel,
  type TokenMention,
} from "@/lib/xpulse/token-intel";

export const Route = createFileRoute("/tokens/$address")({
  head: ({ params }) => ({
    meta: [
      {
        title: `Token · ${(params.address ?? "…").slice(0, 8)}… · XPulse`,
      },
    ],
  }),
  component: TokenDetailPage,
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

function formatPct(n: number | null) {
  if (n == null) return "Data unavailable";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function kindLabel(kind: TokenMention["kind"]) {
  switch (kind) {
    case "official":
      return "Official";
    case "kol":
      return "KOL";
    case "politician":
      return "Politician";
    case "verified":
      return "Verified";
    default:
      return "Account";
  }
}

function TokenDetailPage() {
  const params = Route.useParams();
  const rawAddress = params.address ?? "";
  let address = rawAddress;
  try {
    address = decodeURIComponent(rawAddress);
  } catch {
    /* keep */
  }

  const [intel, setIntel] = useState<TokenIntel | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [content, setContent] = useState<ReturnType<typeof generateFromToken> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setBusy(false);
      setError("Missing token address.");
      return;
    }
    setBusy(true);
    setError(null);
    setIntel(null);
    setContent(null);

    void researchTokenByAddress(address)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError(
            "Token not found or no Solana market pairs available for this address.",
          );
          return;
        }
        setIntel(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Some data is temporarily unavailable. Try again shortly.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  function copyCa() {
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
      kicker="Solana token"
      title={intel ? `${intel.identity.name} (${intel.identity.symbol})` : "Token"}
    >
      <p className="text-sm text-muted">
        <Link to="/tokens" className="text-accent hover:underline">
          ← All tokens
        </Link>
      </p>

      {busy ? (
        <section className="panel p-6">
          <p className="kicker">Loading</p>
          <p className="mt-2 text-sm text-muted">
            Fetching market data, DEX listing status, and public signals…
          </p>
          <p className="mt-2 break-all font-mono text-xs text-subtle">{address}</p>
        </section>
      ) : null}

      {error ? (
        <section className="panel p-6">
          <p className="text-sm text-danger">{error}</p>
          <p className="mt-2 break-all font-mono text-xs text-subtle">{address}</p>
          <Link to="/tokens" className="mt-4 inline-block text-sm text-accent">
            Back to search
          </Link>
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
                  className="h-16 w-16 rounded-full border border-line"
                />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-full border border-line bg-surface-2 font-mono text-sm">
                  {intel.identity.symbol.slice(0, 3)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl tracking-tight">
                  {intel.identity.name}{" "}
                  <span className="text-muted">({intel.identity.symbol})</span>
                </h2>
                <p className="mt-1 font-mono text-xs text-subtle break-all">
                  {intel.identity.address}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="quiet" onClick={copyCa}>
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
                  {intel.market.pairUrl ? (
                    <a
                      className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
                      href={intel.market.pairUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open pair
                    </a>
                  ) : null}
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
                  {intel.identity.twitter ? (
                    <a
                      className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
                      href={intel.identity.twitter}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Official X
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

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Price", formatPrice(intel.market.priceUsd)],
                ["24h change", formatPct(intel.market.priceChange24h)],
                ["6h change", formatPct(intel.market.priceChange6h)],
                ["1h change", formatPct(intel.market.priceChange1h)],
                ["Liquidity", formatUsd(intel.market.liquidityUsd)],
                ["24h volume", formatUsd(intel.market.volume24h)],
                ["6h volume", formatUsd(intel.market.volume6h)],
                ["1h volume", formatUsd(intel.market.volume1h)],
                ["Market cap", formatUsd(intel.market.marketCap)],
                ["FDV", formatUsd(intel.market.fdv)],
                [
                  "24h buys / sells",
                  intel.market.buys24h != null || intel.market.sells24h != null
                    ? `${intel.market.buys24h ?? "—"} / ${intel.market.sells24h ?? "—"}`
                    : "Data unavailable",
                ],
                ["DEX", intel.market.dexId ? intel.market.dexId.toUpperCase() : "Data unavailable"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-line bg-surface-2/50 px-3 py-3">
                  <p className="text-xs text-subtle">{label}</p>
                  <p className="mt-1 font-mono text-sm text-fg">{value}</p>
                </div>
              ))}
            </div>

            {intel.chart.length > 1 ? (
              <div className="mt-6">
                <p className="kicker">Price path</p>
                <MiniSpark points={intel.chart.map((p) => p.price)} />
              </div>
            ) : null}
          </section>

          <section className="panel space-y-3 p-4 sm:p-5">
            <p className="kicker">DEX listing payment</p>
            <h2 className="text-xl">Paid promotion on public DEX listings</h2>
            {intel.market.paidListing === true ? (
              <p className="rounded-md border border-signal/40 bg-signal/10 px-4 py-3 text-sm text-fg">
                <span className="font-medium text-signal">Yes — paid activity detected.</span>
                <span className="mt-1 block text-muted">
                  {intel.market.paidListingDetail ??
                    "This token has paid profile/boost orders on public listing data."}
                </span>
              </p>
            ) : intel.market.paidListing === false ? (
              <p className="rounded-md border border-line bg-surface-2/50 px-4 py-3 text-sm text-muted">
                <span className="font-medium text-fg">No paid listing detected.</span>
                <span className="mt-1 block">
                  No paid profile or boost orders found in public listing data for this address.
                </span>
              </p>
            ) : (
              <p className="rounded-md border border-line bg-surface-2/50 px-4 py-3 text-sm text-muted">
                Paid-listing status unavailable right now.
              </p>
            )}
            <p className="text-xs text-subtle">
              This reflects public listing promotion signals only — not whether the token itself charges
              fees, and not financial advice.
            </p>
          </section>

          <section className="panel space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="kicker">Virality signals</p>
                <h2 className="text-xl">Activity ranking factors</h2>
              </div>
              <p className="font-mono text-2xl text-accent tabular-nums">
                {intel.market.viralScore != null ? intel.market.viralScore : "—"}
                <span className="text-sm text-muted"> / score</span>
              </p>
            </div>
            {intel.market.viralReasons.length ? (
              <ul className="space-y-1 text-sm text-muted">
                {intel.market.viralReasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No strong virality factors from the current snapshot.</p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <MetricChip
                label="Volume weight"
                value={
                  intel.market.volume24h != null
                    ? formatUsd(intel.market.volume24h)
                    : "unavailable"
                }
              />
              <MetricChip
                label="Move 24h"
                value={formatPct(intel.market.priceChange24h)}
              />
              <MetricChip
                label="Liquidity"
                value={
                  intel.market.liquidityUsd != null
                    ? formatUsd(intel.market.liquidityUsd)
                    : "unavailable"
                }
              />
            </div>
          </section>

          <section className="panel space-y-4 p-4 sm:p-5">
            <p className="kicker">Analysis</p>
            <Block title="Snapshot" body={intel.analysis.snapshot} />
            <Block title="Market structure" body={intel.analysis.marketStructure} />
            <Block title="Liquidity" body={intel.analysis.liquidity} />
            <Block title="Activity" body={intel.analysis.activity} />
            <Block title="Narrative" body={intel.analysis.narrative} />
            <div>
              <p className="text-sm text-fg">Risks / flags</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {intel.analysis.risks.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-subtle">
              Informational only. Not financial advice. Missing fields stay unavailable — never
              estimated.
            </p>
          </section>

          <section className="panel space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="kicker">X mentions & notable accounts</p>
                <h2 className="mt-1 text-xl">Public social signals</h2>
              </div>
              <p className="font-mono text-xs text-subtle">
                {intel.mentions.totalFound != null
                  ? `${intel.mentions.totalFound} public post(s) surfaced`
                  : "Mention count unavailable"}
              </p>
            </div>
            <p className="text-sm text-muted">{intel.mentions.note}</p>
            {intel.mentions.items.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-muted">
                No verified public mention feed for this token at the moment. Official links and
                market data above remain the source of truth.
              </p>
            ) : (
              <ul className="space-y-3">
                {intel.mentions.items.map((m, i) => (
                  <li
                    key={`${m.handle}-${i}`}
                    className="rounded-md border border-line bg-surface-2/40 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-fg">
                        {m.author} <span className="text-muted">@{m.handle}</span>
                      </span>
                      {m.verified ? (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                          Verified
                        </span>
                      ) : null}
                      <span className="rounded-full bg-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-subtle">
                        {kindLabel(m.kind)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-fg/90">{m.text}</p>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-accent hover:underline"
                    >
                      View on X →
                    </a>
                  </li>
                ))}
              </ul>
            )}
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
                Open create workspace →
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

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-sm text-fg">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2/40 px-3 py-2">
      <p className="text-[11px] text-subtle">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-fg">{value}</p>
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
