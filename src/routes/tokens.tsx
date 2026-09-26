import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import {
  detectTokenInput,
  fetchViralSolanaTokens,
  researchToken,
  type TokenSearchHit,
  type ViralToken,
} from "@/lib/xpulse/token-intel";

export const Route = createFileRoute("/tokens")({
  head: () => ({ meta: [{ title: "Token intelligence · XPulse" }] }),
  component: TokensPage,
});

function formatUsd(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | null) {
  if (n == null) return "—";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

function TokensPage() {
  const navigate = useNavigate();
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

  function openToken(address: string) {
    // Dedicated token page (registered in routeTree)
    void navigate({
      to: "/tokens/$address",
      params: { address },
    });
  }

  async function runSearch(value?: string) {
    const q = (value ?? query).trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setHits(null);
    try {
      if (detectTokenInput(q) === "address") {
        openToken(q);
        return;
      }
      const result = await researchToken(q);
      if (result.kind === "empty") {
        setError("No matching Solana token found. Check the name or contract address.");
      } else if (result.kind === "choices") {
        setHits(result.hits);
      } else {
        openToken(result.intel.identity.address);
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
          <p className="mt-1 text-sm text-muted">Select a token to open its full page.</p>
          <ul className="mt-4 space-y-2">
            {hits.map((h) => (
              <li key={h.address}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-3 text-left transition hover:border-accent/40"
                  onClick={() => openToken(h.address)}
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
                  onClick={() => openToken(t.address)}
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
