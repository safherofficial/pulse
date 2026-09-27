/**
 * Multi-chain token research — free public market data only.
 * Never invent missing fields; mark them unavailable.
 * UI must not expose provider names.
 * Lifetime payment remains Solana-only and is unrelated to analysis chain.
 */

import { interpretDexOrdersHttp, type DexPaidVerdict } from "./dex-paid";
import { analyzeTokenIntel, type MarketDiagnosis } from "./market-state";
import { fetchTokenMentions } from "./token-mentions";

const TIMEOUT_MS = 8_000;

export type TokenIdentity = {
  address: string;
  name: string;
  symbol: string;
  decimals: number | null;
  logoUrl: string | null;
  chain: string;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
};

export type TokenMarket = {
  priceUsd: number | null;
  priceChange24h: number | null;
  priceChange6h: number | null;
  priceChange1h: number | null;
  volume24h: number | null;
  volume6h: number | null;
  volume1h: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  pairAddress: string | null;
  pairUrl: string | null;
  dexId: string | null;
  buys24h: number | null;
  sells24h: number | null;
  /** Any paid DexScreener activity (profile, boost, ad). */
  paidListing: boolean | null;
  paidListingDetail: string | null;
  /** CheckDEX-style: Enhanced Token Info approved. */
  dexPaid: boolean | null;
  boostActive: number | null;
  viralScore: number | null;
  viralReasons: string[];
  updatedAt: string;
};

export type TokenChartPoint = {
  t: number;
  price: number;
};

export type TokenAnalysis = {
  snapshot: string;
  marketStructure: string;
  liquidity: string;
  activity: string;
  narrative: string;
  risks: string[];
};

export type TokenMention = {
  author: string;
  handle: string;
  verified: boolean;
  kind: "official" | "kol" | "politician" | "verified" | "other";
  text: string;
  url: string;
  likes: number | null;
  at: string | null;
};

export type TokenMentionsReport = {
  totalFound: number | null;
  items: TokenMention[];
  note: string;
  updatedAt: string;
  /** available = posts, empty = source responded with nothing, unavailable = source failed */
  availability: "available" | "empty" | "unavailable";
};

export type TokenIntel = {
  identity: TokenIdentity;
  market: TokenMarket;
  chart: TokenChartPoint[];
  analysis: TokenAnalysis;
  mentions: TokenMentionsReport;
  /** Deterministic XPulse reading of this snapshot. Not an official market rating. */
  diagnosis?: MarketDiagnosis;
  freshness: string;
};

export type TokenSearchHit = {
  address: string;
  name: string;
  symbol: string;
  logoUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  chain: string;
};

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

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Supported chain ids as returned by public market data. */
export const KNOWN_CHAINS = [
  "solana",
  "ethereum",
  "base",
  "bsc",
  "arbitrum",
  "polygon",
  "avalanche",
  "optimism",
  "sui",
  "ton",
  "tron",
] as const;

export function detectTokenInput(input: string): "address" | "name" {
  const clean = input.trim();
  if (EVM_ADDRESS_RE.test(clean) || SOLANA_ADDRESS_RE.test(clean)) return "address";
  return "name";
}

export function looksLikeEvm(address: string): boolean {
  return EVM_ADDRESS_RE.test(address.trim());
}

export function looksLikeSolana(address: string): boolean {
  return SOLANA_ADDRESS_RE.test(address.trim());
}

export function chainLabel(chainId: string | null | undefined): string {
  const c = (chainId ?? "").toLowerCase();
  const map: Record<string, string> = {
    solana: "Solana",
    ethereum: "Ethereum",
    base: "Base",
    bsc: "BNB Chain",
    arbitrum: "Arbitrum",
    polygon: "Polygon",
    avalanche: "Avalanche",
    optimism: "Optimism",
    sui: "Sui",
    ton: "TON",
    tron: "Tron",
  };
  return map[c] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1) : "Unknown");
}

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h1?: number; h6?: number; h24?: number; m5?: number };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  txns?: {
    h24?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
  };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
  pairCreatedAt?: number;
  boosts?: { active?: number };
};

function pickBestPair(pairs: DexPair[], preferChain?: string | null): DexPair | null {
  let pool = pairs;
  if (preferChain) {
    const pref = pairs.filter(
      (p) => (p.chainId ?? "").toLowerCase() === preferChain.toLowerCase(),
    );
    if (pref.length) pool = pref;
  }
  if (!pool.length) return null;
  return pool
    .slice()
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;
}

function identityFromPair(pair: DexPair, addressHint?: string): TokenIdentity {
  const base = pair.baseToken;
  const address = addressHint || base?.address || "";
  const socials = pair.info?.socials ?? [];
  const twitter =
    socials.find((s) => (s.type ?? "").toLowerCase() === "twitter")?.url ?? null;
  const telegram =
    socials.find((s) => (s.type ?? "").toLowerCase() === "telegram")?.url ?? null;
  const website = pair.info?.websites?.[0]?.url ?? null;
  return {
    address,
    name: base?.name ?? "Unknown",
    symbol: (base?.symbol ?? "—").toUpperCase(),
    decimals: null,
    logoUrl: pair.info?.imageUrl ?? null,
    chain: (pair.chainId ?? "unknown").toLowerCase(),
    website,
    twitter,
    telegram,
  };
}

function marketFromPair(pair: DexPair, paid: { paid: boolean | null; detail: string | null; report?: DexPaidReport } = { paid: null, detail: null }): TokenMarket {
  const price = pair.priceUsd != null ? Number(pair.priceUsd) : null;
  const vol = pair.volume?.h24 ?? 0;
  const liq = pair.liquidity?.usd ?? 0;
  const ch = pair.priceChange?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const reasons: string[] = [];
  const volScore = Math.min(50, Math.log10(Math.max(vol, 1)) * 8);
  const moveScore = Math.min(30, Math.abs(ch) * 0.4);
  const liqScore = Math.min(20, Math.log10(Math.max(liq, 1)) * 3);
  const viralScore = Math.round(volScore + moveScore + liqScore);
  if (vol > 500_000) reasons.push("high 24h volume");
  else if (vol > 50_000) reasons.push("active volume");
  if (Math.abs(ch) > 20) reasons.push("sharp 24h move");
  else if (Math.abs(ch) > 8) reasons.push("notable 24h move");
  if (liq > 200_000) reasons.push("deeper liquidity");
  if (buys + sells > 500) reasons.push("heavy 24h trade count");
  if (paid.report?.dexPaid === true) reasons.push("approved DEX profile");
  return {
    priceUsd: Number.isFinite(price) ? price : null,
    priceChange24h: pair.priceChange?.h24 ?? null,
    priceChange6h: pair.priceChange?.h6 ?? null,
    priceChange1h: pair.priceChange?.h1 ?? null,
    volume24h: pair.volume?.h24 ?? null,
    volume6h: pair.volume?.h6 ?? null,
    volume1h: pair.volume?.h1 ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    fdv: pair.fdv ?? null,
    marketCap: pair.marketCap ?? null,
    pairAddress: pair.pairAddress ?? null,
    pairUrl: pair.url ?? null,
    dexId: pair.dexId ?? null,
    buys24h: pair.txns?.h24?.buys ?? null,
    sells24h: pair.txns?.h24?.sells ?? null,
    paidListing: paid.paid,
    paidListingDetail: paid.detail,
    dexPaid: paid.report?.dexPaid ?? null,
    boostActive: paid.report?.boostActive ?? pair.boosts?.active ?? null,
    viralScore: Number.isFinite(viralScore) ? viralScore : null,
    viralReasons: reasons,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Public DexScreener orders feed.
 * DEX Paid = approved tokenProfile or communityTakeover.
 * Boosts stay on boostActive and never become DEX Paid.
 */
export type DexPaidReport = {
  dexPaid: boolean | null;
  boostActive: number | null;
  orders: Array<{ type: string; status: string }>;
  detail: string;
};

function verdictToReport(verdict: DexPaidVerdict): {
  paid: boolean | null;
  detail: string | null;
  report: DexPaidReport;
} {
  return {
    paid: verdict.paidListing,
    detail: verdict.detail,
    report: {
      dexPaid: verdict.dexPaid,
      boostActive: verdict.boostActive,
      orders: verdict.orders,
      detail: verdict.detail,
    },
  };
}

async function fetchPaidListing(
  address: string,
  activeBoosts?: number | null,
  chainId: string = "solana",
): Promise<{ paid: boolean | null; detail: string | null; report: DexPaidReport }> {
  const chain = chainId.trim().toLowerCase();
  const chainSupported = Boolean(chain && chain !== "unknown");
  const pairBoosts =
    typeof activeBoosts === "number" && Number.isFinite(activeBoosts) ? activeBoosts : null;
  if (!address.trim() || !chainSupported) {
    return verdictToReport(
      interpretDexOrdersHttp({ status: 0, body: null, pairBoosts, chainSupported }),
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.dexscreener.com/orders/v1/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    );
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return verdictToReport(
      interpretDexOrdersHttp({
        status: res.status,
        body: res.ok ? body : null,
        pairBoosts,
        chainSupported: true,
      }),
    );
  } catch {
    return verdictToReport(
      interpretDexOrdersHttp({ status: 0, body: null, pairBoosts, chainSupported: true }),
    );
  } finally {
    clearTimeout(timer);
  }
}

function analyzeToken(identity: TokenIdentity, market: TokenMarket): TokenAnalysis {
  const liq = market.liquidityUsd;
  const vol = market.volume24h;
  const ch24 = market.priceChange24h;

  const snapshotParts = [
    `${identity.name} (${identity.symbol}) on Solana`,
    market.priceUsd != null ? `trading near $${formatCompactPrice(market.priceUsd)}` : "price unavailable",
  ];
  if (ch24 != null) {
    snapshotParts.push(
      `${ch24 >= 0 ? "up" : "down"} ${Math.abs(ch24).toFixed(1)}% over 24h`,
    );
  }

  let marketStructure =
    "Market structure cannot be fully assessed from the available snapshot alone.";
  if (liq != null && vol != null) {
    const ratio = liq > 0 ? vol / liq : 0;
    if (ratio > 2) {
      marketStructure =
        "Volume is high relative to liquidity — price can move quickly in either direction.";
    } else if (ratio > 0.5) {
      marketStructure =
        "Trading activity is material relative to pool depth; moves are more likely to stick than in thin books.";
    } else if (liq > 500_000) {
      marketStructure =
        "Liquidity looks relatively deep for a Solana token; large orders still move price, but thin-book spikes are less likely.";
    } else {
      marketStructure =
        "Liquidity is limited. Slippage and sharp wicks are more likely under size.";
    }
  }

  const liquidity =
    liq == null
      ? "Liquidity data unavailable."
      : liq < 25_000
        ? "Liquidity is very low. Even modest sells can reprice the pool sharply."
        : liq < 100_000
          ? "Liquidity is modest. Suitable for small size only; larger exits face impact."
          : liq < 500_000
            ? "Liquidity is moderate. Reasonable for mid-size activity, still sensitive to large flows."
            : "Liquidity is comparatively deep for this market tier.";

  const activity =
    vol == null
      ? "Volume data unavailable."
      : vol < 10_000
        ? "24h volume is thin — fewer real counterparties."
        : vol < 100_000
          ? "24h volume is light to moderate."
          : vol < 1_000_000
            ? "24h volume is active."
            : "24h volume is high; the market is attracting attention.";

  const narrativeBits: string[] = [];
  if (/bonk|wif|meme|dog|cat|pepe/i.test(identity.name + identity.symbol)) {
    narrativeBits.push("Public narrative leans meme / culture rather than utility.");
  }
  if (/ai|agent|gpt|neural/i.test(identity.name + identity.symbol)) {
    narrativeBits.push("Naming suggests an AI-adjacent narrative in the market.");
  }
  if (/defi|swap|lend|stake|yield/i.test(identity.name + identity.symbol)) {
    narrativeBits.push("Naming suggests a DeFi / utility framing.");
  }
  if (!narrativeBits.length) {
    narrativeBits.push(
      "No strong public narrative can be inferred from the name alone — treat marketing claims as unverified until primary sources confirm them.",
    );
  }

  const risks: string[] = [];
  if (liq != null && liq < 25_000) {
    risks.push("Very low liquidity — this may warrant further investigation before any size.");
  }
  if (vol != null && liq != null && liq > 0 && vol / liq > 5) {
    risks.push("Volume far exceeds liquidity — possible short-term speculation or thin-book noise.");
  }
  if (ch24 != null && Math.abs(ch24) > 40) {
    risks.push("Extreme 24h volatility — price discovery is unstable in this window.");
  }
  if (!identity.website && !identity.twitter) {
    risks.push("No official website or social link surfaced in market metadata.");
  }
  if (!risks.length) {
    risks.push("No severe structural red flags in the available snapshot — still not investment advice.");
  }

  return {
    snapshot: snapshotParts.join(", ") + ".",
    marketStructure,
    liquidity,
    activity,
    narrative: narrativeBits.join(" "),
    risks,
  };
}

function formatCompactPrice(n: number): string {
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toExponential(2);
}

/** Synthetic chart from available change points when OHLC history is not free. */
function approximateChart(market: TokenMarket): TokenChartPoint[] {
  const now = Date.now();
  const price = market.priceUsd;
  if (price == null || price <= 0) return [];
  const c1 = market.priceChange1h ?? 0;
  const c6 = market.priceChange6h ?? c1 * 3;
  const c24 = market.priceChange24h ?? c6 * 2;
  const p1 = price / (1 + c1 / 100);
  const p6 = price / (1 + c6 / 100);
  const p24 = price / (1 + c24 / 100);
  return [
    { t: now - 24 * 3600_000, price: p24 },
    { t: now - 6 * 3600_000, price: p6 },
    { t: now - 1 * 3600_000, price: p1 },
    { t: now, price },
  ];
}

export async function searchTokensByName(query: string): Promise<TokenSearchHit[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
  );
  const pairs = data?.pairs ?? [];
  const seen = new Set<string>();
  const hits: TokenSearchHit[] = [];
  for (const pair of pairs) {
    const addr = pair.baseToken?.address;
    const chain = (pair.chainId ?? "unknown").toLowerCase();
    const key = `${chain}:${addr}`;
    if (!addr || seen.has(key)) continue;
    seen.add(key);
    hits.push({
      address: addr,
      name: pair.baseToken?.name ?? "Unknown",
      symbol: (pair.baseToken?.symbol ?? "—").toUpperCase(),
      logoUrl: pair.info?.imageUrl ?? null,
      priceUsd: pair.priceUsd != null ? Number(pair.priceUsd) : null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      chain,
    });
    if (hits.length >= 16) break;
  }
  return hits;
}

export async function researchTokenByAddress(
  address: string,
  preferChain?: string | null,
): Promise<TokenIntel | null> {
  let clean = address.trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep raw */
  }
  clean = clean.split(/[/?#]/)[0]!.trim();
  if (!EVM_ADDRESS_RE.test(clean) && !SOLANA_ADDRESS_RE.test(clean)) return null;

  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(clean)}`,
  );

  let pairs = data?.pairs ?? [];
  if (!pairs.length) {
    const fallback = await fetchJson<{ pairs?: DexPair[] }>(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(clean)}`,
    );
    pairs = (fallback?.pairs ?? []).filter(
      (p) =>
        p.baseToken?.address?.toLowerCase() === clean.toLowerCase() ||
        p.quoteToken?.address?.toLowerCase() === clean.toLowerCase(),
    );
  }

  // Auto-detect prefer chain from address shape when not provided
  let prefer = preferChain ?? null;
  if (!prefer) {
    if (EVM_ADDRESS_RE.test(clean)) prefer = null; // let liquidity pick among EVM chains
    else if (SOLANA_ADDRESS_RE.test(clean)) prefer = "solana";
  }

  const pair = pickBestPair(pairs, prefer);
  if (!pair) return null;

  const chainId = (pair.chainId ?? "unknown").toLowerCase();
  const tokenAddress = pair.baseToken?.address || clean;
  const paid = await fetchPaidListing(tokenAddress, pair.boosts?.active ?? null, chainId);

  const identity = identityFromPair(pair, tokenAddress);
  const boosts = pair.boosts?.active ?? null;
  const paidWithBoost =
    paid.report != null
      ? {
          ...paid,
          report: { ...paid.report, boostActive: boosts ?? paid.report.boostActive },
        }
      : paid;
  const market = marketFromPair(pair, paidWithBoost);

  let mentions: TokenMentionsReport = {
    totalFound: null,
    items: [],
    note: "Public X signals are temporarily unavailable.",
    updatedAt: new Date().toISOString(),
    availability: "unavailable",
  };
  try {
    mentions = await fetchTokenMentions(identity);
  } catch {
    mentions = {
      totalFound: null,
      items: [],
      note: "Public X signals are temporarily unavailable.",
      updatedAt: new Date().toISOString(),
      availability: "unavailable",
    };
  }

  return {
    identity,
    market,
    chart: approximateChart(market),
    analysis: analyzeToken(identity, market),
    mentions,
    diagnosis: analyzeTokenIntel({ identity, market, mentions }),
    freshness: market.updatedAt,
  };
}

export async function researchToken(input: string): Promise<
  | { kind: "single"; intel: TokenIntel }
  | { kind: "choices"; hits: TokenSearchHit[] }
  | { kind: "empty" }
> {
  const clean = input.trim();
  if (!clean) return { kind: "empty" };
  if (detectTokenInput(clean) === "address") {
    const intel = await researchTokenByAddress(clean);
    return intel ? { kind: "single", intel } : { kind: "empty" };
  }
  const hits = await searchTokensByName(clean);
  if (hits.length === 1) {
    const intel = await researchTokenByAddress(hits[0]!.address);
    if (intel) return { kind: "single", intel };
  }
  if (hits.length > 0) return { kind: "choices", hits };
  return { kind: "empty" };
}

export function explorerUrl(address: string, chain?: string): string {
  const c = (chain ?? "").toLowerCase();
  if (c === "ethereum") return `https://etherscan.io/token/${encodeURIComponent(address)}`;
  if (c === "base") return `https://basescan.org/token/${encodeURIComponent(address)}`;
  if (c === "bsc") return `https://bscscan.com/token/${encodeURIComponent(address)}`;
  if (c === "arbitrum") return `https://arbiscan.io/token/${encodeURIComponent(address)}`;
  if (c === "polygon") return `https://polygonscan.com/token/${encodeURIComponent(address)}`;
  if (c === "avalanche") return `https://snowtrace.io/token/${encodeURIComponent(address)}`;
  if (c === "optimism") return `https://optimistic.etherscan.io/token/${encodeURIComponent(address)}`;
  if (SOLANA_ADDRESS_RE.test(address) || c === "solana") {
    return `https://solscan.io/token/${encodeURIComponent(address)}`;
  }
  return `https://dexscreener.com/search?q=${encodeURIComponent(address)}`;
}

export type ViralToken = {
  address: string;
  name: string;
  symbol: string;
  logoUrl: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  viralScore: number;
  reason: string;
};

/**
 * Rank Solana tokens that are moving (volume + change + liquidity floor).
 * Free public market data only. No fabricated metrics.
 */
export async function fetchViralSolanaTokens(limit = 12): Promise<ViralToken[]> {
  const searchQueries = ["SOL", "BONK", "JUP", "WIF", "RAY", "PYTH", "JITO", "ORCA"];
  const pairBatches = await Promise.all(
    searchQueries.map((q) =>
      fetchJson<{ pairs?: DexPair[] }>(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      ),
    ),
  );

  const pool: DexPair[] = [];
  for (const batch of pairBatches) {
    for (const p of batch?.pairs ?? []) {
      if ((p.chainId ?? "").toLowerCase() === "solana") pool.push(p);
    }
  }

  // Boosted tokens list (when available)
  try {
    const boosted = await fetchJson<Array<{ chainId?: string; tokenAddress?: string }>>(
      "https://api.dexscreener.com/token-boosts/top/v1",
    );
    const solBoosts = (boosted ?? [])
      .filter((r) => (r.chainId ?? "").toLowerCase() === "solana" && r.tokenAddress)
      .slice(0, 8);
    const extra = await Promise.all(
      solBoosts.map((r) =>
        fetchJson<{ pairs?: DexPair[] }>(
          `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(r.tokenAddress!)}`,
        ),
      ),
    );
    for (const detail of extra) {
      for (const p of detail?.pairs ?? []) {
        if ((p.chainId ?? "").toLowerCase() === "solana") pool.push(p);
      }
    }
  } catch {
    /* optional source */
  }

  const byAddr = new Map<string, DexPair>();
  for (const p of pool) {
    const addr = p.baseToken?.address;
    if (!addr) continue;
    const prev = byAddr.get(addr);
    if (!prev || (p.volume?.h24 ?? 0) > (prev.volume?.h24 ?? 0)) {
      byAddr.set(addr, p);
    }
  }

  const ranked: ViralToken[] = [];
  for (const p of byAddr.values()) {
    const vol = p.volume?.h24 ?? 0;
    const liq = p.liquidity?.usd ?? 0;
    const ch = p.priceChange?.h24 ?? 0;
    if (liq < 5_000) continue;
    const volScore = Math.min(50, Math.log10(Math.max(vol, 1)) * 8);
    const moveScore = Math.min(30, Math.abs(ch) * 0.4);
    const liqScore = Math.min(20, Math.log10(Math.max(liq, 1)) * 3);
    const viralScore = Math.round(volScore + moveScore + liqScore);
    const reasons: string[] = [];
    if (vol > 500_000) reasons.push("high 24h volume");
    else if (vol > 50_000) reasons.push("active volume");
    if (Math.abs(ch) > 20) reasons.push("sharp 24h move");
    else if (Math.abs(ch) > 8) reasons.push("notable 24h move");
    if (liq > 200_000) reasons.push("deeper liquidity");
    ranked.push({
      address: p.baseToken?.address ?? "",
      name: p.baseToken?.name ?? "Unknown",
      symbol: (p.baseToken?.symbol ?? "—").toUpperCase(),
      logoUrl: p.info?.imageUrl ?? null,
      priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
      priceChange24h: ch,
      volume24h: vol || null,
      liquidityUsd: liq || null,
      viralScore,
      reason: reasons.length ? reasons.join(" · ") : "market activity",
    });
  }

  ranked.sort((a, b) => b.viralScore - a.viralScore);
  return ranked.filter((r) => r.address).slice(0, limit);
}


export type ChartTimeframe =
  | "1m"
  | "3m"
  | "5m"
  | "1h"
  | "4h"
  | "12h"
  | "1M";

export type OhlcvCandle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

const TF_CONFIG: Record<
  ChartTimeframe,
  { geckoTf: "minute" | "hour" | "day"; aggregate: number; limit: number }
> = {
  "1m": { geckoTf: "minute", aggregate: 1, limit: 120 },
  "3m": { geckoTf: "minute", aggregate: 3, limit: 100 },
  "5m": { geckoTf: "minute", aggregate: 5, limit: 100 },
  "1h": { geckoTf: "hour", aggregate: 1, limit: 72 },
  "4h": { geckoTf: "hour", aggregate: 4, limit: 90 },
  "12h": { geckoTf: "hour", aggregate: 12, limit: 60 },
  "1M": { geckoTf: "day", aggregate: 1, limit: 60 },
};

/**
 * OHLCV via GeckoTerminal public pool endpoint (free). Falls back to empty on rate limit.
 */
export async function fetchTokenOhlcv(
  pairAddress: string | null,
  timeframe: ChartTimeframe,
): Promise<OhlcvCandle[]> {
  if (!pairAddress) return [];
  const cfg = TF_CONFIG[timeframe];
  // network slug is not always equal to dexscreener chainId; best-effort
  const network = "solana"; // pair-address based; caller may pass network later
  const url =
    `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pairAddress)}` +
    `/ohlcv/${cfg.geckoTf}?aggregate=${cfg.aggregate}&limit=${cfg.limit}&currency=usd&token=base`;
  try {
    const data = await fetchJson<{
      data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
    }>(url);
    const list = data?.data?.attributes?.ohlcv_list ?? [];
    return list
      .map((row) => {
        const [ts, open, high, low, close, volume] = row;
        return {
          t: ts * (ts < 1e12 ? 1000 : 1),
          open,
          high,
          low,
          close,
          volume: volume ?? null,
        };
      })
      .filter((c) => Number.isFinite(c.close) && c.close > 0)
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}
