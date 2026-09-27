import type { TokenIntel } from "./token-intel";
import { isTokenMention, type ViralPost } from "./viral-intel";

export type SourceSample = {
  posts: ViralPost[];
  reliability: "exact" | "partial" | "unavailable";
  note: string | null;
  unavailable: boolean;
};

const TIMEOUT_MS = 9000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    return { status: res.status, body: await res.text() };
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

type FxStatus = {
  type?: string;
  id?: string | number;
  text?: string;
  url?: string;
  likes?: number;
  replies?: number;
  views?: number | string;
  created_at?: string;
  created_timestamp?: number;
  author?: { screen_name?: string };
};

function statusToPost(
  status: FxStatus,
  fallbackAuthor: string,
): ViralPost | null {
  const text = (status.text ?? "").trim();
  const id = status.id != null ? String(status.id) : null;
  const url =
    (typeof status.url === "string" && status.url.startsWith("http")
      ? status.url
      : null) ||
    (id && fallbackAuthor
      ? `https://x.com/${fallbackAuthor.replace(/^@/, "")}/status/${id}`
      : null);

  if (!text || !url) return null;

  let createdAt: string | null = null;
  if (status.created_at) {
    const ts = Date.parse(status.created_at);
    if (Number.isFinite(ts)) createdAt = new Date(ts).toISOString();
  } else if (status.created_timestamp) {
    const ts =
      status.created_timestamp >= 1e12
        ? status.created_timestamp
        : status.created_timestamp * 1000;
    if (Number.isFinite(ts)) createdAt = new Date(ts).toISOString();
  }

  return {
    platform: "x",
    author: status.author?.screen_name
      ? `@${status.author.screen_name}`
      : fallbackAuthor,
    text: text.slice(0, 280),
    url,
    likes: finite(status.likes),
    views: finite(status.views),
    replies: finite(status.replies),
    createdAt,
    score: null,
    signal: "relevant",
  };
}

function readHandle(twitter: string | null): string | null {
  if (!twitter) return null;
  const lower = twitter.toLowerCase();
  const marks = ["x.com/", "twitter.com/"];
  let start = -1;
  for (const mark of marks) {
    const at = lower.indexOf(mark);
    if (at >= 0) {
      start = at + mark.length;
      break;
    }
  }
  if (start < 0) return null;
  const cut = twitter.slice(start);
  let end = cut.length;
  for (const ch of ["/", "?", "#"]) {
    const at = cut.indexOf(ch);
    if (at >= 0 && at < end) end = at;
  }
  const handle = cut.slice(0, end);
  if (!/^[A-Za-z0-9_]{1,30}$/.test(handle)) return null;
  if (["i", "intent", "share", "search", "home", "hashtag"].includes(handle.toLowerCase())) return null;
  return handle;
}

function rankScore(post: ViralPost, now: number): number {
  const likes = post.likes ?? 0;
  const replies = post.replies ?? 0;
  const views = post.views ?? 0;
  const engagement =
    Math.min(60, Math.log10(likes + 1) * 12) +
    Math.min(20, Math.log10(replies + 1) * 8) +
    Math.min(15, Math.log10(views + 1) * 3);
  const ts = post.createdAt ? Date.parse(post.createdAt) : NaN;
  const ageHours = Number.isFinite(ts)
    ? Math.max(0, (now - ts) / 3_600_000)
    : 72;
  return Number(Math.min(100, engagement + Math.max(0, 20 - ageHours / 2)).toFixed(2));
}

export function rankXPosts(posts: ViralPost[], now = Date.now()): ViralPost[] {
  return posts
    .map((post) => ({ ...post, score: rankScore(post, now) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((post, index, ranked) => ({
      ...post,
      signal:
        (post.score ?? 0) > 55 && index < Math.max(1, Math.ceil(ranked.length * 0.3))
          ? "trending"
          : "relevant",
    }));
}

export async function collectX(intel: TokenIntel): Promise<SourceSample> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const query = [symbol ? `$${symbol}` : null, symbol, name]
    .filter(Boolean)
    .join(" OR ");

  const search = await fetchText(
    `https://api.fxtwitter.com/2/search?${new URLSearchParams({
      q: query,
      feed: "latest",
      count: "40",
    })}`,
  );

  if (search?.status === 200) {
    try {
      const data = JSON.parse(search.body) as {
        code?: number;
        results?: FxStatus[];
      };
      if (data.code === 200 && Array.isArray(data.results)) {
        const posts = data.results
          .filter((status) => isTokenMention(status.text ?? "", symbol, name))
          .map((status) => statusToPost(status, symbol ? `$${symbol}` : "x"))
          .filter((post): post is ViralPost => post != null);
        return {
          posts,
          reliability: "partial",
          unavailable: false,
          note: "X-only public sample ranked for relevance and engagement.",
        };
      }
    } catch {
      // Fall through to the public profile sample.
    }
  }

  const handle = readHandle(intel.identity.twitter);
  if (!handle) {
    return {
      posts: [],
      reliability: "unavailable",
      unavailable: true,
      note: "Public X sample unavailable.",
    };
  }

  const profile = await fetchText(
    `https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=40`,
  );
  if (!profile || profile.status < 200 || profile.status >= 300) {
    return {
      posts: [],
      reliability: "unavailable",
      unavailable: true,
      note: "Public X sample unavailable.",
    };
  }

  try {
    const data = JSON.parse(profile.body) as { results?: FxStatus[] };
    if (!Array.isArray(data.results)) {
      return {
        posts: [],
        reliability: "unavailable",
        unavailable: true,
        note: "Public X sample unavailable.",
      };
    }
    const posts = data.results
      .filter((status) => status.type !== "thread")
      .map((status) => statusToPost(status, `@${handle}`))
      .filter((post): post is ViralPost => post != null);
    return {
      posts,
      reliability: "partial",
      unavailable: false,
      note: `X-only public sample from @${handle}.`,
    };
  } catch {
    return {
      posts: [],
      reliability: "unavailable",
      unavailable: true,
      note: "Public X sample unavailable.",
    };
  }
}
