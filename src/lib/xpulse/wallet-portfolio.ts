/**
 * Real Solana wallet portfolio — public RPC + public market prices only.
 * No invented balances, PnL, or allocations.
 * All numeric paths use finite-number guards so NaN never reaches the UI.
 */

const TIMEOUT_MS = 10_000;
const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

/** Accept only finite numbers. Distinguishes missing from invalid. */
export function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "N/A" || trimmed === "—") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type PortfolioAsset = {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  logoUrl: string | null;
};

export type PortfolioSnapshot = {
  address: string;
  solBalance: number | null;
  solPriceUsd: number | null;
  solValueUsd: number | null;
  assets: PortfolioAsset[];
  /** Only summed from finite USD values; null if none available. */
  totalValueUsd: number | null;
  allocation: Array<{ symbol: string; valueUsd: number; pct: number }>;
  unpricedCount: number;
  updatedAt: string;
  note: string | null;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  for (const endpoint of RPCS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: T; error?: unknown };
      if (json.error) continue;
      if (json.result !== undefined) return json.result;
    } catch {
      /* try next */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type TokenAmount = {
  amount?: string;
  decimals?: number;
  uiAmount?: number | null;
  uiAmountString?: string;
};

type ParsedTokenAccount = {
  pubkey: string;
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: TokenAmount;
        };
      };
    };
  };
};

function parseTokenAmount(ta: TokenAmount): { amount: number; decimals: number } | null {
  const decimals = finiteNumber(ta.decimals);
  if (decimals == null || decimals < 0 || decimals > 18) {
    // Try uiAmount alone
    const ui = finiteNumber(ta.uiAmount) ?? finiteNumber(ta.uiAmountString);
    if (ui != null && ui > 0) return { amount: ui, decimals: 0 };
    return null;
  }

  const ui = finiteNumber(ta.uiAmount) ?? finiteNumber(ta.uiAmountString);
  if (ui != null) {
    if (ui <= 0) return null;
    return { amount: ui, decimals };
  }

  const raw = finiteNumber(ta.amount);
  if (raw == null) return null;
  const amount = raw / 10 ** decimals;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, decimals };
}

async function priceForMints(
  mints: string[],
): Promise<Map<string, { price: number | null; symbol: string; name: string; logo: string | null }>> {
  const out = new Map<
    string,
    { price: number | null; symbol: string; name: string; logo: string | null }
  >();
  if (!mints.length) return out;
  const chunk = mints.slice(0, 30);

  const data = await fetchJson<{
    pairs?: Array<{
      baseToken?: { address?: string; symbol?: string; name?: string };
      priceUsd?: string | number;
      info?: { imageUrl?: string };
      liquidity?: { usd?: number };
    }>;
  }>(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);

  const pairs = data?.pairs ?? [];
  for (const mint of chunk) {
    const candidates = pairs.filter(
      (p) => p.baseToken?.address?.toLowerCase() === mint.toLowerCase(),
    );
    candidates.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = candidates[0];
    const price = finiteNumber(best?.priceUsd);
    out.set(mint, {
      price,
      symbol: best?.baseToken?.symbol ?? mint.slice(0, 4),
      name: best?.baseToken?.name ?? "Token",
      logo: best?.info?.imageUrl ?? null,
    });
  }

  const missing = chunk.filter((m) => out.get(m)?.price == null);
  if (missing.length) {
    const jup = await fetchJson<{
      data?: Record<string, { price?: number | string }>;
    }>(`https://api.jup.ag/price/v2?ids=${missing.join(",")}`);
    if (jup?.data) {
      for (const mint of missing) {
        const px = finiteNumber(jup.data[mint]?.price);
        const prev = out.get(mint) ?? {
          price: null,
          symbol: mint.slice(0, 4),
          name: "Token",
          logo: null,
        };
        if (px != null) out.set(mint, { ...prev, price: px });
      }
    }
  }
  return out;
}

/**
 * Load current balances for a Solana wallet address.
 */
export async function fetchWalletPortfolio(address: string): Promise<PortfolioSnapshot> {
  const updatedAt = new Date().toISOString();
  const empty: PortfolioSnapshot = {
    address,
    solBalance: null,
    solPriceUsd: null,
    solValueUsd: null,
    assets: [],
    totalValueUsd: null,
    allocation: [],
    unpricedCount: 0,
    updatedAt,
    note: null,
  };

  if (!address || address.length < 32) {
    return { ...empty, note: "Invalid wallet address." };
  }

  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  const [lamportsRaw, tokenAccountsLegacy, tokenAccounts2022] = await Promise.all([
    rpc<number | { value?: number }>("getBalance", [address]),
    rpc<{ value: ParsedTokenAccount[] }>("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_PROGRAM },
      { encoding: "jsonParsed" },
    ]),
    rpc<{ value: ParsedTokenAccount[] }>("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_2022_PROGRAM },
      { encoding: "jsonParsed" },
    ]),
  ]);

  const tokenAccounts = {
    value: [
      ...(tokenAccountsLegacy?.value ?? []),
      ...(tokenAccounts2022?.value ?? []),
    ],
  };

  // Some RPC wrappers return { value: number }; standard is number (lamports)
  const lamports =
    finiteNumber(lamportsRaw) ??
    finiteNumber(
      lamportsRaw && typeof lamportsRaw === "object"
        ? (lamportsRaw as { value?: number }).value
        : null,
    );

  // lamports → SOL (1 SOL = 1e9 lamports)
  const solBalance = lamports != null ? lamports / 1_000_000_000 : null;
  const solBalanceSafe =
    solBalance != null && Number.isFinite(solBalance) ? solBalance : null;

  // Aggregate multiple token accounts of the same mint
  const byMint = new Map<string, { amount: number; decimals: number }>();
  for (const row of tokenAccounts.value) {
    const info = row.account?.data?.parsed?.info;
    const mint = info?.mint;
    const ta = info?.tokenAmount;
    if (!mint || !ta) continue;
    const parsed = parseTokenAmount(ta);
    if (!parsed) continue;
    const prev = byMint.get(mint);
    if (prev) {
      byMint.set(mint, {
        amount: prev.amount + parsed.amount,
        decimals: Math.max(prev.decimals, parsed.decimals),
      });
    } else {
      byMint.set(mint, { amount: parsed.amount, decimals: parsed.decimals });
    }
  }

  const holdings = [...byMint.entries()].map(([mint, v]) => ({
    mint,
    amount: v.amount,
    decimals: v.decimals,
  }));
  holdings.sort((a, b) => b.amount - a.amount);

  // Price in batches of 30 (API limit) — cover as many as practical
  const allMints = holdings.map((h) => h.mint);
  const priceMap = new Map<string, { price: number | null; symbol: string; name: string; logo: string | null }>();
  for (let i = 0; i < allMints.length && i < 90; i += 30) {
    const batch = await priceForMints(allMints.slice(i, i + 30));
    for (const [k, v] of batch) priceMap.set(k, v);
  }

  const solMeta = await priceForMints(["So11111111111111111111111111111111111111112"]);
  const solPriceUsd =
    finiteNumber(solMeta.get("So11111111111111111111111111111111111111112")?.price) ?? null;

  const solValueUsd =
    solBalanceSafe != null && solPriceUsd != null
      ? solBalanceSafe * solPriceUsd
      : null;
  const solValueSafe =
    solValueUsd != null && Number.isFinite(solValueUsd) ? solValueUsd : null;

  const assets: PortfolioAsset[] = [];
  let unpricedCount = 0;
  for (const h of holdings) {
    const meta = priceMap.get(h.mint);
    const priceUsd = finiteNumber(meta?.price);
    let valueUsd: number | null = null;
    if (priceUsd != null && Number.isFinite(h.amount)) {
      const v = h.amount * priceUsd;
      valueUsd = Number.isFinite(v) ? v : null;
    }
    if (valueUsd == null) unpricedCount += 1;
    assets.push({
      mint: h.mint,
      symbol: meta?.symbol ?? h.mint.slice(0, 4),
      name: meta?.name ?? "Token",
      amount: h.amount,
      decimals: h.decimals,
      priceUsd,
      valueUsd,
      logoUrl: meta?.logo ?? null,
    });
  }

  assets.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  // Total: only finite USD values — never NaN + number
  let total = 0;
  let hasAnyValue = false;
  if (solValueSafe != null) {
    total += solValueSafe;
    hasAnyValue = true;
  }
  for (const a of assets) {
    if (a.valueUsd != null && Number.isFinite(a.valueUsd)) {
      total += a.valueUsd;
      hasAnyValue = true;
    }
  }
  const totalValueUsd = hasAnyValue && Number.isFinite(total) ? total : null;

  const allocation: PortfolioSnapshot["allocation"] = [];
  if (totalValueUsd != null && totalValueUsd > 0) {
    if (solValueSafe != null && solValueSafe > 0) {
      allocation.push({
        symbol: "SOL",
        valueUsd: solValueSafe,
        pct: (solValueSafe / totalValueUsd) * 100,
      });
    }
    let others = 0;
    for (const a of assets) {
      if (a.valueUsd == null || !Number.isFinite(a.valueUsd) || a.valueUsd <= 0) continue;
      if (allocation.length < 6) {
        allocation.push({
          symbol: a.symbol,
          valueUsd: a.valueUsd,
          pct: (a.valueUsd / totalValueUsd) * 100,
        });
      } else {
        others += a.valueUsd;
      }
    }
    if (others > 0 && Number.isFinite(others)) {
      allocation.push({
        symbol: "Others",
        valueUsd: others,
        pct: (others / totalValueUsd) * 100,
      });
    }
  }

  let note: string | null = null;
  if (lamports == null && tokenAccounts.value.length === 0) {
    note = "Wallet balances temporarily unavailable.";
  } else {
    const parts = [
      "Historical PnL requires full transfer history and is not available from free public endpoints — only current balances are shown.",
    ];
    if (unpricedCount > 0) {
      parts.push(`${unpricedCount} asset(s) have no market price and are excluded from total value.`);
    }
    note = parts.join(" ");
  }

  return {
    address,
    solBalance: solBalanceSafe,
    solPriceUsd,
    solValueUsd: solValueSafe,
    assets,
    totalValueUsd,
    allocation,
    unpricedCount,
    updatedAt,
    note,
  };
}
