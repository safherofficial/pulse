import type { TokenIntel } from "./token-intel";
import { collectAllSources } from "./viral-collect";
import { classifyTrend, rollupAttention, type TimeWindowId, type ViralIntel, type ViralPost, type WindowMetrics, type PlatformMention } from "./viral-intel";

function postMs(post: ViralPost): number | null {
  if (!post.createdAt) return null;
  const ts = Date.parse(post.createdAt);
  return Number.isFinite(ts) ? ts : null;
}

function inWindow(post: ViralPost, id: TimeWindowId, now: number): boolean {
  if (id === "all") return true;
  const ts = postMs(post);
  if (ts == null) return false;
  const hours = id === "1h" ? 1 : id === "6h" ? 6 : 24;
  return ts >= now - hours * 3600_000;
}

function buildWindow(id: TimeWindowId, all: ViralPost[], now: number, available: boolean): WindowMetrics {
  const posts = all.filter((p) => inWindow(p, id, now));
  const dated = posts.map(postMs).filter((n): n is number => n != null);
  const hours = id === "all" ? (dated.length ? Math.max((now - Math.min(...dated)) / 3600_000, 1) : null) : id === "1h" ? 1 : id === "6h" ? 6 : 24;
  const mentions = available ? posts.length : null;
  const engVals = posts.flatMap((p) => [p.likes, p.replies].filter((n): n is number => n != null));
  const viewVals = posts.map((p) => p.views).filter((n): n is number => n != null);
  const coverageSince = id === "all" && dated.length ? new Date(Math.min(...dated)).toISOString().slice(0, 10) : null;
  return {
    id,
    label: id === "all" ? "ALL TIME" : id.toUpperCase(),
    mentions,
    engagement: engVals.length ? engVals.reduce((a, b) => a + b, 0) : null,
    views: viewVals.length ? viewVals.reduce((a, b) => a + b, 0) : null,
    velocity: mentions != null && hours ? Number((mentions / hours).toFixed(3)) : null,
    reliability: available ? "partial" : "unavailable",
    trend: "UNKNOWN",
    narratives: [],
    note: id === "all" ? (coverageSince ? `Historical data available since ${coverageSince}. Not a complete census.` : "No dated public posts recovered.") : "Partial public sample for this window.",
    coverageSince,
    hoursCovered: hours,
  };
}

export async function runViralIntel(intel: TokenIntel): Promise<ViralIntel> {
  const sources = await collectAllSources(intel);
  const now = Date.now();
  const allPosts = [...sources.x.posts, ...sources.web.posts, ...sources.youtube.posts, ...sources.other.posts].filter((p) => p.url.startsWith("http"));
  const available = [sources.x, sources.web, sources.youtube, sources.other].some((s) => !s.unavailable);
  const windows = {
    "1h": buildWindow("1h", allPosts, now, available),
    "6h": buildWindow("6h", allPosts, now, available),
    "24h": buildWindow("24h", allPosts, now, available),
    all: buildWindow("all", allPosts, now, available),
  };
  const c16 = classifyTrend(windows["1h"].mentions, 1, windows["6h"].mentions, 6);
  const c624 = classifyTrend(windows["6h"].mentions, 6, windows["24h"].mentions, 24);
  const c24a = classifyTrend(windows["24h"].mentions, 24, windows.all.mentions, windows.all.hoursCovered ?? 24);
  windows["1h"].trend = c16;
  windows["6h"].trend = c624;
  windows["24h"].trend = c24a;
  const platforms: PlatformMention[] = [
    { platform: "x", label: "X", mentions24h: sources.x.unavailable ? null : sources.x.posts.filter((p) => inWindow(p, "24h", now)).length, reliability: sources.x.reliability, note: sources.x.note },
    { platform: "web", label: "Google / Web", mentions24h: sources.web.unavailable ? null : sources.web.posts.filter((p) => inWindow(p, "24h", now)).length, reliability: sources.web.reliability, note: sources.web.note },
    { platform: "youtube", label: "YouTube", mentions24h: sources.youtube.unavailable ? null : sources.youtube.posts.filter((p) => inWindow(p, "24h", now)).length, reliability: sources.youtube.reliability, note: sources.youtube.note },
    { platform: "other", label: "Hacker News", mentions24h: sources.other.unavailable ? null : sources.other.posts.filter((p) => inWindow(p, "24h", now)).length, reliability: sources.other.reliability, note: sources.other.note },
  ];
  const topPosts = allPosts.slice().sort((a, b) => (b.likes ?? 0) + (b.replies ?? 0) - ((a.likes ?? 0) + (a.replies ?? 0))).slice(0, 10);
  const rolled = rollupAttention(platforms, topPosts.length);
  return {
    query: [intel.identity.symbol, intel.identity.name].filter(Boolean).join(" / "),
    window: "24h",
    windows,
    platforms,
    totalMentions24h: rolled.totalMentions24h,
    totalReliability: rolled.totalReliability,
    activity: rolled.activity,
    activityReasons: rolled.activityReasons,
    topPosts,
    comparisons: [
      { from: "1h", to: "6h", trend: c16, note: "1H vs 6H" },
      { from: "6h", to: "24h", trend: c624, note: "6H vs 24H" },
      { from: "24h", to: "all", trend: c24a, note: "24H vs ALL TIME" },
    ],
    updatedAt: new Date().toISOString(),
    note: rolled.totalReliability === "unavailable" ? "Viral metrics unavailable from public sources right now. No invented counts." : "Windows share one public sample. ALL TIME is recovered history, not a complete census.",
  };
}
