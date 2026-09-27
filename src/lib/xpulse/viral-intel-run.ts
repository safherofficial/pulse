import type { TokenIntel } from "./token-intel";
import { collectX, rankXPosts } from "./viral-collect";
import { getCachedViralIntel, cacheViralIntel, type ViralIntel } from "./viral-intel";

export async function runViralIntel(intel: TokenIntel): Promise<ViralIntel> {
  const key = `x:${intel.identity.chain}:${intel.identity.address}`.toLowerCase();
  const cached = getCachedViralIntel(key);
  if (cached) return cached;

  const source = await collectX(intel);
  const topPosts = rankXPosts(source.posts).slice(0, 10);

  return cacheViralIntel(key, {
    query: [intel.identity.symbol, intel.identity.name].filter(Boolean).join(" / "),
    source: "x",
    topPosts,
    updatedAt: new Date().toISOString(),
    note: source.unavailable
      ? "No trending/relevant X posts are available right now. No external fallback is used."
      : source.note ?? "Trending and relevant posts are sourced from X only.",
  });
}
