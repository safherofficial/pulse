import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { researchTokenIntel, writeTokenContent } from "@/lib/xpulse/api";
import {
  attachXPatterns,
  buildTokenFactSet,
  type RegenMode,
  type TokenFactSet,
} from "@/lib/xpulse/content-create";
import { researchXContentIntel } from "@/lib/xpulse/x-content-intel";
import { analyzeTokenIntel, type MarketStance, type RugPullRisk } from "@/lib/xpulse/market-state";
import type { ContentKind } from "@/lib/xpulse/content-score";
import type { GeneratedContent } from "@/lib/xpulse/content-create";
import { EDITOR_HANDOFF_KEY, type EditorHandoff } from "@/lib/xpulse/editor/pipeline";
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
  head: () => ({ meta: [{ title: "Token · XPulse" }] }),
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

function stanceLabel(state: MarketStance): string {
  if (state === "SEVERE_RISK") return "SEVERE RISK";
  return state.replaceAll("_", " ");
}

function rugLabel(risk: RugPullRisk): string {
  if (risk === "low") return "LOW";
  if (risk === "elevated") return "ELEVATED";
  if (risk === "unconfirmed") return "UNCONFIRMED — price collapse is not proof of a rug pull";
  if (risk === "high") return "HIGH — multiple signals, not a confirmed theft";
  return "CRITICAL — stacked red flags, not proof funds were taken";
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

  if (ca) {
    return <TokenDetailView address={ca} />;
  }

  return (
    <TokenListView
      onOpen={(address) => {
        void navigate({ to: "/tokens", search: { ca: address } });
      }}
    />
  );
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
    <WorkspaceShell active="/tokens" kicker="Solana" title="Token · multi-chain">
      <CollapsibleSection kicker="Token" title="Search" activityKey={hits?.map((h) => h.address).join("|") || error || null}>
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
          {busy ? "Searching…" : "Look up token"}
        </Button>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="status">
            {error}
          </p>
        ) : null}
      </CollapsibleSection>

      {hits && hits.length > 0 ? (
        <CollapsibleSection kicker="Results" title="Search results" activityKey={hits?.map((h) => h.address).join("|") || null}>
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
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection kicker="Market" title="Moving now" activityKey={viral.map((t) => t.address).join("|") || null}>
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
      </CollapsibleSection>
    </WorkspaceShell>
  );
}

function TokenDetailView({ address: rawAddress }: { address: string }) {
  const navigate = useNavigate();
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
  const [contentBusy, setContentBusy] = useState<ContentKind | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

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
    setFactSet(null);

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
        setFactSet(buildTokenFactSet(row));
        setContent(null);
        setVariant(0);
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
    if (!intel || contentBusy) return;
    setContentBusy(kind);
    setContentError(null);

    try {
      let facts = factSet ?? buildTokenFactSet(intel);
      if (!facts.xPatterns.length && facts.xNote == null) {
        try {
          const xIntel = await researchXContentIntel(intel);
          const patternList = xIntel.patterns.map((p) => p.pattern);
          facts = attachXPatterns(facts, patternList, xIntel.note);
        } catch {
          facts = attachXPatterns(facts, [], "X content sample unavailable.");
        }
      }

      setFactSet(facts);
      const next = await writeTokenContent({
        data: { facts, kind, mode: regenMode, variant },
      });
      setContent(next);
      setVariant((v) => v + 1);
    } catch (err: unknown) {
      setContentError(
        err instanceof Error
          ? err.message
          : "Content generation failed. Try again shortly.",
      );
    } finally {
      setContentBusy(null);
    }
  }

  async function regenerate() {
    if (!content || !factSet || contentBusy) return;
    setContentBusy(content.kind);
    setContentError(null);

    try {
      const jump = variant + 5 + Math.floor(Math.random() * 47);
      const next = await writeTokenContent({
        data: {
          facts: factSet,
          kind: content.kind,
          mode: regenMode,
          variant: jump,
        },
      });
      setContent(next);
      setVariant(jump + 1);
    } catch (err: unknown) {
      setContentError(
        err instanceof Error
          ? err.message
          : "Content generation failed. Try again shortly.",
      );
    } finally {
      setContentBusy(null);
    }
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
          {(() => {
            const diagnosis = intel.diagnosis ?? analyzeTokenIntel(intel);
            return (
              <>
                <section className="panel p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    {intel.identity.logoUrl ? (
                      <img
                        src={intel.identity.logoUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-full border border-line object-cover"
                      />
                    ) : (
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-line bg-surface-2 font-mono text-sm">
                        {intel.identity.symbol.slice(0, 3)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold tracking-tight">{intel.identity.name}</h2>
                        <span className="font-mono text-sm text-muted">{intel.identity.symbol}</span>
                        <span
                          className={
                            "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] uppercase " +
                            (intel.market.dexPaid === true
                              ? "border-signal/40 bg-signal/10 text-signal"
                              : intel.market.dexPaid === false
                                ? "border-danger/40 bg-danger/10 text-danger"
                                : "border-line bg-surface-2 text-muted")
                          }
                        >
                          {intel.market.dexPaid === true
                            ? "DEX PAID"
                            : intel.market.dexPaid === false
                              ? "DEX NOT PAID"
                              : "DEX UNKNOWN"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="text-accent">{chainLabel(intel.identity.chain)}</span>
                        <span className="font-mono text-subtle">{intel.identity.address}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="quiet" onClick={copyCa}>
                        {copied ? "Copied" : "Copy CA"}
                      </Button>
                      <a
                        className="inline-flex h-9 items-center rounded-md border border-line px-3 text-xs text-muted hover:text-fg"
                        href={explorerUrl(intel.identity.address, intel.identity.chain)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Explorer
                      </a>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <MetricCell label="Price" value={formatPrice(intel.market.priceUsd)} primary />
                    <MetricCell label="Market cap" value={formatMcap(intel.market.marketCap).short} primary />
                    <MetricCell label="24h volume" value={formatUsd(intel.market.volume24h)} primary />
                    <MetricCell label="Liquidity" value={formatMcap(intel.market.liquidityUsd).short} />
                    <MetricCell
                      label="ATH"
                      value={formatPrice(intel.market.athPriceUsd)}
                      detail={
                        intel.market.athDate
                          ? "Recorded " + new Date(intel.market.athDate).toLocaleDateString()
                          : "Unavailable from current public market data"
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-xs text-muted">
                    <span>1H <strong className="text-fg">{formatPct(intel.market.priceChange1h)}</strong></span>
                    <span>6H <strong className="text-fg">{formatPct(intel.market.priceChange6h)}</strong></span>
                    <span>24H <strong className="text-fg">{formatPct(intel.market.priceChange24h)}</strong></span>
                    <span>FDV <strong className="text-fg">{formatMcap(intel.market.fdv).short}</strong></span>
                    <span>Buys/Sells <strong className="text-fg">{intel.market.buys24h ?? "—"} / {intel.market.sells24h ?? "—"}</strong></span>
                    <span className="ml-auto">Updated {new Date(intel.freshness).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </section>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]">
                  <TemporalViralityPanel intel={intel} />
                  <MarketStatePanel diagnosis={diagnosis} />
                </div>

                <AiMarketIntelligence intel={intel} diagnosis={diagnosis} />

                <section className="panel overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div>
                      <p className="kicker">Price chart</p>
                      <h2 className="mt-1 text-lg">Market path</h2>
                    </div>
                    <span className="text-xs text-subtle">{intel.market.dexId?.toUpperCase() ?? "Market"}</span>
                  </div>
                  <div className="border-t border-line">
                    <PriceChartPanel
                      embedded
                      pairAddress={intel.market.pairAddress}
                      fallback={intel.chart.map((p) => ({ t: p.t, close: p.price }))}
                    />
                  </div>
                </section>
              </>
            );
          })()}

          {/* Viral Intelligence is the X-only mention list. */}
          <CollapsibleSection
            kicker="Viral Intelligence"
            title="Who is talking about this token on X"
            activityKey={intel.freshness}
            
            badge={
              <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                {intel.mentions.availability === "unavailable"
                  ? "Unavailable"
                  : intel.mentions.availability === "empty"
                    ? "None"
                    : `${intel.mentions.totalFound ?? intel.mentions.items.length}`}
              </span>
            }
          >
            {intel.mentions.availability === "available" ? (
              <p className="text-sm text-muted">{intel.mentions.note}</p>
            ) : null}
            {intel.mentions.availability === "unavailable" ? (
              <p className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-muted">
                Public X signals are temporarily unavailable.
              </p>
            ) : intel.mentions.items.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-muted">
                No verified public X mentions found for this token right now.
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
                      <span className="rounded-full bg-line px-2 py-0.5 font-mono text-[10px] tracking-wide text-subtle uppercase">
                        {kindLabel(m.kind)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-fg/90">{m.text}</p>
                    {m.likes != null || m.at ? (
                      <p className="mt-2 font-mono text-[11px] text-subtle">
                        {m.likes != null ? `${m.likes.toLocaleString()} likes` : null}
                        {m.likes != null && m.at ? " · " : null}
                        {m.at
                          ? new Date(m.at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : null}
                      </p>
                    ) : null}
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
          </CollapsibleSection>

                    <CollapsibleSection kicker="Create content from this token" title="Write from locked facts">
            <p className="text-sm text-muted">
              Facts are locked from the token research above. The writer synthesizes the strongest
              story and relationships in the evidence instead of copying the metric list.
            </p>

            {contentBusy ? (
              <div
                className="mt-4 flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm text-fg">
                    Building{" "}
                    {contentBusy === "post"
                      ? "post"
                      : contentBusy === "thread"
                        ? "thread"
                        : "article"}
                    …
                  </p>
                  <p className="text-xs text-subtle">
                    Analyzing signals, composing the editorial angle, refining the copy and scoring the result.
                  </p>
                </div>
              </div>
            ) : null}

            {contentError ? (
              <p
                className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
                role="alert"
              >
                {contentError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
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
                  disabled={contentBusy !== null}
                  onClick={() => setRegenMode(id)}
                  className={
                    "h-8 rounded-md px-2.5 text-xs transition " +
                    (regenMode === id
                      ? "border border-accent/40 bg-accent/15 text-accent"
                      : "border border-line text-muted hover:text-fg") +
                    (contentBusy !== null ? " cursor-not-allowed opacity-50" : "")
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {(["post", "thread", "article"] as ContentKind[]).map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant="quiet"
                  disabled={contentBusy !== null}
                  onClick={() => void createContent(k)}
                >
                  {contentBusy === k
                    ? "Generating " + k + "…"
                    : k === "post"
                      ? "Generate post"
                      : k === "thread"
                        ? "Generate thread"
                        : "Generate article"}
                </Button>
              ))}
              {content ? (
                <Button
                  type="button"
                  disabled={contentBusy !== null}
                  onClick={() => void regenerate()}
                >
                  {contentBusy ? "Regenerating…" : "Regenerate (unlimited)"}
                </Button>
              ) : null}
            </div>
          </CollapsibleSection>

          {content ? (
            <CollapsibleSection
              kicker={`${content.kind} · ${content.angle.label} · ${regenMode}`}
              title="Generated content"
              
            >
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">
                {content.text}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => void navigator.clipboard.writeText(content.text)}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    if (!intel) return;
                    const diagnosis = intel.diagnosis ?? null;
                    const payload: EditorHandoff = {
                      text: content.text,
                      kind: content.kind,
                      token: {
                        symbol: intel.identity.symbol,
                        name: intel.identity.name,
                        address: intel.identity.address,
                        state: diagnosis?.state ?? null,
                        headline: diagnosis?.headline ?? null,
                        rugLine: diagnosis?.rugLine ?? null,
                      },
                      at: new Date().toISOString(),
                    };
                    sessionStorage.setItem(EDITOR_HANDOFF_KEY, JSON.stringify(payload));
                    void navigate({ to: "/analyze" });
                  }}
                >
                  Open in Analyze
                </Button>
                <Button type="button" variant="quiet" onClick={() => void regenerate()}>
                  Regenerate
                </Button>
              </div>
              <ul className="space-y-1 text-xs text-subtle">
                {content.applied.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
              <ScoreCard report={content.score} />
            </CollapsibleSection>
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

function MetricCell({
  label,
  value,
  detail,
  primary = false,
}: {
  label: string;
  value: string;
  detail?: string;
  primary?: boolean;
}) {
  return (
    <div className={"rounded-lg border px-3 py-3 " + (primary ? "border-accent/30 bg-accent/5" : "border-line bg-surface-2/50")}>
      <p className="text-[10px] font-medium tracking-[0.12em] text-subtle uppercase">{label}</p>
      <p className={"mt-1 truncate font-mono tabular-nums " + (primary ? "text-lg font-semibold text-fg" : "text-sm text-fg")}>{value}</p>
      {detail ? <p className="mt-1 text-[10px] leading-tight text-subtle">{detail}</p> : null}
    </div>
  );
}

type TemporalWindow = {
  hours: 1 | 6 | 12 | 24;
  priceChange: number | null;
  previousPriceChange: number | null;
  volume: number | null;
  previousVolume: number | null;
  volumeAcceleration: number | null;
};

function buildTemporalWindow(candles: OhlcvCandle[], hours: TemporalWindow["hours"]): TemporalWindow {
  const current = candles.slice(-hours);
  const previous = candles.slice(-(hours * 2), -hours);
  const priceChange = current.length >= 1 && current[0]?.open > 0 && current.at(-1)?.close != null
    ? ((current.at(-1)!.close - current[0]!.open) / current[0]!.open) * 100
    : null;
  const previousPriceChange = previous.length >= 1 && previous[0]?.open > 0 && previous.at(-1)?.close != null
    ? ((previous.at(-1)!.close - previous[0]!.open) / previous[0]!.open) * 100
    : null;
  const volume = current.length ? current.reduce((sum, row) => sum + (row.volume ?? 0), 0) : null;
  const previousVolume = previous.length ? previous.reduce((sum, row) => sum + (row.volume ?? 0), 0) : null;
  const volumeAcceleration =
    volume != null && previousVolume != null && previousVolume > 0
      ? ((volume - previousVolume) / previousVolume) * 100
      : null;
  return { hours, priceChange, previousPriceChange, volume, previousVolume, volumeAcceleration };
}

function temporalLabel(change: number | null): string {
  if (change == null) return "UNAVAILABLE";
  if (change >= 1) return "UP";
  if (change <= -1) return "DOWN";
  return "FLAT";
}

function temporalStrength(row: TemporalWindow): string {
  const move = Math.abs(row.priceChange ?? 0);
  const accel = Math.abs(row.volumeAcceleration ?? 0);
  if (move >= 10 && accel >= 50) return "STRONG";
  if (move >= 5 || accel >= 30) return "MODERATE";
  if (row.priceChange != null || row.volumeAcceleration != null) return "WEAK";
  return "UNAVAILABLE";
}

function TemporalViralityPanel({ intel }: { intel: TokenIntel }) {
  const [selected, setSelected] = useState<TemporalWindow["hours"]>(1);
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (intel.identity.chain !== "solana" || !intel.market.pairAddress) {
      setCandles([]);
      return;
    }
    setBusy(true);
    setError(null);
    void fetchTokenOhlcv(intel.market.pairAddress, "1h")
      .then((rows) => {
        if (cancelled) return;
        setCandles(rows);
        if (rows.length < 24) setError("Historical hourly coverage is limited; unavailable fields are not estimated.");
      })
      .catch(() => {
        if (!cancelled) setError("Temporal market history is temporarily unavailable.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intel.identity.chain, intel.market.pairAddress]);

  const fallback = (hours: TemporalWindow["hours"]): TemporalWindow => {
    const priceChange =
      hours === 1 ? intel.market.priceChange1h :
      hours === 6 ? intel.market.priceChange6h :
      hours === 24 ? intel.market.priceChange24h :
      null;
    const volume =
      hours === 1 ? intel.market.volume1h :
      hours === 6 ? intel.market.volume6h :
      hours === 24 ? intel.market.volume24h :
      null;
    return {
      hours,
      priceChange,
      previousPriceChange: null,
      volume,
      previousVolume: null,
      volumeAcceleration: null,
    };
  };

  const row = candles.length >= 2 ? buildTemporalWindow(candles, selected) : fallback(selected);
  const mentionCount = intel.mentions.items.filter((m) => {
    if (!m.at) return false;
    const age = Date.now() - new Date(m.at).getTime();
    return age >= 0 && age <= selected * 60 * 60 * 1000;
  }).length;
  const direction = temporalLabel(row.priceChange);
  const strength = temporalStrength(row);

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Virality signals</p>
          <h2 className="mt-1 text-lg">Momentum by timeframe</h2>
        </div>
        {busy ? <span className="text-xs text-accent" role="status">Analyzing…</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-4 rounded-lg border border-line bg-surface-2/40 p-1">
        {([1, 6, 12, 24] as const).map((hours) => (
          <button
            key={hours}
            type="button"
            onClick={() => setSelected(hours)}
            className={"rounded-md px-2 py-2 text-xs font-medium transition " + (selected === hours ? "bg-accent/15 text-accent" : "text-muted hover:text-fg")}
          >
            {hours}H
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCell label="Direction" value={direction} />
        <MetricCell label="Price move" value={formatPct(row.priceChange)} />
        <MetricCell label="Volume" value={formatUsd(row.volume)} />
        <MetricCell label="Signal" value={strength} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-line bg-surface-2/30 px-3 py-2">
          <p className="text-[10px] tracking-[0.12em] text-subtle uppercase">Volume acceleration</p>
          <p className="mt-1 text-sm text-fg">{formatPct(row.volumeAcceleration)}</p>
          <p className="mt-1 text-[11px] text-subtle">vs the preceding {selected}H window</p>
        </div>
        <div className="rounded-md border border-line bg-surface-2/30 px-3 py-2">
          <p className="text-[10px] tracking-[0.12em] text-subtle uppercase">Public X sample</p>
          <p className="mt-1 text-sm text-fg">{mentionCount} mention{mentionCount === 1 ? "" : "s"} in {selected}H</p>
          <p className="mt-1 text-[11px] text-subtle">Sample coverage, not total platform activity</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-subtle">
        <span>Liquidity movement: unavailable</span>
        <span>Market-cap movement: unavailable</span>
        {error ? <span className="text-muted">{error}</span> : null}
      </div>
    </section>
  );
}

function MarketStatePanel({ diagnosis }: { diagnosis: ReturnType<typeof analyzeTokenIntel> }) {
  const riskClass =
    diagnosis.rugPullRisk === "critical" || diagnosis.rugPullRisk === "high"
      ? "border-danger/40 bg-danger/10 text-danger"
      : diagnosis.rugPullRisk === "elevated"
        ? "border-line bg-surface-2 text-muted"
        : "border-signal/40 bg-signal/10 text-signal";
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="kicker">Market state</p>
          <h2 className="mt-1 text-lg">{stanceLabel(diagnosis.state)}</h2>
        </div>
        <span className="font-mono text-xs text-subtle">XPulse {diagnosis.riskScore}/100</span>
      </div>

      <div className={"mt-4 rounded-lg border p-4 " + riskClass}>
        <p className="text-[10px] font-semibold tracking-[0.14em] uppercase">Rug Pull Risk</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{rugLabel(diagnosis.rugPullRisk)}</p>
        <p className="mt-2 text-xs leading-relaxed text-fg/80">
          {diagnosis.rugLine ?? "No rug-pull inference is supported by the current snapshot."}
        </p>
      </div>

      <p className="mt-4 text-sm text-fg">{diagnosis.headline}</p>
      <ul className="mt-3 space-y-2">
        {diagnosis.signals.slice(0, 3).map((signal) => (
          <li key={signal.type + "-" + signal.explanation} className="text-xs leading-relaxed text-muted">
            <span className="text-fg">{signal.type.replaceAll("_", " ")}:</span> {signal.explanation}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-subtle">Derived from the available market snapshot; not proof of wrongdoing.</p>
    </section>
  );
}

function AiMarketIntelligence({
  intel,
  diagnosis,
}: {
  intel: TokenIntel;
  diagnosis: ReturnType<typeof analyzeTokenIntel>;
}) {
  const insights = [
    ...diagnosis.conclusions.filter((x) => x !== diagnosis.headline),
    ...intel.analysis.risks.slice(0, 2),
  ].filter(Boolean).slice(0, 4);
  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="kicker">Intelligence</p>
          <h2 className="mt-1 text-lg">AI Market Intelligence Summary</h2>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent/5 px-2 py-1 text-[10px] tracking-wide text-accent uppercase">
          Interpretive
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-fg">{diagnosis.headline}</p>
      {insights.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {insights.map((insight) => (
            <div key={insight} className="rounded-md border border-line bg-surface-2/30 px-3 py-2 text-xs leading-relaxed text-muted">
              {insight}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">No additional interpretation is supported by the current data.</p>
      )}
    </section>
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
  embedded = false,
}: {
  pairAddress: string | null;
  fallback: Array<{ t: number; close: number }>;
  embedded?: boolean;
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

  const series = candles.length >= 2 ? candles.map((c) => ({ t: c.t, close: c.close })) : fallback;

  return (
    <div className="animate-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {embedded ? (
          <span className="text-xs text-subtle">Timeframe</span>
        ) : (
          <p className="kicker">Price chart</p>
        )}
        <div className="flex flex-wrap gap-1">
          {TIMEFRAMES.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTf(x.id)}
              className={`h-8 rounded-md px-2.5 font-mono text-xs transition ${
                tf === x.id
                  ? "border border-accent/40 bg-accent/20 text-accent"
                  : "border border-line text-muted hover:text-fg"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {busy ? <p className="mt-3 text-sm text-muted">Loading {tf} candles…</p> : null}
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
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`h-40 w-full ${up ? "text-signal" : "text-danger"}`}
        aria-hidden
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-subtle">
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
    </div>
  );
}
