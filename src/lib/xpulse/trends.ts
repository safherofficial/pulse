/**
 * Viral / web3 trend signals from free public APIs.
 * Cache TTL: 30 minutes. Intended refresh cadence: on-demand + twice daily
 * conceptual snapshot (caller can persist lastSuccessfulAt).
 *
 * Sources (no API key required):
 * - CoinGecko trending search (crypto + Solana-adjacent)
 * - CoinGecko Solana category / top coins as web3 context
 * - GitHub trending (jsdelivr static mirror) for builder/dev signals
 */

const TTL_MS = 30 * 60 * 1000;

export type TrendItem = {
  id: string;
  label: string;
  source: "coingecko" | "github" | "solana";
  score: number;
  url?: string;
  meta?: string;
};

export type TrendSnapshot = {
  fetchedAt: string;
  expiresAt: string;
  items: TrendItem[];
  sources: string[];
  web3Bias: string[];
};

type CacheEntry = {
  snapshot: TrendSnapshot;
  rawAt: number;
};

let memoryCache: CacheEntry | null = null;

async function fetchWithTimeout(
  url: string,
  timeoutMs = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** CoinGecko trending — free, no key. */
async function fetchCoinGeckoTrending(): Promise<TrendItem[]> {
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/search/trending",
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      coins?: Array<{
        item?: {
          id?: string;
          name?: string;
          symbol?: string;
          market_cap_rank?: number | null;
          score?: number;
        };
      }>;
    };
    const items: TrendItem[] = [];
    for (const row of payload.coins ?? []) {
      const c = row.item;
      if (!c?.id || !c.name) continue;
      const symbol = (c.symbol ?? "").toUpperCase();
      const isSolAdjacent =
        /sol|ray|jup|bonk|wif|pyth|jito|render|tensor|orca|marinade/i.test(
          c.id + " " + c.name + " " + symbol,
        );
      items.push({
        id: `cg:${c.id}`,
        label: symbol ? `${c.name} (${symbol})` : c.name,
        source: isSolAdjacent ? "solana" : "coingecko",
        score: typeof c.score === "number" ? c.score : 50,
        url: `https://www.coingecko.com/en/coins/${c.id}`,
        meta:
          c.market_cap_rank != null
            ? `rank #${c.market_cap_rank}`
            : undefined,
      });
    }
    return items.slice(0, 12);
  } catch {
    return [];
  }
}

/** CoinGecko Solana ecosystem coins (free). */
async function fetchSolanaCategory(): Promise<TrendItem[]> {
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-ecosystem&order=volume_desc&per_page=10&page=1&sparkline=false",
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      id?: string;
      name?: string;
      symbol?: string;
      price_change_percentage_24h?: number | null;
      total_volume?: number;
    }>;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r.id && r.name)
      .map((r, i) => ({
        id: `sol:${r.id}`,
        label: `${r.name} (${(r.symbol ?? "").toUpperCase()})`,
        source: "solana" as const,
        score: 70 - i * 3 + Math.min(15, Math.abs(r.price_change_percentage_24h ?? 0)),
        url: `https://www.coingecko.com/en/coins/${r.id}`,
        meta:
          r.price_change_percentage_24h != null
            ? `${r.price_change_percentage_24h >= 0 ? "+" : ""}${r.price_change_percentage_24h.toFixed(1)}% 24h`
            : undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * GitHub trending (static JSON mirror, free).
 * https://cdn.jsdelivr.net/gh/Hyraze/trending-collection@main/api/daily/all.json
 */
async function fetchGitHubTrending(): Promise<TrendItem[]> {
  try {
    const res = await fetchWithTimeout(
      "https://cdn.jsdelivr.net/gh/Hyraze/trending-collection@main/api/daily/all.json",
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as
      | Array<{ name?: string; url?: string; description?: string; language?: string }>
      | { repos?: Array<{ name?: string; url?: string; description?: string }> };
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { repos?: unknown }).repos)
        ? (payload as { repos: Array<{ name?: string; url?: string; description?: string }> }).repos
        : [];
    const web3Re =
      /\b(solana|web3|crypto|blockchain|defi|nft|token|wallet|anchor|spl|raydium|jupiter)\b/i;
    const items: TrendItem[] = [];
    for (const row of rows.slice(0, 40)) {
      const name = row.name ?? "";
      const desc = (row as { description?: string }).description ?? "";
      const blob = `${name} ${desc}`;
      if (!web3Re.test(blob) && items.length >= 4) continue;
      if (!name) continue;
      items.push({
        id: `gh:${name}`,
        label: name,
        source: "github",
        score: web3Re.test(blob) ? 75 : 45,
        url: row.url,
        meta: (row as { language?: string }).language,
      });
      if (items.length >= 8) break;
    }
    return items;
  } catch {
    return [];
  }
}

function buildWeb3Bias(items: TrendItem[]): string[] {
  const labels = items
    .filter((i) => i.source === "solana" || /sol|web3|defi|token/i.test(i.label))
    .map((i) => i.label.split("(")[0]!.trim())
    .slice(0, 10);
  return [...new Set(labels)];
}

/**
 * Fetch (or return cached) viral/web3 trend snapshot.
 * TTL 30 minutes. Safe to call on every rewrite/enrich.
 */
export async function getTrendSnapshot(force = false): Promise<TrendSnapshot> {
  const now = Date.now();
  if (
    !force &&
    memoryCache &&
    now - memoryCache.rawAt < TTL_MS
  ) {
    return memoryCache.snapshot;
  }

  const sources: string[] = [];
  const [cg, sol, gh] = await Promise.all([
    fetchCoinGeckoTrending().then((rows) => {
      if (rows.length) sources.push("coingecko-trending");
      return rows;
    }),
    fetchSolanaCategory().then((rows) => {
      if (rows.length) sources.push("coingecko-solana");
      return rows;
    }),
    fetchGitHubTrending().then((rows) => {
      if (rows.length) sources.push("github-trending");
      return rows;
    }),
  ]);

  const merged = [...sol, ...cg, ...gh];
  // Dedupe by label lower
  const seen = new Set<string>();
  const items: TrendItem[] = [];
  for (const item of merged) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  items.sort((a, b) => b.score - a.score);

  const snapshot: TrendSnapshot = {
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    items: items.slice(0, 24),
    sources: [...new Set(sources)],
    web3Bias: buildWeb3Bias(items),
  };

  memoryCache = { snapshot, rawAt: now };
  return snapshot;
}

/**
 * Score how well a post text aligns with current web3/viral trends.
 * Returns 0–100. Used to boost rewrite selection and surface advice.
 */
export function trendAlignmentScore(text: string, snapshot: TrendSnapshot): number {
  const lower = text.toLowerCase();
  if (!snapshot.items.length) return 40;

  let hits = 0;
  let weight = 0;
  for (const item of snapshot.items) {
    const tokens = item.label
      .toLowerCase()
      .replace(/[()]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    for (const t of tokens) {
      if (lower.includes(t)) {
        hits += 1;
        weight += item.score;
        break;
      }
    }
  }
  // Structural web3 keywords
  const web3Kw =
    (lower.match(
      /\b(solana|sol\b|\$sol|web3|on-chain|onchain|defi|nft|token|wallet|airdrop|mainnet|devnet|anchor|spl|jupiter|raydium|phantom|backpack)\b/gi,
    ) ?? []).length;

  const base = Math.min(55, hits * 12 + web3Kw * 8);
  const trendBoost = Math.min(35, weight / 20);
  return Math.max(0, Math.min(100, Math.round(base + trendBoost)));
}

/**
 * Short advice strings derived from live trends (for UI / applied notes).
 */
export function trendRewriteHints(snapshot: TrendSnapshot): string[] {
  const hints: string[] = [];
  const top = snapshot.web3Bias.slice(0, 3);
  if (top.length) {
    hints.push(`Web3 pulse: ${top.join(", ")} are moving — concrete names beat abstract “crypto”.`);
  }
  if (snapshot.items.some((i) => i.source === "github")) {
    hints.push("Builder signal is hot: lead with what you shipped, not the category.");
  }
  hints.push("Numbers + timeframe + one named outcome travel further than hype adjectives.");
  return hints.slice(0, 3);
}
