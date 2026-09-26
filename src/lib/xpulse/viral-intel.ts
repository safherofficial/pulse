/**
 * Viral Intelligence Layer — cross-platform attention signals for tokens.
 * Real public sources only. Never invent counts, views, or engagement.
 * Unavailable platforms stay Unavailable — never coerced to zero.
 */

import type { TokenIntel } from "./token-intel";

const TIMEOUT_MS = 9_000;
const CACHE_TTL_MS = 5 * 60_000;

export type PlatformId = "x" | "tiktok" | "web" | "reddit" | "youtube" | "other";

export type PlatformMention = {
  platform: PlatformId;
  label: string;
  /** Exact count when known; null = unavailable (not zero). */
  mentions24h: number | null;
  /** Reliability of the mentions figure. */
  reliability: "exact" | "partial" | "estimated" | "unavailable";
  note: string | null;
};

export type ViralPost = {
  platform: PlatformId;
  author: string;
  text: string;
  url: string;
  likes: number | null;
  views: number | null;
  replies: number | null;
  createdAt: string | null;
  score: number | null;
};

export type ViralIntel = {
  query: string;
  window: "24h";
  platforms: PlatformMention[];
  /** Sum only of exact/partial compatible counts — null if nothing measurable. */
  totalMentions24h: number | null;
  totalReliability: "exact" | "partial" | "unavailable";
  activity: "high" | "medium" | "low" | "unknown";
  activityReasons: string[];
  topPosts: ViralPost[];
  updatedAt: string;
  note: string;
};

type CacheEntry = { at: number; data: ViralIntel };
const cache = new Map<string, CacheEntry>();

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "XPulse/1.0 (research; +https://xpulse.app)",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function finite(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim()) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function searchTerms(intel: TokenIntel): string[] {
  const terms = new Set<string>();
  if (intel.identity.symbol) terms.add(intel.identity.symbol);
  if (intel.identity.name) terms.add(intel.identity.name);
  // Prefer symbol+$ for memecoins when short
  if (intel.identity.symbol && intel.identity.symbol.length <= 8) {
    terms.add(`$${intel.identity.symbol}`);
  }
  return [...terms].filter(Boolean).slice(0, 3);
}

/** Reddit public JSON search — last day when t=day works. */
async function researchReddit(terms: string[]): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const q = terms[0];
  if (!q) {
    return { mentions: null, reliability: "unavailable", posts: [], note: "No search term." };
  }
  const url =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}` +
    `&sort=new&t=day&limit=25&type=link`;
  const data = await fetchJson<{
    data?: {
      children?: Array<{
        data?: {
          title?: string;
          selftext?: string;
          author?: string;
          score?: number;
          num_comments?: number;
          permalink?: string;
          created_utc?: number;
          subreddit?: string;
          ups?: number;
        };
      }>;
    };
  }>(url);

  const children = data?.data?.children ?? [];
  if (!data) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Reddit sample temporarily unavailable.",
    };
  }

  const cutoff = Date.now() / 1000 - 24 * 3600;
  const inWindow = children.filter((c) => {
    const ts = c.data?.created_utc;
    return typeof ts === "number" && ts >= cutoff;
  });

  const posts: ViralPost[] = inWindow
    .map((c) => {
      const d = c.data!;
      const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : null;
      if (!permalink) return null;
      const text = (d.title ?? "").trim() || (d.selftext ?? "").slice(0, 180);
      return {
        platform: "reddit" as const,
        author: d.author ? `u/${d.author}` : "reddit",
        text: text.slice(0, 220),
        url: permalink,
        likes: finite(d.score) ?? finite(d.ups),
        views: null,
        replies: finite(d.num_comments),
        createdAt:
          d.created_utc != null
            ? new Date(d.created_utc * 1000).toISOString()
            : null,
        score: finite(d.score),
      };
    })
    .filter((p): p is ViralPost => p != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  // Search page is a sample (limit 25), not a full index count
  return {
    mentions: inWindow.length,
    reliability: "partial",
    posts,
    note: `Partial sample from public search (up to 25 results, last ~24h). Not a full-platform count.`,
  };
}

/**
 * X: no free public search index for mention counts.
 * When official profile tweets exist we already use them elsewhere;
 * here we mark mentions Unavailable unless we have nothing else to claim.
 */
async function researchX(intel: TokenIntel): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const twitter = intel.identity.twitter;
  if (!twitter) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "No free public X search index for token mentions. Official profile not linked.",
    };
  }
  const m = twitter.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  const handle = m?.[1];
  if (!handle) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Official X link could not be resolved.",
    };
  }

  const data = await fetchJson<{
    tweets?: Array<{
      text?: string;
      likes?: number;
      replies?: number;
      retweets?: number;
      views?: number | string;
      created_at?: string;
      id?: string | number;
      url?: string;
    }>;
  }>(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);

  if (!data?.tweets?.length) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Public X sample unavailable. Mention counts require a search API not available free.",
    };
  }

  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recent = data.tweets.filter((t) => {
    if (!t.created_at) return false;
    const ts = Date.parse(t.created_at);
    return Number.isFinite(ts) && ts >= cutoff;
  });

  const posts: ViralPost[] = recent
    .map((t) => {
      const id = t.id != null ? String(t.id) : null;
      const url =
        t.url ||
        (id ? `https://x.com/${handle}/status/${id}` : null);
      if (!url || !t.text) return null;
      return {
        platform: "x" as const,
        author: `@${handle}`,
        text: t.text.slice(0, 220),
        url,
        likes: finite(t.likes),
        views: finite(t.views),
        replies: finite(t.replies),
        createdAt: t.created_at ?? null,
        score: finite(t.likes),
      };
    })
    .filter((p): p is ViralPost => p != null)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 6);

  return {
    mentions: recent.length,
    reliability: "partial",
    posts,
    note: "Partial: posts from official account only (last 24h sample). Not total X mentions of the token.",
  };
}

function unavailable(
  platform: PlatformId,
  label: string,
  reason: string,
): PlatformMention {
  return {
    platform,
    label,
    mentions24h: null,
    reliability: "unavailable",
    note: reason,
  };
}

function activityLevel(
  platforms: PlatformMention[],
  postCount: number,
): { activity: ViralIntel["activity"]; reasons: string[] } {
  const measured = platforms.filter(
    (p) => p.mentions24h != null && p.reliability !== "unavailable",
  );
  if (!measured.length && postCount === 0) {
    return {
      activity: "unknown",
      reasons: ["Insufficient public samples to classify viral activity."],
    };
  }
  const sum = measured.reduce((a, p) => a + (p.mentions24h ?? 0), 0);
  const reasons: string[] = [];
  for (const p of measured) {
    reasons.push(
      `${p.label}: ${p.mentions24h} (${p.reliability}${p.note ? ` — sample` : ""})`,
    );
  }
  if (postCount > 0) reasons.push(`${postCount} ranked public post(s) recovered.`);

  // Thresholds are descriptive of the available sample, not global truth
  if (sum >= 20 || postCount >= 8) {
    return { activity: "high", reasons };
  }
  if (sum >= 5 || postCount >= 3) {
    return { activity: "medium", reasons };
  }
  if (sum > 0 || postCount > 0) {
    return { activity: "low", reasons };
  }
  return { activity: "unknown", reasons };
}

/**
 * Run viral intelligence for a researched token.
 * Cached 5 minutes per query key.
 */
export async function researchViralIntel(intel: TokenIntel): Promise<ViralIntel> {
  const terms = searchTerms(intel);
  const cacheKey = `${intel.identity.chain}:${intel.identity.address}:${terms.join("|")}`.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  const [reddit, x] = await Promise.all([researchReddit(terms), researchX(intel)]);

  const platforms: PlatformMention[] = [
    {
      platform: "x",
      label: "X",
      mentions24h: x.mentions,
      reliability: x.reliability,
      note: x.note,
    },
    unavailable(
      "tiktok",
      "TikTok",
      "No free public TikTok search API for mention counts.",
    ),
    unavailable(
      "web",
      "Google / Web",
      "Search-index counts require a search API key — not configured.",
    ),
    {
      platform: "reddit",
      label: "Reddit",
      mentions24h: reddit.mentions,
      reliability: reddit.reliability,
      note: reddit.note,
    },
    unavailable(
      "youtube",
      "YouTube",
      "YouTube Data API key required for search counts — not configured.",
    ),
    unavailable("other", "Other", "No additional public sources configured."),
  ];

  // Total only from partial/exact — never treat unavailable as 0
  const countable = platforms.filter(
    (p) =>
      p.mentions24h != null &&
      (p.reliability === "exact" || p.reliability === "partial"),
  );
  const totalMentions24h =
    countable.length > 0
      ? countable.reduce((a, p) => a + (p.mentions24h ?? 0), 0)
      : null;
  const totalReliability: ViralIntel["totalReliability"] =
    countable.length === 0
      ? "unavailable"
      : countable.every((p) => p.reliability === "exact")
        ? "exact"
        : "partial";

  // Rank posts: engagement + recency, max 10, real permalinks only
  const topPosts = [...x.posts, ...reddit.posts]
    .filter((p) => p.url.startsWith("http"))
    .sort((a, b) => {
      const ea = (a.likes ?? 0) * 2 + (a.replies ?? 0) * 3 + (a.views ?? 0) * 0.0001;
      const eb = (b.likes ?? 0) * 2 + (b.replies ?? 0) * 3 + (b.views ?? 0) * 0.0001;
      return eb - ea;
    })
    .slice(0, 10);

  const { activity, reasons } = activityLevel(platforms, topPosts.length);

  const result: ViralIntel = {
    query: terms.join(" / "),
    window: "24h",
    platforms,
    totalMentions24h,
    totalReliability,
    activity,
    activityReasons: reasons,
    topPosts,
    updatedAt: new Date().toISOString(),
    note:
      totalReliability === "unavailable"
        ? "Viral metrics largely unavailable from free public sources. No invented counts."
        : "Totals combine only measurable public samples (partial). Not a full web census.",
  };

  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

export function clearViralIntelCache() {
  cache.clear();
}
