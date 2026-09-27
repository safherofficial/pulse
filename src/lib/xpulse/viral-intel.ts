/** Viral Intelligence: X-only trending and relevant post intelligence. */
export type PlatformId = "x";
export type PostSignal = "trending" | "relevant";

export type ViralPost = {
  platform: "x";
  author: string;
  text: string;
  url: string;
  likes: number | null;
  views: number | null;
  replies: number | null;
  createdAt: string | null;
  score: number | null;
  signal: PostSignal;
};

export type ViralIntel = {
  query: string;
  source: "x";
  topPosts: ViralPost[];
  updatedAt: string;
  note: string;
};

const cache = new Map<string, { at: number; data: ViralIntel }>();

export function isTokenMention(
  text: string,
  symbol: string,
  name: string | null,
): boolean {
  const raw = text.replace(/<[^>]+>/g, " ");
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "").trim();
  if (sym.length < 2) return false;
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\$${escaped}\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}(USDT|USDC|USD|EUR)\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\(${escaped}\\)`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}\\b`).test(raw) && sym === sym.toUpperCase()) return true;

  const crypto = /\b(crypto|token|coin|memecoin|solana|ethereum|bitcoin|defi|altcoin|usdt|usdc|dex)\b/i;
  if (new RegExp(`\\b${escaped}\\b`, "i").test(raw) && crypto.test(raw)) return true;

  const nm = (name ?? "").trim();
  if (
    nm.length >= 4 &&
    nm.toLowerCase() !== sym.toLowerCase() &&
    new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(raw) &&
    crypto.test(raw)
  ) {
    return true;
  }

  return false;
}

export function cacheViralIntel(key: string, data: ViralIntel): ViralIntel {
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function getCachedViralIntel(key: string): ViralIntel | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at >= 5 * 60_000) return null;
  return hit.data;
}

export function clearViralIntelCache() {
  cache.clear();
}
