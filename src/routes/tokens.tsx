import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { ScoreCard } from "@/components/intel/ScoreCard";
import { Button } from "@/components/ui/button";
import { researchTokenIntel } from "@/lib/xpulse/api";
import { generateFromToken } from "@/lib/xpulse/content-create";
import type { ContentKind } from "@/lib/xpulse/content-score";
import {
  detectTokenInput,
  explorerUrl,
  fetchViralSolanaTokens,
  researchToken,
  researchTokenByAddress,
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
        setError("No matching Solana token found. Check the name or contract address.");
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
    <WorkspaceShell active="/tokens" kicker="Solana" title="Token intelligence">
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
          setError("Token not found or no Solana market pairs available for this address.");
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

          <section className="panel p-4 sm:p-5">
            <p className="kicker">Create content from this research</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["post", "thread", "article"] as ContentKind[]).map((k) => (
                <Button key={k} type="button" variant="quiet" onClick={() => createContent(k)}>
                  {k === "post" ? "Post" : k === "thread" ? "Thread" : "Article"}
                </Button>
              ))}
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
