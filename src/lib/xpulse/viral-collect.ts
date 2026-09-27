import type { TokenIntel } from "./token-intel";
import { isTokenMention, parseCompactCount, parseYoutubeAgeHours, type PlatformMention, type ViralPost } from "./viral-intel";

export type SourceSample = { posts: ViralPost[]; reliability: PlatformMention["reliability"]; note: string | null; unavailable: boolean };

const TIMEOUT_MS = 9000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

async function fetchText(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { Accept: "application/json, application/xml, text/xml, */*", "User-Agent": UA, ...(init?.headers ?? {}) } });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetchText(url, init);
  if (!res || res.status < 200 || res.status >= 300) return null;
  try { return JSON.parse(res.body) as T; } catch { return null; }
}

function finite(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim()) { const v = Number(n); return Number.isFinite(v) ? v : null; }
  return null;
}

type FxStatus = { type?: string; id?: string | number; text?: string; url?: string; likes?: number; replies?: number; views?: number | string; created_at?: string; created_timestamp?: number; author?: { screen_name?: string } };

function statusToPost(status: FxStatus, fallbackAuthor: string): ViralPost | null {
  const text = (status.text ?? "").trim();
  const id = status.id != null ? String(status.id) : null;
  const url = (typeof status.url === "string" && status.url.startsWith("http") ? status.url : null) || (id && fallbackAuthor ? `https://x.com/${fallbackAuthor.replace(/^@/, "")}/status/${id}` : null);
  if (!text || !url) return null;
  const createdAt = status.created_at ? new Date(Date.parse(status.created_at)).toISOString() : status.created_timestamp ? new Date(status.created_timestamp >= 1e12 ? status.created_timestamp : status.created_timestamp * 1000).toISOString() : null;
  return { platform: "x", author: status.author?.screen_name ? `@${status.author.screen_name}` : fallbackAuthor, text: text.slice(0, 220), url, likes: finite(status.likes), views: finite(status.views), replies: finite(status.replies), createdAt: createdAt && createdAt !== "Invalid Date" ? createdAt : null, score: finite(status.likes) };
}

export async function collectX(intel: TokenIntel): Promise<SourceSample> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const query = [symbol ? `$${symbol}` : null, symbol, name].filter(Boolean).join(" OR ");
  const search = await fetchText(`https://api.fxtwitter.com/2/search?${new URLSearchParams({ q: query, feed: "latest", count: "40" })}`);
  if (search?.status === 200) {
    try {
      const data = JSON.parse(search.body) as { code?: number; results?: FxStatus[] };
      if (data.code === 200 && Array.isArray(data.results)) {
        const posts = data.results.filter((s) => isTokenMention(s.text ?? "", symbol, name)).map((s) => statusToPost(s, symbol ? `$${symbol}` : "x")).filter((p): p is ViralPost => p != null);
        return { posts, reliability: "partial", unavailable: false, note: "Partial public X search sample." };
      }
    } catch { /* fall through */ }
  }
  const handle = intel.identity.twitter?.match(/(?:x\\.com|twitter\\.com)\\/([A-Za-z0-9_]+)/i)?.[1];
  if (!handle || ["i", "intent", "share", "search", "home", "hashtag"].includes(handle.toLowerCase())) {
    return { posts: [], reliability: "unavailable", unavailable: true, note: "Public X sample unavailable." };
  }
  const data = await fetchJson<{ results?: FxStatus[] }>(`https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=40`);
  if (!data?.results) return { posts: [], reliability: "unavailable", unavailable: true, note: "Public X sample unavailable." };
  const posts = data.results.filter((s) => s.type !== "thread").map((s) => statusToPost(s, `@${handle}`)).filter((p): p is ViralPost => p != null);
  return { posts, reliability: "partial", unavailable: false, note: `Partial: posts from @${handle}.` };
}

export async function collectWeb(intel: TokenIntel): Promise<SourceSample> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const clauses = [`"${symbol}"`, `"$${symbol}"`];
  if (name && name.length >= 3 && name.toLowerCase() !== symbol.toLowerCase()) clauses.push(`"${name}"`);
  const q = `(${clauses.join(" OR ")}) (crypto OR token OR coin OR memecoin)`;
  const res = await fetchText(`https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" })}`);
  if (!res || res.status !== 200) return { posts: [], reliability: "unavailable", unavailable: true, note: "Public news sample unavailable." };
  const posts: ViralPost[] = [];
  for (const item of res.body.matchAll(/<item>([\\s\\S]*?)<\\/item>/g)) {
    const block = item[1] ?? "";
    const title = (block.match(/<title>([\\s\\S]*?)<\\/title>/)?.[1] ?? "").trim();
    const link = (block.match(/<link>([\\s\\S]*?)<\\/link>/)?.[1] ?? "").trim();
    const pub = (block.match(/<pubDate>([\\s\\S]*?)<\\/pubDate>/)?.[1] ?? "").trim();
    const source = (block.match(/<source[^>]*>([\\s\\S]*?)<\\/source>/)?.[1] ?? "News").trim();
    if (!title || !link.startsWith("http") || !isTokenMention(title, symbol, name)) continue;
    const ts = pub ? Date.parse(pub) : NaN;
    posts.push({ platform: "web", author: source, text: title.slice(0, 220), url: link, likes: null, views: null, replies: null, createdAt: Number.isFinite(ts) ? new Date(ts).toISOString() : null, score: null });
  }
  return { posts, reliability: "partial", unavailable: false, note: "Partial Google News sample." };
}

export async function collectYoutube(intel: TokenIntel): Promise<SourceSample> {
  return { posts: [], reliability: "unavailable", unavailable: true, note: "YouTube collector loads via youtubei when the search endpoint responds." };
}

export async function collectHn(intel: TokenIntel): Promise<SourceSample> {
  const symbol = intel.identity.symbol;
  const name = intel.identity.name;
  const data = await fetchJson<{ hits?: Array<{ title?: string; url?: string; author?: string; points?: number; num_comments?: number; created_at?: string; objectID?: string }> }>(`https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query: symbol, tags: "story", hitsPerPage: "30" })}`);
  if (!data?.hits) return { posts: [], reliability: "unavailable", unavailable: true, note: "Hacker News sample unavailable." };
  const posts = data.hits.map((hit) => {
    const title = (hit.title ?? "").trim();
    const url = (hit.url && hit.url.startsWith("http") ? hit.url : null) || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null);
    if (!title || !url || !isTokenMention(title, symbol, name)) return null;
    return { platform: "other" as const, author: hit.author ? `hn/${hit.author}` : "hacker news", text: title.slice(0, 220), url, likes: finite(hit.points), views: null, replies: finite(hit.num_comments), createdAt: hit.created_at ?? null, score: finite(hit.points) };
  }).filter((p): p is ViralPost => p != null);
  return { posts, reliability: "partial", unavailable: false, note: "Partial Hacker News sample." };
}

export async function collectAllSources(intel: TokenIntel) {
  const [x, web, youtube, other] = await Promise.all([collectX(intel), collectWeb(intel), collectYoutube(intel), collectHn(intel)]);
  return { x, web, youtube, other };
}
