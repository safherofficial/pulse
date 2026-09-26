import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { researchTokenIntel } from "@/lib/xpulse/api";
import {
  attachXPatterns,
  buildTokenFactSet,
  generateFromFactSet,
  regenerateFromFactSet,
  type RegenMode,
  type TokenFactSet,
} from "@/lib/xpulse/content-create";
import { researchXContentIntel } from "@/lib/xpulse/x-content-intel";
import type { ContentKind } from "@/lib/xpulse/content-score";
import type { GeneratedContent } from "@/lib/xpulse/content-create";
import {
  chainLabel,
  detectTokenInput,
  explorerUrl,
  fetchTokenOhlcv,
  fetchViralSolanaTokens,
  researchToken,
  researchTokenByAddress,
  type ChartTimeframe,
  type OhlcvCandle,
  type TokenIntel,
  type TokenMention,
  type TokenSearchHit,
  type ViralToken,
} from "@/lib/xpulse/token-intel";

type TokensSearch = { ca?: string };

export const Route = createFileRoute("/tokens")({
  head: () => ({ meta: [{ title: "Token intelligence · XPulse" }] }),
  validateSearch: (search: Record<string, unknown>): TokensSearch => ({
    ca: typeof search.ca === "string" && search.ca.length > 0 ? search.ca : undefined,
  }),
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

function formatPct(n: number | null) {
  if (n == null) return "Data unavailable";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Human-readable market cap with full and short forms. */
function formatMcap(n: number | null): { short: string; full: string } {
  if (n == null) return { short: "—", full: "Data unavailable" };
  const full = n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1 ? 0 : 4,
  });
  if (n >= 1e9) return { short: `$${(n / 1e9).toFixed(2)}B`, full };
  if (n >= 1e6) return { short: `$${(n / 1e6).toFixed(2)}M`, full };
  if (n >= 1e3) return { short: `$${(n / 1e3).toFixed(1)}K`, full };
  return { short: full, full };
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

function TokensPage() {
  const navigate = useNavigate();
  const { ca } = Route.useSearch();

  // Detail mode when ?ca= is present
  if (ca) {
    return <TokenDetailView address={ca} />;
  }

  return <TokenListView onOpen={(address) => {
    void navigate({ to: "/tokens", search: { ca: address } });
  }} />;
}

function TokenListView({ onOpen }: { onOpen: (address: string) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<TokenSearchHit[] | null>(null);
  const [viral, setViral] = useState<ViralToken[]>([]);
  const [viralBusy, setViralBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setViralBusy(true);
    void fetchViralSolanaTokens(10)
      .then((rows) => {
        if (!cancelled) setViral(rows);
      })
      .catch(() => {
        if (!cancelled) setViral([]);
      })
      .finally(() => {
        if (!cancelled) setViralBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch(value?: string) {
    const q = (value ?? query).trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setHits(null);
    try {
      if (detectTokenInput(q) === "address") {
        onOpen(q);
        return;
      }
      const result = await researchToken(q);
      if (result.kind === "empty") {
        setError("No matching token found. Check the name, symbol, or contract address.");
      } else if (result.kind === "choices") {
        setHits(result.hits);
      } else {
        onOpen(result.intel.identity.address);
      }
    } catch {
      setError("Some market data is temporarily unavailable. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspaceShell active="/tokens" kicker="Solana" title="Token intelligence · multi-chain">
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
          Name, symbol, or contract — Solana, Ethereum, Base, BNB, Arbitrum, and more
        </p>
        <Button
          type="button"
          className="mt-4"
          disabled={busy || !query.trim()}
          onClick={() => void runSearch()}
        >
          {busy ? "Searching…" : "Research token"}
        </Button>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="status">
            {error}
          </p>
        ) : null}
      </section>

      {hits && hits.length > 0 ? (
        <section className="panel p-4">
          <p className="kicker">Search results</p>
          <p className="mt-1 text-sm text-muted">Select a token to open its full detail.</p>
          <ul className="mt-4 space-y-2">
            {hits.map((h) => (
              <li key={h.address}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-3 text-left transition hover:border-accent/40"
                  onClick={() => onOpen(h.address)}
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
                      {h.name} <span className="text-muted">({h.symbol})</span>
                      {"chain" in h && (h as { chain?: string }).chain ? (
                        <span className="ml-2 font-mono text-[10px] text-accent">
                          {chainLabel((h as { chain: string }).chain)}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate font-mono text-xs text-subtle">{h.address}</span>
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

      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="kicker">Moving now</p>
            <h2 className="mt-1 text-xl">Solana tokens with activity</h2>
          </div>
          <p className="text-xs text-subtle">
            Ranked by volume, move, and liquidity · not financial advice
          </p>
        </div>
        {viralBusy ? (
          <p className="mt-4 text-sm text-muted">Loading market activity…</p>
        ) : viral.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Market activity temporarily unavailable.</p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {viral.map((t) => (
              <li key={t.address}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-3 text-left transition hover:border-accent/40"
                  onClick={() => onOpen(t.address)}
                >
                  {t.logoUrl ? (
                    <img src={t.logoUrl} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-line font-mono text-[10px]">
                      {t.symbol.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {t.name} <span className="text-muted">({t.symbol})</span>
                    </span>
                    <span className="block truncate text-xs text-subtle">{t.reason}</span>
                  </span>
                  <span className="text-right font-mono text-xs">
                    <span
                      className={
                        t.priceChange24h != null && t.priceChange24h >= 0
                          ? "text-signal"
                          : "text-danger"
                      }
                    >
                      {t.priceChange24h != null
                        ? `${t.priceChange24h >= 0 ? "+" : ""}${t.priceChange24h.toFixed(1)}%`
                        : "—"}
                    </span>
                    <br />
                    <span className="text-subtle">score {t.viralScore}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}

function TokenDetailView({ address: rawAddress }: { address: string }) {
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
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [factSet, setFactSet] = useState<TokenFactSet | null>(null);
  const [variant, setVariant] = useState(0);
  const [regenMode, setRegenMode] = useState<RegenMode>("default");

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

    async function load() {
      try {
        let row: TokenIntel | null = null;
        try {
          row = (await researchTokenIntel({ data: { address } })) as TokenIntel | null;
        } catch {
          row = await researchTokenByAddress(address);
        }
        if (cancelled) return;
        if (!row) {
          setError("Contract address not recognized — no market pairs available for this address.");
          return;
        }
        setIntel(row);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Some data is temporarily unavailable. Try again shortly.",
          );
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  function copyCa() {
    void navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function createContent(kind: ContentKind) {
    if (!intel) return;
    let facts = factSet ?? buildTokenFactSet(intel);
    // X research once per fact set — regenerations reuse it
    if (!facts.xPatterns.length && facts.xNote == null) {
      try {
        const xIntel = await researchXContentIntel(intel);
        facts = attachXPatterns(
          facts,
          xIntel.patterns.map((p) => p.pattern),
          xIntel.note,
        );
      } catch {
        facts = attachXPatterns(facts, [], "X content sample unavailable.");
      }
    }
    setFactSet(facts);
    const next = generateFromFactSet(facts, kind, regenMode, variant);
    setContent(next);
    setVariant((v) => v + 1);
  }

  function regenerate() {
    if (!content || !factSet) return;
    const next = regenerateFromFactSet(factSet, content.kind, regenMode, variant);
    setContent(next);
    setVariant((v) => v + 1);
  }

  return (
    <WorkspaceShell
      active="/tokens"
      kicker="Solana token"
      title={intel ? `${intel.identity.name} (${intel.identity.symbol})` : "Token"}
    >
      <p className="text-sm text-muted">
        <Link to="/tokens" search={{}} className="text-accent hover:underline">
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
          <Link to="/tokens" search={{}} className="mt-4 inline-block text-sm text-accent">
            Back to search
          </Link>
        </section>
      ) : null}

      {intel ? (
        <>
          <section className="panel animate-in p-4 sm:p-5">
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
                <p className="mt-1 text-sm text-accent">{chainLabel(intel.identity.chain)}</p>
                <p className="mt-1 font-mono text-xs text-subtle break-all">
                  {intel.identity.address}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="quiet" onClick={copyCa}>
                    {copied ? "Copied" : "Copy CA"}
                  </Button>
                  <a
                    className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-muted hover:text-fg"
                    href={explorerUrl(intel.identity.address, intel.identity.chain)}
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

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-4 sm:col-span-1">
                <p className="text-xs tracking-wide text-subtle uppercase">Market cap</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
                  {formatMcap(intel.market.marketCap).short}
                </p>
                <p className="mt-1 text-xs text-muted">{formatMcap(intel.market.marketCap).full}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/50 px-4 py-4">
                <p className="text-xs tracking-wide text-subtle uppercase">FDV</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
                  {formatMcap(intel.market.fdv).short}
                </p>
                <p className="mt-1 text-xs text-muted">{formatMcap(intel.market.fdv).full}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/50 px-4 py-4">
                <p className="text-xs tracking-wide text-subtle uppercase">Liquidity</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
                  {formatMcap(intel.market.liquidityUsd).short}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {intel.market.marketCap && intel.market.liquidityUsd
                    ? `${((intel.market.liquidityUsd / intel.market.marketCap) * 100).toFixed(1)}% of mcap`
                    : formatMcap(intel.market.liquidityUsd).full}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Price", formatPrice(intel.market.priceUsd)],
                ["24h change", formatPct(intel.market.priceChange24h)],
                ["6h change", formatPct(intel.market.priceChange6h)],
                ["1h change", formatPct(intel.market.priceChange1h)],
                ["Liquidity", formatUsd(intel.market.liquidityUsd)],
                ["24h volume", formatUsd(intel.market.volume24h)],
                ["6h volume", formatUsd(intel.market.volume6h)],
                ["1h volume", formatUsd(intel.market.volume1h)],
                ["Market cap", formatMcap(intel.market.marketCap).short],
                ["FDV", formatMcap(intel.market.fdv).short],
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

            <div className="mt-6">
              <PriceChartPanel
                pairAddress={intel.market.pairAddress}
                fallback={intel.chart.map((p) => ({ t: p.t, close: p.price }))}
              />
            </div>
          </section>

          <section className="panel space-y-3 p-4 sm:p-5 animate-in">
            <p className="kicker">DEX Paid check</p>
            <h2 className="text-xl">Same public signal as CheckDEX</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div
                className={`rounded-md border px-4 py-3 ${
                  intel.market.dexPaid
                    ? "border-signal/40 bg-signal/10"
                    : "border-line bg-surface-2/50"
                }`}
              >
                <p className="text-xs text-subtle">DEX Paid (Enhanced Token Info)</p>
                <p className="mt-1 text-lg font-medium text-fg">
                  {intel.market.dexPaid === true
                    ? "PAID"
                    : intel.market.dexPaid === false
                      ? "NOT PAID"
                      : "UNKNOWN"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {intel.market.dexPaid === true
                    ? "Enhanced Token Info approved."
                    : intel.market.dexPaid === false
                      ? "No approved profile order found."
                      : "Could not verify paid status from public listing data."}
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-2/50 px-4 py-3">
                <p className="text-xs text-subtle">Active boosts</p>
                <p className="mt-1 text-lg font-medium text-fg">
                  {intel.market.boostActive != null ? intel.market.boostActive : "—"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Live boost count when exposed on the pair.
                </p>
              </div>
            </div>
            <p className="text-sm text-muted">
              {intel.market.paidListingDetail ?? "Paid-listing detail unavailable."}
            </p>
            <p className="text-xs text-subtle">
              Marketing signal only — not a quality or safety rating.
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
                No verified public mention feed for this token at the moment.
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

          <section className="panel space-y-3 p-4 sm:p-5 animate-in">
            <p className="kicker">Create content from this research</p>
            <p className="text-sm text-muted">
              Facts are locked from the research above. Regeneration rewrites structure and
              language only — numbers stay the same.
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["default", "Default"],
                  ["stronger_hook", "Stronger hook"],
                  ["more_professional", "More professional"],
                  ["more_viral", "More viral"],
                  ["more_technical", "More technical"],
                  ["more_human", "More human"],
                  ["more_concise", "More concise"],
                  ["more_data", "More data-driven"],
                  ["more_story", "More story"],
                  ["different_angle", "Different angle"],
                ] as [RegenMode, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRegenMode(id)}
                  className={`h-8 rounded-md px-2.5 text-xs transition ${
                    regenMode === id
                      ? "border border-accent/40 bg-accent/15 text-accent"
                      : "border border-line text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["post", "thread", "article"] as ContentKind[]).map((k) => (
                <Button key={k} type="button" variant="quiet" onClick={() => void createContent(k)}>
                  {k === "post" ? "Generate post" : k === "thread" ? "Generate thread" : "Generate article"}
                </Button>
              ))}
              {content ? (
                <Button type="button" onClick={regenerate}>
                  Regenerate (unlimited)
                </Button>
              ) : null}
            </div>
          </section>

          {content ? (
            <section className="space-y-4 animate-in">
              <div className="panel p-4 sm:p-5">
                <p className="kicker">
                  {content.kind} · {content.angle.label} · {regenMode}
                </p>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
                  {content.text}
                </pre>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => void navigator.clipboard.writeText(content.text)}
                  >
                    Copy
                  </Button>
                  <Button type="button" variant="quiet" onClick={regenerate}>
                    Regenerate
                  </Button>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-subtle">
                  {content.applied.map((a) => (
                    <li key={a}>• {a}</li>
                  ))}
                </ul>
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

const TIMEFRAMES: { id: ChartTimeframe; label: string }[] = [
  { id: "1m", label: "1m" },
  { id: "3m", label: "3m" },
  { id: "5m", label: "5m" },
  { id: "1h", label: "1h" },
  { id: "4h", label: "4h" },
  { id: "12h", label: "12h" },
  { id: "1M", label: "1M" },
];

function PriceChartPanel({
  pairAddress,
  fallback,
}: {
  pairAddress: string | null;
  fallback: Array<{ t: number; close: number }>;
}) {
  const [tf, setTf] = useState<ChartTimeframe>("1h");
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setNote(null);
    void fetchTokenOhlcv(pairAddress, tf)
      .then((rows) => {
        if (cancelled) return;
        if (rows.length >= 2) {
          setCandles(rows);
          setNote(null);
        } else {
          setCandles([]);
          setNote("Live candles unavailable for this timeframe — showing snapshot path.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCandles([]);
          setNote("Chart data temporarily unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pairAddress, tf]);

  const series =
    candles.length >= 2
      ? candles.map((c) => ({ t: c.t, close: c.close }))
      : fallback;

  return (
    <div className="animate-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="kicker">Price chart</p>
        <div className="flex flex-wrap gap-1">
          {TIMEFRAMES.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTf(x.id)}
              className={`h-8 rounded-md px-2.5 font-mono text-xs transition ${
                tf === x.id
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "border border-line text-muted hover:text-fg"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {busy ? (
        <p className="mt-3 text-sm text-muted">Loading {tf} candles…</p>
      ) : null}
      {note ? <p className="mt-2 text-xs text-subtle">{note}</p> : null}
      <PriceLine series={series} />
    </div>
  );
}

function PriceLine({ series }: { series: Array<{ t: number; close: number }> }) {
  if (series.length < 2) {
    return <p className="mt-3 text-sm text-muted">Not enough points to draw a chart.</p>;
  }
  const prices = series.map((s) => s.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const w = 640;
  const h = 160;
  const d = series
    .map((s, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((s.close - min) / span) * (h - 16) - 8;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = series[series.length - 1]!.close >= series[0]!.close;
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-line bg-surface-2/30 p-2 transition-opacity duration-300">
      <svg viewBox={`0 0 ${w} ${h}`} className={`h-40 w-full ${up ? "text-signal" : "text-danger"}`} aria-hidden>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-subtle">
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
    </div>
  );
}
