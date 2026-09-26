/**
 * Real Solana wallet portfolio — public RPC + public market prices only.
 * No invented balances, PnL, or allocations.
 */

const TIMEOUT_MS = 10_000;
const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

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
  totalValueUsd: number | null;
  allocation: Array<{ symbol: string; valueUsd: number; pct: number }>;
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
  amount: string;
  decimals: number;
  uiAmount: number | null;
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

async function priceForMints(
  mints: string[],
): Promise<Map<string, { price: number | null; symbol: string; name: string; logo: string | null }>> {
  const out = new Map<
    string,
    { price: number | null; symbol: string; name: string; logo: string | null }
  >();
  if (!mints.length) return out;
  const chunk = mints.slice(0, 30);

  // Primary: market pairs
  const data = await fetchJson<{ pairs?: Array<{
    baseToken?: { address?: string; symbol?: string; name?: string };
    priceUsd?: string;
    info?: { imageUrl?: string };
    liquidity?: { usd?: number };
  }> }>(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);

  const pairs = data?.pairs ?? [];
  for (const mint of chunk) {
    const candidates = pairs.filter(
      (p) => p.baseToken?.address?.toLowerCase() === mint.toLowerCase(),
    );
    candidates.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = candidates[0];
    out.set(mint, {
      price: best?.priceUsd != null ? Number(best.priceUsd) : null,
      symbol: best?.baseToken?.symbol ?? mint.slice(0, 4),
      name: best?.baseToken?.name ?? "Token",
      logo: best?.info?.imageUrl ?? null,
    });
  }

  // Fallback: Jupiter public price for mints still missing price
  const missing = chunk.filter((m) => out.get(m)?.price == null);
  if (missing.length) {
    const jup = await fetchJson<{
      data?: Record<string, { price?: number }>;
    }>(`https://api.jup.ag/price/v2?ids=${missing.join(",")}`);
    if (jup?.data) {
      for (const mint of missing) {
        const px = jup.data[mint]?.price;
        const prev = out.get(mint) ?? {
          price: null,
          symbol: mint.slice(0, 4),
          name: "Token",
          logo: null,
        };
        if (typeof px === "number" && Number.isFinite(px)) {
          out.set(mint, { ...prev, price: px });
        }
      }
    }
  }
  return out;
}

/**
 * Load current balances for a Solana wallet address.
 * PnL / historical value require transaction history APIs not available free → not invented.
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
    updatedAt,
    note: null,
  };

  if (!address || address.length < 32) {
    return { ...empty, note: "Invalid wallet address." };
  }

  const [lamports, tokenAccounts] = await Promise.all([
    rpc<number>("getBalance", [address]),
    rpc<{ value: ParsedTokenAccount[] }>("getTokenAccountsByOwner", [
      address,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed" },
    ]),
  ]);

  const solBalance = lamports != null ? lamports / 1e9 : null;

  const holdings: Array<{ mint: string; amount: number; decimals: number }> = [];
  for (const row of tokenAccounts?.value ?? []) {
    const info = row.account.data.parsed?.info;
    const mint = info?.mint;
    const ta = info?.tokenAmount;
    if (!mint || !ta) continue;
    const amount = ta.uiAmount ?? Number(ta.amount) / 10 ** ta.decimals;
    if (!amount || amount <= 0) continue;
    holdings.push({ mint, amount, decimals: ta.decimals });
  }

  // Cap priced tokens for performance
  holdings.sort((a, b) => b.amount - a.amount);
  const priceMap = await priceForMints(holdings.slice(0, 25).map((h) => h.mint));

  // SOL price via WSOL
  const solMeta = await priceForMints(["So11111111111111111111111111111111111111112"]);
  const solPriceUsd = solMeta.get("So11111111111111111111111111111111111111112")?.price ?? null;
  const solValueUsd =
    solBalance != null && solPriceUsd != null ? solBalance * solPriceUsd : null;

  const assets: PortfolioAsset[] = [];
  for (const h of holdings) {
    const meta = priceMap.get(h.mint);
    const priceUsd = meta?.price ?? null;
    const valueUsd = priceUsd != null ? h.amount * priceUsd : null;
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

  assets.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  let total = solValueUsd ?? 0;
  for (const a of assets) {
    if (a.valueUsd != null) total += a.valueUsd;
  }
  const totalValueUsd =
    solValueUsd != null || assets.some((a) => a.valueUsd != null) ? total : null;

  const allocation: PortfolioSnapshot["allocation"] = [];
  if (totalValueUsd && totalValueUsd > 0) {
    if (solValueUsd != null && solValueUsd > 0) {
      allocation.push({
        symbol: "SOL",
        valueUsd: solValueUsd,
        pct: (solValueUsd / totalValueUsd) * 100,
      });
    }
    let others = 0;
    for (const a of assets) {
      if (a.valueUsd == null || a.valueUsd <= 0) continue;
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
    if (others > 0) {
      allocation.push({
        symbol: "Others",
        valueUsd: others,
        pct: (others / totalValueUsd) * 100,
      });
    }
  }

  let note: string | null = null;
  if (lamports == null && !tokenAccounts) {
    note = "Wallet balances temporarily unavailable.";
  } else {
    note =
      "Historical PnL requires full transfer history and is not available from free public endpoints — only current balances are shown.";
  }

  return {
    address,
    solBalance,
    solPriceUsd,
    solValueUsd,
    assets,
    totalValueUsd,
    allocation,
    updatedAt,
    note,
  };
}
