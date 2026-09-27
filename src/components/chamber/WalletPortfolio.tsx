import { useCallback, useEffect, useRef, useState } from "react";
import { getMe } from "@/lib/xpulse/api";
import {
  fetchWalletPortfolio,
  type PortfolioSnapshot,
} from "@/lib/xpulse/wallet-portfolio";

const POLL_MS = 15_000;

function formatUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "Value unavailable";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatSol(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "Balance unavailable";
  if (n === 0) return "0 SOL";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`;
}

function formatAmount(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

const COLORS = [
  "var(--color-accent)",
  "var(--color-signal)",
  "#7dd3fc",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#94a3b8",
];

export function WalletPortfolio() {
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (address: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const row = await fetchWalletPortfolio(address);
      // Only replace state with a coherent snapshot — never partial NaN fields
      setSnap(row);
      setError(null);
    } catch (e) {
      // Keep previous valid snap visible; surface error without wiping balances
      setError(e instanceof Error ? e.message : "Unable to retrieve wallet balance.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  // Resolve connected wallet + immediate fetch
  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((me) => {
        if (cancelled) return;
        const addr = me?.wallet?.address ?? null;
        setWallet(addr);
        if (!addr) {
          setBusy(false);
          setError(null);
          setSnap(null);
          return;
        }
        void load(addr);
      })
      .catch(() => {
        if (!cancelled) {
          setBusy(false);
          setError("Could not resolve connected wallet.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // 15s polling while mounted
  useEffect(() => {
    if (!wallet) return;
    timer.current = window.setInterval(() => {
      void load(wallet);
    }, POLL_MS);
    return () => {
      if (timer.current != null) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [wallet, load]);

  function copy() {
    if (!wallet) return;
    void navigator.clipboard.writeText(wallet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (!wallet && !busy) {
    return (
      <section className="panel animate-in p-4 sm:p-5">
        <p className="kicker">Portfolio</p>
        <p className="mt-2 text-sm text-muted">
          Connect your wallet to view your Personal Chamber portfolio.
        </p>
      </section>
    );
  }

  return (
    <section className="panel animate-in space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Wallet</p>
          <h2 className="mt-1 text-xl tracking-tight">Connected portfolio</h2>
          {wallet ? (
            <p className="mt-1 break-all font-mono text-xs text-subtle">{wallet}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className="h-9 rounded-md border border-line px-3 text-xs text-muted transition hover:text-fg"
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            onClick={() => wallet && void load(wallet)}
            className="h-9 rounded-md border border-line px-3 text-xs text-muted transition hover:text-fg"
          >
            Refresh
          </button>
        </div>
      </div>

      {busy && !snap ? (
        <p className="text-sm text-muted">Loading balances…</p>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {snap ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Portfolio value"
              value={formatUsd(snap.totalValueUsd)}
              accent
            />
            <Stat label="SOL balance" value={formatSol(snap.solBalance)} />
            <Stat
              label="SOL in USD"
              value={
                snap.solValueUsd != null && Number.isFinite(snap.solValueUsd)
                  ? formatUsd(snap.solValueUsd)
                  : snap.solBalance != null && Number.isFinite(snap.solBalance)
                    ? "USD value unavailable"
                    : "Value unavailable"
              }
            />
            <Stat
              label="Updated"
              value={new Date(snap.updatedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <p className="mb-2 text-xs tracking-wide text-subtle uppercase">
                Allocation
              </p>
              {snap.allocation.length ? (
                <AllocationDonut slices={snap.allocation} />
              ) : (
                <p className="text-sm text-muted">
                  Allocation unavailable — priced balances required.
                </p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs tracking-wide text-subtle uppercase">
                Holdings
              </p>
              {snap.assets.length === 0 && snap.solBalance == null ? (
                <p className="text-sm text-muted">No holdings returned.</p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {snap.solBalance != null && Number.isFinite(snap.solBalance) ? (
                    <li className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-sm">
                      <span>SOL</span>
                      <span className="font-mono text-xs text-muted">
                        {formatSol(snap.solBalance)}
                        {" · "}
                        {snap.solValueUsd != null && Number.isFinite(snap.solValueUsd)
                          ? formatUsd(snap.solValueUsd)
                          : "USD value unavailable"}
                      </span>
                    </li>
                  ) : null}
                  {snap.assets.map((a) => (
                    <li
                      key={a.mint}
                      className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-fg">{a.symbol}</span>{" "}
                        <span className="text-xs text-subtle">{a.name}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-subtle truncate">
                          {a.mint}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {formatAmount(a.amount)}
                        {" · "}
                        {a.valueUsd != null && Number.isFinite(a.valueUsd)
                          ? formatUsd(a.valueUsd)
                          : "Value unavailable"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-md border border-line bg-surface-2/30 px-3 py-3">
            <p className="text-xs tracking-wide text-subtle uppercase">PnL</p>
            <p className="mt-1 text-sm text-muted">
              Historical PnL is partially available. Cost basis and full
              realized/unrealized PnL need complete transfer history, which is
              not returned by free public endpoints. Current balances and values
              above are live when the network responds.
            </p>
          </div>

          {snap.note ? <p className="text-xs text-subtle">{snap.note}</p> : null}
        </>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-3 ${
        accent ? "border-accent/30 bg-accent/5" : "border-line bg-surface-2/40"
      }`}
    >
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums text-fg">{value}</p>
    </div>
  );
}

function AllocationDonut({
  slices,
}: {
  slices: Array<{ symbol: string; valueUsd: number; pct: number }>;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="14"
        />
        {slices.map((s, i) => {
          const len = (s.pct / 100) * c;
          const el = (
            <circle
              key={s.symbol}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <circle cx="60" cy="60" r="28" fill="var(--color-surface)" />
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.symbol} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              {s.symbol}
            </span>
            <span className="font-mono text-xs text-muted">
              {Number.isFinite(s.pct) ? `${s.pct.toFixed(1)}%` : "—"} · {formatUsd(s.valueUsd)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
