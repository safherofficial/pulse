/**
 * Viral Intelligence Layer — cross-platform attention signals for tokens.
 * Real public sources only. Never invent counts, views, or engagement.
 * Unavailable platforms stay Unavailable — never coerced to zero.
 * A successful sample with no matches in the window is 0, not Unavailable.
 */

import type { TokenIntel } from "./token-intel";

const TIMEOUT_MS = 9_000;
const CACHE_TTL_MS = 5 * 60_000;
const WINDOW_MS = 24 * 3600_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

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

type FxStatus = {
  type?: string;
  id?: string | number;
  text?: string;
  url?: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  retweets?: number;
  views?: number | string;
  created_at?: string;
  created_timestamp?: number;
  author?: { screen_name?: string; name?: string };
};

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json, application/xml, text/xml, */*",
        "User-Agent": BROWSER_UA,
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetchText(url, init);
  if (!res || res.status < 200 || res.status >= 300) return null;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

/**
 * True when text is actually about this token, not a shared English word.
 * Cashtags, pair tickers, and (SYMBOL) always count. A bare word counts
 * when it is the uppercase ticker or sits next to a crypto term.
 */
export function isTokenMention(
  text: string,
  symbol: string,
  name: string | null,
): boolean {
  const raw = decodeEntities(text).replace(/<[^>]+>/g, " ");
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "").trim();
  if (sym.length < 2) return false;
  const escaped = escapeRegExp(sym);
  if (new RegExp(`\\$${escaped}\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}(USDT|USDC|USD|EUR)\\b`, "i").test(raw)) return true;
  if (new RegExp(`\\(${escaped}\\)`, "i").test(raw)) return true;
  if (new RegExp(`\\b${escaped}\\b`).test(raw) && sym === sym.toUpperCase()) return true;
  const crypto =
    /\b(crypto|token|coin|memecoin|meme\s*coin|solana|ethereum|bitcoin|defi|altcoin|usdt|usdc|dex)\b/i;
  if (new RegExp(`\\b${escaped}\\b`, "i").test(raw) && crypto.test(raw)) return true;
  const nm = (name ?? "").trim();
  if (nm.length >= 4 && nm.toLowerCase() !== sym.toLowerCase()) {
    const nameRe = new RegExp(`\\b${escapeRegExp(nm)}\\b`, "i");
    if (nameRe.test(raw) && crypto.test(raw)) return true;
  }
  return false;
}

/** Hours ago from a YouTube relative label. Null when the label is not a time. */
export function parseYoutubeAgeHours(label: string | null): number | null {
  if (!label) return null;
  const match = label
    .trim()
    .toLowerCase()
    .match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  switch (match[2]) {
    case "second":
      return n / 3600;
    case "minute":
      return n / 60;
    case "hour":
      return n;
    case "day":
      return n * 24;
    case "week":
      return n * 24 * 7;
    case "month":
      return n * 24 * 30;
    default:
      return n * 24 * 365;
  }
}

export function parseCompactCount(label: string | null): number | null {
  if (!label) return null;
  const match = label.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  let n = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "k") n *= 1_000;
  if (unit === "m") n *= 1_000_000;
  if (unit === "b") n *= 1_000_000_000;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function searchTerms(intel: TokenIntel): string[] {
  const terms = new Set<string>();
  if (intel.identity.symbol) terms.add(intel.identity.symbol);
  if (intel.identity.name) terms.add(intel.identity.name);
  if (intel.identity.symbol && intel.identity.symbol.length <= 8) {
    terms.add(`$${intel.identity.symbol}`);
  }
  return [...terms].filter(Boolean).slice(0, 3);
}

function officialHandle(twitter: string | null): string | null {
  if (!twitter) return null;
  const match = twitter.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  const handle = match?.[1];
  if (!handle) return null;
  if (["i", "intent", "share", "search", "home", "hashtag"].includes(handle.toLowerCase())) {
    return null;
  }
  return handle;
}

function statusToPost(status: FxStatus, fallbackAuthor: string): ViralPost | null {
  const text = (status.text ?? "").trim();
  const id = status.id != null ? String(status.id) : null;
  const url =
    (typeof status.url === "string" && status.url.startsWith("http") ? status.url : null) ||
    (id && fallbackAuthor
      ? `https://x.com/${fallbackAuthor.replace(/^@/, "")}/status/${id}`
      : null);
  if (!text || !url) return null;
  const authorName =
    status.author?.screen_name ? `@${status.author.screen_name}` : fallbackAuthor;
  const createdAt = status.created_at
    ? (() => {
        const ts = Date.parse(status.created_at);
        return Number.isFinite(ts) ? new Date(ts).toISOString() : status.created_at;
      })()
    : status.created_timestamp
      ? new Date(status.created_timestamp * 1000).toISOString()
      : null;
  return {
    platform: "x",
    author: authorName,
    text: text.slice(0, 220),
    url,
    likes: finite(status.likes),
    views: finite(status.views),
    replies: finite(status.replies),
    createdAt,
    score: finite(status.likes),
  };
}

function statusInWindow(status: FxStatus, cutoffMs: number): boolean {
  if (typeof status.created_timestamp === "number" && Number.isFinite(status.created_timestamp)) {
    const ms =
      status.created_timestamp >= 1e12
        ? status.created_timestamp
        : status.created_timestamp * 1000;
    return ms >= cutoffMs;
  }
  if (status.created_at) {
    const ts = Date.parse(status.created_at);
    return Number.isFinite(ts) && ts >= cutoffMs;
  }
  return false;
}

/**
 * X public search is often empty (HTTP 404 with no results) even for common
 * queries, so a failed search is Unavailable — not zero.
 * The official timeline is a real partial sample when the profile is linked.
 */
async function researchX(intel: TokenIntel): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const cutoffMs = Date.now() - WINDOW_MS;
  const query = [symbol ? `$${symbol}` : null, symbol, name].filter(Boolean).join(" OR ");
  const search = await fetchText(
    `https://api.fxtwitter.com/2/search?${new URLSearchParams({
      q: query,
      feed: "latest",
      count: "40",
    })}`,
  );

  if (search && search.status === 200) {
    try {
      const data = JSON.parse(search.body) as { code?: number; results?: FxStatus[] };
      if (data.code === 200 && Array.isArray(data.results)) {
        const posts = data.results
          .filter((status) => statusInWindow(status, cutoffMs))
          .filter((status) => isTokenMention(status.text ?? "", symbol, name))
          .map((status) => statusToPost(status, symbol ? `$${symbol}` : "x"))
          .filter((post): post is ViralPost => post != null)
          .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
          .slice(0, 8);
        return {
          mentions: posts.length,
          reliability: "partial",
          posts,
          note: "Partial public X search sample (latest page, last 24h). Not every mention on X.",
        };
      }
    } catch {
      /* fall through to the official timeline */
    }
  }

  const handle = officialHandle(intel.identity.twitter);
  if (!handle) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Public X search returned no index, and this token has no official profile to sample.",
    };
  }

  const data = await fetchJson<{ code?: number; results?: FxStatus[] }>(
    `https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=40`,
  );
  if (!data || !Array.isArray(data.results)) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Public X sample unavailable. Mention search did not return a usable index.",
    };
  }

  const posts = data.results
    .filter((status) => status.type !== "thread")
    .filter((status) => statusInWindow(status, cutoffMs))
    .map((status) => statusToPost(status, `@${handle}`))
    .filter((post): post is ViralPost => post != null)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 8);

  return {
    mentions: posts.length,
    reliability: "partial",
    posts,
    note: `Partial: posts from @${handle} in the last 24h. Not total X mentions of the token.`,
  };
}

async function researchWeb(intel: TokenIntel): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const clauses = [`"${symbol}"`, `"$${symbol}"`];
  if (name && name.length >= 3 && name.toLowerCase() !== symbol.toLowerCase()) {
    clauses.push(`"${name}"`);
  }
  const q = `(${clauses.join(" OR ")}) (crypto OR token OR coin OR memecoin) when:1d`;
  const res = await fetchText(
    `https://news.google.com/rss/search?${new URLSearchParams({
      q,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    })}`,
  );
  if (!res || res.status !== 200 || !res.body.includes("<item")) {
    if (!res || res.status >= 400) {
      return {
        mentions: null,
        reliability: "unavailable",
        posts: [],
        note: "Public news sample temporarily unavailable.",
      };
    }
  }
  if (!res) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Public news sample temporarily unavailable.",
    };
  }

  const cutoffMs = Date.now() - WINDOW_MS;
  const items = [...res.body.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const posts: ViralPost[] = [];
  for (const item of items) {
    const block = item[1] ?? "";
    const title = decodeEntities(
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "",
    );
    const link = decodeEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "");
    const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const source = decodeEntities(
      block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() ?? "News",
    );
    const ts = pub ? Date.parse(pub) : NaN;
    if (!title || !link.startsWith("http")) continue;
    if (!Number.isFinite(ts) || ts < cutoffMs) continue;
    if (!isTokenMention(title, symbol, name)) continue;
    posts.push({
      platform: "web",
      author: source,
      text: title.slice(0, 220),
      url: link,
      likes: null,
      views: null,
      replies: null,
      createdAt: new Date(ts).toISOString(),
      score: null,
    });
  }

  return {
    mentions: posts.length,
    reliability: "partial",
    posts: posts.slice(0, 8),
    note: "Partial Google News sample from the last 24h. Not a full web index count.",
  };
}

function ytText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const node = value as { simpleText?: string; runs?: Array<{ text?: string }> };
  if (typeof node.simpleText === "string" && node.simpleText.trim()) return node.simpleText;
  if (Array.isArray(node.runs)) {
    const text = node.runs.map((run) => run.text ?? "").join("");
    return text.trim() ? text : null;
  }
  return null;
}

function collectVideoRenderers(node: unknown, out: Array<Record<string, unknown>>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.videoRenderer && typeof record.videoRenderer === "object") {
    out.push(record.videoRenderer as Record<string, unknown>);
  }
  for (const value of Object.values(record)) collectVideoRenderers(value, out);
}

async function researchYoutube(intel: TokenIntel): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const query = name && name.toLowerCase() !== symbol.toLowerCase()
    ? `${symbol} ${name} crypto`
    : `${symbol} crypto`;
  const data = await fetchJson<unknown>(
    "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240901.00.00",
            hl: "en",
            gl: "US",
          },
        },
        query,
        // Upload-date filter: today. Still re-checked against a 24h label.
        params: "EgIIAg==",
      }),
    },
  );
  if (!data) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Public YouTube search sample temporarily unavailable.",
    };
  }

  const renderers: Array<Record<string, unknown>> = [];
  collectVideoRenderers(data, renderers);
  const posts: ViralPost[] = [];
  const seen = new Set<string>();
  for (const video of renderers) {
    const id = typeof video.videoId === "string" ? video.videoId : null;
    const title = ytText(video.title);
    if (!id || !title || seen.has(id)) continue;
    const age = parseYoutubeAgeHours(ytText(video.publishedTimeText));
    // "1 day ago" is 24h or more. Only count labels strictly inside the window.
    if (age == null || age >= 24) continue;
    if (!isTokenMention(title, symbol, name)) continue;
    seen.add(id);
    const views = parseCompactCount(ytText(video.viewCountText) ?? ytText(video.shortViewCountText));
    posts.push({
      platform: "youtube",
      author: ytText(video.ownerText) ?? "YouTube",
      text: title.slice(0, 220),
      url: `https://www.youtube.com/watch?v=${id}`,
      likes: null,
      views,
      replies: null,
      createdAt: null,
      score: views,
    });
  }
  posts.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  return {
    mentions: posts.length,
    reliability: "partial",
    posts: posts.slice(0, 8),
    note: "Partial: today's public YouTube results that mention the token and are under 24h old. Not every upload.",
  };
}

/** Reddit public JSON is often blocked. A blocked sample stays Unavailable. */
async function researchReddit(terms: string[], symbol: string, name: string | null): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const q = terms.find((term) => !term.startsWith("$")) ?? terms[0];
  if (!q) {
    return { mentions: null, reliability: "unavailable", posts: [], note: "No search term." };
  }
  const url =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`${q} (crypto OR token OR coin)`)}` +
    `&sort=new&t=day&limit=25&type=link&raw_json=1`;
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
          ups?: number;
        };
      }>;
    };
  }>(url);

  if (!data?.data?.children) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Reddit public search is blocked from this network. Count left unavailable.",
    };
  }

  const cutoff = Date.now() / 1000 - 24 * 3600;
  const posts: ViralPost[] = data.data.children
    .map((child) => {
      const row = child.data;
      if (!row?.permalink || typeof row.created_utc !== "number" || row.created_utc < cutoff) {
        return null;
      }
      const text = (row.title ?? "").trim() || (row.selftext ?? "").slice(0, 180);
      if (!text || !isTokenMention(text, symbol, name)) return null;
      return {
        platform: "reddit" as const,
        author: row.author ? `u/${row.author}` : "reddit",
        text: text.slice(0, 220),
        url: `https://www.reddit.com${row.permalink}`,
        likes: finite(row.score) ?? finite(row.ups),
        views: null,
        replies: finite(row.num_comments),
        createdAt: new Date(row.created_utc * 1000).toISOString(),
        score: finite(row.score),
      };
    })
    .filter((post): post is ViralPost => post != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  return {
    mentions: posts.length,
    reliability: "partial",
    posts,
    note: "Partial sample from public Reddit search (last 24h). Not a full-platform count.",
  };
}

async function researchOther(intel: TokenIntel): Promise<{
  mentions: number | null;
  reliability: PlatformMention["reliability"];
  posts: ViralPost[];
  note: string | null;
}> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const since = Math.floor((Date.now() - WINDOW_MS) / 1000);
  const data = await fetchJson<{
    hits?: Array<{
      title?: string;
      url?: string;
      author?: string;
      points?: number;
      num_comments?: number;
      created_at?: string;
      objectID?: string;
    }>;
  }>(
    `https://hn.algolia.com/api/v1/search?${new URLSearchParams({
      query: symbol,
      tags: "story",
      numericFilters: `created_at_i>${since}`,
      hitsPerPage: "20",
    })}`,
  );
  if (!data?.hits) {
    return {
      mentions: null,
      reliability: "unavailable",
      posts: [],
      note: "Hacker News sample temporarily unavailable.",
    };
  }

  const posts: ViralPost[] = data.hits
    .map((hit) => {
      const title = (hit.title ?? "").trim();
      const url =
        (hit.url && hit.url.startsWith("http") ? hit.url : null) ||
        (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null);
      if (!title || !url || !isTokenMention(title, symbol, name)) return null;
      return {
        platform: "other" as const,
        author: hit.author ? `hn/${hit.author}` : "hacker news",
        text: title.slice(0, 220),
        url,
        likes: finite(hit.points),
        views: null,
        replies: finite(hit.num_comments),
        createdAt: hit.created_at ?? null,
        score: finite(hit.points),
      };
    })
    .filter((post): post is ViralPost => post != null)
    .slice(0, 6);

  return {
    mentions: posts.length,
    reliability: "partial",
    posts,
    note: "Partial: Hacker News stories from the last 24h that mention the token.",
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

export function rollupAttention(
  platforms: PlatformMention[],
  postCount: number,
): {
  totalMentions24h: number | null;
  totalReliability: ViralIntel["totalReliability"];
  activity: ViralIntel["activity"];
  activityReasons: string[];
} {
  const countable = platforms.filter(
    (platform) =>
      platform.mentions24h != null &&
      (platform.reliability === "exact" || platform.reliability === "partial"),
  );
  const totalMentions24h =
    countable.length > 0
      ? countable.reduce((sum, platform) => sum + (platform.mentions24h ?? 0), 0)
      : null;
  const totalReliability: ViralIntel["totalReliability"] =
    countable.length === 0
      ? "unavailable"
      : countable.every((platform) => platform.reliability === "exact")
        ? "exact"
        : "partial";

  const measured = platforms.filter(
    (platform) => platform.mentions24h != null && platform.reliability !== "unavailable",
  );
  if (!measured.length && postCount === 0) {
    return {
      totalMentions24h,
      totalReliability,
      activity: "unknown",
      activityReasons: ["Insufficient public samples to classify viral activity."],
    };
  }
  const sum = measured.reduce((total, platform) => total + (platform.mentions24h ?? 0), 0);
  const reasons: string[] = [];
  for (const platform of measured) {
    reasons.push(`${platform.label}: ${platform.mentions24h} (${platform.reliability})`);
  }
  if (postCount > 0) reasons.push(`${postCount} ranked public post(s) recovered.`);

  // Thresholds describe this sample only. Post count alone must not
  // mark a token high just because several partial sources returned rows.
  let activity: ViralIntel["activity"] = "unknown";
  if (sum >= 15) activity = "high";
  else if (sum >= 5) activity = "medium";
  else if (sum > 0 || postCount > 0) activity = "low";

  return { totalMentions24h, totalReliability, activity, activityReasons: reasons };
}

/**
 * Run viral intelligence for a researched token.
 * Cached 5 minutes per query key. Safe to call on the server only.
 */
export async function researchViralIntel(intel: TokenIntel): Promise<ViralIntel> {
  const terms = searchTerms(intel);
  const cacheKey = `${intel.identity.chain}:${intel.identity.address}:${terms.join("|")}`.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  const [x, web, reddit, youtube, other] = await Promise.all([
    researchX(intel),
    researchWeb(intel),
    researchReddit(terms, intel.identity.symbol, intel.identity.name),
    researchYoutube(intel),
    researchOther(intel),
  ]);

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
    {
      platform: "web",
      label: "Google / Web",
      mentions24h: web.mentions,
      reliability: web.reliability,
      note: web.note,
    },
    {
      platform: "reddit",
      label: "Reddit",
      mentions24h: reddit.mentions,
      reliability: reddit.reliability,
      note: reddit.note,
    },
    {
      platform: "youtube",
      label: "YouTube",
      mentions24h: youtube.mentions,
      reliability: youtube.reliability,
      note: youtube.note,
    },
    {
      platform: "other",
      label: "Hacker News",
      mentions24h: other.mentions,
      reliability: other.reliability,
      note: other.note,
    },
  ];

  const topPosts = [...x.posts, ...web.posts, ...reddit.posts, ...youtube.posts, ...other.posts]
    .filter((post) => post.url.startsWith("http"))
    .sort((a, b) => {
      const scoreA = (a.likes ?? 0) * 2 + (a.replies ?? 0) * 3 + (a.views ?? 0) * 0.01;
      const scoreB = (b.likes ?? 0) * 2 + (b.replies ?? 0) * 3 + (b.views ?? 0) * 0.01;
      return scoreB - scoreA;
    })
    .slice(0, 10);

  const rolled = rollupAttention(platforms, topPosts.length);
  const result: ViralIntel = {
    query: terms.join(" / "),
    window: "24h",
    platforms,
    totalMentions24h: rolled.totalMentions24h,
    totalReliability: rolled.totalReliability,
    activity: rolled.activity,
    activityReasons: rolled.activityReasons,
    topPosts,
    updatedAt: new Date().toISOString(),
    note:
      rolled.totalReliability === "unavailable"
        ? "Viral metrics unavailable from public sources right now. No invented counts."
        : "Totals add only measurable public samples from the last 24h. Not a full census.",
  };

  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

export function clearViralIntelCache() {
  cache.clear();
}
