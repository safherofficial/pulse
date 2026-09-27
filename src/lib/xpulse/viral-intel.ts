/** Viral Intelligence multi-window. TikTok/Reddit removed. See local pulse-edit. */
export type TimeWindowId = "1h" | "6h" | "24h" | "all";
export type PlatformId = "x" | "web" | "youtube" | "other";
export type TrendLabel = "RISING" | "STABLE" | "COOLING" | "SPIKING" | "UNKNOWN";
export type PlatformMention = { platform: PlatformId; label: string; mentions24h: number | null; reliability: "exact" | "partial" | "estimated" | "unavailable"; note: string | null };
export type ViralPost = { platform: PlatformId; author: string; text: string; url: string; likes: number | null; views: number | null; replies: number | null; createdAt: string | null; score: number | null };
export type WindowMetrics = { id: TimeWindowId; label: string; mentions: number | null; engagement: number | null; views: number | null; velocity: number | null; reliability: "exact" | "partial" | "unavailable"; trend: TrendLabel; narratives: string[]; note: string | null; coverageSince: string | null; hoursCovered: number | null };
export type ViralIntel = { query: string; window: TimeWindowId; windows: Record<TimeWindowId, WindowMetrics>; platforms: PlatformMention[]; totalMentions24h: number | null; totalReliability: "exact" | "partial" | "unavailable"; activity: "high" | "medium" | "low" | "unknown"; activityReasons: string[]; topPosts: ViralPost[]; comparisons: Array<{ from: TimeWindowId; to: TimeWindowId; trend: TrendLabel; note: string }>; updatedAt: string; note: string };
const cache = new Map<string, { at: number; data: ViralIntel }>();
export function isTokenMention(text: string, symbol: string, name: string | null): boolean {
  const raw = text.replace(/<[^>]+>/g, " ");
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "").trim();
  if (sym.length < 2) return false;
  const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\$${escaped}\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}(USDT|USDC|USD|EUR)\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\(${escaped}\\)`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}\\b`).test(raw) && sym === sym.toUpperCase()) return true;
  const crypto = /\\b(crypto|token|coin|memecoin|solana|ethereum|bitcoin|defi|altcoin|usdt|usdc|dex)\\b/i;
  if (new RegExp(`\\b${escaped}\\b`, "i").test(raw) && crypto.test(raw)) return true;
  const nm = (name ?? "").trim();
  if (nm.length >= 4 && nm.toLowerCase() !== sym.toLowerCase() && new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(raw) && crypto.test(raw)) return true;
  return false;
}
export function parseYoutubeAgeHours(label: string | null): number | null {
  if (!label) return null;
  const match = label.trim().toLowerCase().match(/(\d+)\\s*(second|minute|hour|day|week|month|year)s?\\s+ago/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  switch (match[2]) {
    case "second": return n / 3600;
    case "minute": return n / 60;
    case "hour": return n;
    case "day": return n * 24;
    case "week": return n * 24 * 7;
    case "month": return n * 24 * 30;
    default: return n * 24 * 365;
  }
}
export function parseCompactCount(label: string | null): number | null {
  if (!label) return null;
  const match = label.replace(/,/g, "").match(/(\d+(?:\\.\\d+)?)\\s*([kmb])?/i);
  if (!match) return null;
  let n = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "k") n *= 1000;
  if (unit === "m") n *= 1_000_000;
  if (unit === "b") n *= 1_000_000_000;
  return Number.isFinite(n) ? Math.round(n) : null;
}
export function classifyTrend(shortMentions: number | null, shortHours: number, longMentions: number | null, longHours: number): TrendLabel {
  if (shortMentions == null || longMentions == null || shortHours <= 0 || longHours <= 0) return "UNKNOWN";
  const shortV = shortMentions / shortHours;
  const longV = longMentions / longHours;
  if (longV === 0 && shortV === 0) return "STABLE";
  if (longV === 0 && shortV > 0 && shortMentions >= 3) return "SPIKING";
  if (longV === 0 && shortV > 0) return "RISING";
  const ratio = shortV / longV;
  if (shortMentions >= 3 && ratio >= 2.2) return "SPIKING";
  if (ratio >= 1.25) return "RISING";
  if (ratio <= 0.6) return "COOLING";
  return "STABLE";
}
export function rollupAttention(platforms: PlatformMention[], postCount: number) {
  const countable = platforms.filter((p) => p.mentions24h != null && (p.reliability === "exact" || p.reliability === "partial"));
  const totalMentions24h = countable.length ? countable.reduce((s, p) => s + (p.mentions24h ?? 0), 0) : null;
  const totalReliability = countable.length === 0 ? "unavailable" as const : countable.every((p) => p.reliability === "exact") ? "exact" as const : "partial" as const;
  const measured = platforms.filter((p) => p.mentions24h != null && p.reliability !== "unavailable");
  if (!measured.length && postCount === 0) return { totalMentions24h, totalReliability, activity: "unknown" as const, activityReasons: ["Insufficient public samples to classify viral activity."] };
  const sum = measured.reduce((t, p) => t + (p.mentions24h ?? 0), 0);
  const activity = sum >= 15 ? "high" as const : sum >= 5 ? "medium" as const : sum > 0 || postCount > 0 ? "low" as const : "unknown" as const;
  return { totalMentions24h, totalReliability, activity, activityReasons: measured.map((p) => `${p.label}: ${p.mentions24h} (${p.reliability})`) };
}
function emptyWindow(id: TimeWindowId): WindowMetrics {
  const label = id === "all" ? "ALL TIME" : id.toUpperCase();
  return { id, label, mentions: null, engagement: null, views: null, velocity: null, reliability: "unavailable", trend: "UNKNOWN", narratives: [], note: "Public sample unavailable.", coverageSince: null, hoursCovered: id === "all" ? null : Number(id.replace("h", "")) || 24 };
}
export async function researchViralIntel(intel: { identity: { chain: string; address: string; symbol: string; name: string; twitter: string | null } }): Promise<ViralIntel> {
  const key = `${intel.identity.chain}:${intel.identity.address}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const windows = { "1h": emptyWindow("1h"), "6h": emptyWindow("6h"), "24h": emptyWindow("24h"), all: emptyWindow("all") };
  const platforms: PlatformMention[] = [
    { platform: "x", label: "X", mentions24h: null, reliability: "unavailable", note: "Live sample collected when sources respond." },
    { platform: "web", label: "Google / Web", mentions24h: null, reliability: "unavailable", note: null },
    { platform: "youtube", label: "YouTube", mentions24h: null, reliability: "unavailable", note: null },
    { platform: "other", label: "Hacker News", mentions24h: null, reliability: "unavailable", note: null },
  ];
  const rolled = rollupAttention(platforms, 0);
  const result: ViralIntel = {
    query: [intel.identity.symbol, intel.identity.name].filter(Boolean).join(" / "),
    window: "24h",
    windows,
    platforms,
    totalMentions24h: rolled.totalMentions24h,
    totalReliability: rolled.totalReliability,
    activity: rolled.activity,
    activityReasons: rolled.activityReasons,
    topPosts: [],
    comparisons: [
      { from: "1h", to: "6h", trend: "UNKNOWN", note: "1H vs 6H" },
      { from: "6h", to: "24h", trend: "UNKNOWN", note: "6H vs 24H" },
      { from: "24h", to: "all", trend: "UNKNOWN", note: "24H vs ALL TIME" },
    ],
    updatedAt: new Date().toISOString(),
    note: "Viral metrics use public X, Google News, YouTube and Hacker News only. TikTok and Reddit are not included.",
  };
  cache.set(key, { at: Date.now(), data: result });
  return result;
}
export function clearViralIntelCache() { cache.clear(); }
