/**
 * Public X mentions for a token.
 * Uses the existing FxTwitter public API (search when it responds, otherwise
 * the official / catalog profile timelines). No web, news, or other networks.
 */
import { findCatalogAccount, PUBLIC_SOCIAL_SEED, type PublicSocialAccount } from "./public-social.ts";
import type { TokenIdentity, TokenMention, TokenMentionsReport } from "./token-intel.ts";
import { isTokenMention } from "./viral-intel.ts";

export type MentionAvailability = TokenMentionsReport["availability"];

export type RawXStatus = {
  type?: string;
  id?: string | number;
  text?: string;
  url?: string;
  likes?: number | null;
  created_at?: string;
  replying_to?: { screen_name?: string } | null;
  author?: {
    name?: string;
    screen_name?: string;
    username?: string;
    verified?: boolean;
    verification?: { verified?: boolean; type?: string };
  };
};

export type XSourceSample =
  | { state: "ok"; statuses: RawXStatus[] }
  | { state: "unavailable" };

const RESERVED_HANDLES = new Set(["i", "intent", "share", "search", "home", "hashtag"]);

export function officialHandleFromUrl(twitter: string | null | undefined): string | null {
  if (!twitter) return null;
  const lower = twitter.toLowerCase();
  const xAt = lower.indexOf("x.com/");
  const twAt = lower.indexOf("twitter.com/");
  const start = xAt >= 0 ? xAt + "x.com/".length : twAt >= 0 ? twAt + "twitter.com/".length : -1;
  if (start < 0) {
    const bare = twitter.trim().replace(/^@/, "");
    if (/^[A-Za-z0-9_]{1,30}$/.test(bare) && !RESERVED_HANDLES.has(bare.toLowerCase())) return bare;
    return null;
  }
  const handle = (twitter.slice(start).split(/[/?#]/)[0] ?? "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,30}$/.test(handle)) return null;
  if (RESERVED_HANDLES.has(handle.toLowerCase())) return null;
  return handle;
}

export function classifyMentionKind(input: {
  handle: string;
  officialHandle: string | null;
  verified: boolean;
  catalog?: PublicSocialAccount | null;
}): TokenMention["kind"] {
  const handle = input.handle.replace(/^@/, "").toLowerCase();
  if (input.officialHandle && handle === input.officialHandle.toLowerCase()) return "official";
  const category = input.catalog?.category;
  if (category === "creator") return "kol";
  if (input.verified) return "verified";
  return "other";
}

function finiteLike(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statusUrl(status: RawXStatus, handle: string): string | null {
  if (typeof status.url === "string" && /^https:\/\/(x|twitter)\.com\//i.test(status.url)) {
    return status.url;
  }
  const id = status.id != null ? String(status.id) : "";
  if (/^\d{5,30}$/.test(id) && handle) return `https://x.com/${handle}/status/${id}`;
  return null;
}

function publishedAt(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function looseOfficialMatch(text: string, symbol: string, name: string, address: string): boolean {
  if (address && address.length > 20 && text.includes(address)) return true;
  const sym = symbol.replace(/[^A-Za-z0-9]/g, "");
  if (sym.length >= 3 && new RegExp(`\\b${sym}\\b`, "i").test(text)) return true;
  const nm = name.trim();
  if (nm.length >= 4 && text.toLowerCase().includes(nm.toLowerCase())) return true;
  return false;
}

export function normalizePublicMention(
  status: RawXStatus,
  ctx: { symbol: string; name: string; address: string; officialHandle: string | null; catalog?: PublicSocialAccount[] },
): TokenMention | null {
  const text = (status.text ?? "").replace(/\s+/g, " ").trim();
  const handle = (status.author?.screen_name ?? status.author?.username ?? "").replace(/^@/, "").trim();
  if (!text || !/^[A-Za-z0-9_]{1,30}$/.test(handle)) return null;
  const url = statusUrl(status, handle);
  if (!url) return null;

  const official = ctx.officialHandle;
  const isOfficialAuthor = Boolean(official && handle.toLowerCase() === official.toLowerCase());
  const replyTo = status.replying_to?.screen_name?.replace(/^@/, "").toLowerCase() ?? "";
  if (replyTo && replyTo !== handle.toLowerCase()) return null;

  const corresponds =
    isTokenMention(text, ctx.symbol, ctx.name) ||
    (isOfficialAuthor && looseOfficialMatch(text, ctx.symbol, ctx.name, ctx.address));
  if (!corresponds) return null;

  const verified =
    status.author?.verification?.verified === true || status.author?.verified === true;
  const catalog = findCatalogAccount(ctx.catalog ?? PUBLIC_SOCIAL_SEED, handle);
  const authorName = (status.author?.name ?? "").trim();

  return {
    author: authorName || handle,
    handle,
    verified,
    kind: classifyMentionKind({
      handle,
      officialHandle: official,
      verified,
      catalog,
    }),
    text: text.slice(0, 500),
    url,
    likes: finiteLike(status.likes),
    at: publishedAt(status.created_at),
  };
}

export function relatedProfileHandles(
  identity: Pick<TokenIdentity, "symbol" | "name" | "twitter">,
  catalog: PublicSocialAccount[] = PUBLIC_SOCIAL_SEED,
): string[] {
  const handles = new Set<string>();
  const official = officialHandleFromUrl(identity.twitter);
  if (official) handles.add(official.toLowerCase());
  const symbol = identity.symbol.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const name = identity.name.trim().toLowerCase();
  if (symbol.length >= 3 || name.length >= 4) {
    for (const row of catalog) {
      const handle = row.handle.toLowerCase();
      const display = row.displayName.trim().toLowerCase();
      const symbolHit =
        symbol.length >= 3 && (handle === symbol || handle.startsWith(`${symbol}_`) || display === symbol);
      const nameHit = name.length >= 4 && display === name;
      if (symbolHit || nameHit) handles.add(handle);
    }
  }
  return [...handles].slice(0, 4);
}

export function assembleTokenMentions(input: {
  symbol: string;
  name: string;
  address: string;
  twitter: string | null;
  search: XSourceSample;
  profiles: XSourceSample[];
  now?: string;
}): TokenMentionsReport {
  const updatedAt = input.now ?? new Date().toISOString();
  const officialHandle = officialHandleFromUrl(input.twitter);
  const ok = [input.search, ...input.profiles].filter((sample) => sample.state === "ok");
  if (!ok.length) {
    return {
      totalFound: null,
      items: [],
      note: "Public X signals are temporarily unavailable.",
      updatedAt,
      availability: "unavailable",
    };
  }

  const seen = new Set<string>();
  const items: TokenMention[] = [];
  for (const sample of ok) {
    if (sample.state !== "ok") continue;
    for (const status of sample.statuses) {
      if (status.type === "thread") continue;
      const mention = normalizePublicMention(status, {
        symbol: input.symbol,
        name: input.name,
        address: input.address,
        officialHandle,
      });
      if (!mention || seen.has(mention.url)) continue;
      seen.add(mention.url);
      items.push(mention);
    }
  }

  items.sort((a, b) => {
    if (a.kind === "official" && b.kind !== "official") return -1;
    if (b.kind === "official" && a.kind !== "official") return 1;
    const likes = (b.likes ?? -1) - (a.likes ?? -1);
    if (likes !== 0) return likes;
    return (b.at ?? "").localeCompare(a.at ?? "");
  });

  const capped = items.slice(0, 12);
  if (!capped.length) {
    return {
      totalFound: 0,
      items: [],
      note: "No verified public X mentions found for this token right now.",
      updatedAt,
      availability: "empty",
    };
  }

  const searchDown = input.search.state === "unavailable";
  const note = searchDown
    ? "Public posts from X accounts linked to this token. Broader X search is temporarily unavailable."
    : "Public X posts that match this token.";

  return {
    totalFound: capped.length,
    items: capped,
    note,
    updatedAt,
    availability: "available",
  };
}

const TIMEOUT_MS = 8_000;

async function fetchXJson(url: string): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "XPulse/1.0 public-social",
      },
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: res.status, body: null };
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readStatuses(body: unknown, status: number): XSourceSample {
  if (status < 200 || status >= 300 || !body || typeof body !== "object") {
    return { state: "unavailable" };
  }
  const record = body as { code?: number; results?: unknown };
  if (record.code != null && record.code !== 200) return { state: "unavailable" };
  if (!Array.isArray(record.results)) return { state: "unavailable" };
  return { state: "ok", statuses: record.results as RawXStatus[] };
}

export async function fetchTokenMentions(identity: TokenIdentity): Promise<TokenMentionsReport> {
  const symbol = identity.symbol;
  const name = identity.name;
  const query = [symbol && symbol !== "—" ? `$${symbol}` : null, symbol !== "—" ? symbol : null, name]
    .filter((part): part is string => Boolean(part && part.trim().length >= 2))
    .join(" OR ");

  const searchPromise = query
    ? fetchXJson(
        `https://api.fxtwitter.com/2/search?${new URLSearchParams({ q: query, feed: "latest", count: "40" })}`,
      )
    : Promise.resolve(null);

  const handles = relatedProfileHandles(identity);
  const profilePromises = handles.map((handle) =>
    fetchXJson(
      `https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=20`,
    ),
  );

  const [searchRes, ...profileRes] = await Promise.all([searchPromise, ...profilePromises]);
  const search: XSourceSample = searchRes ? readStatuses(searchRes.body, searchRes.status) : { state: "unavailable" };
  const profiles: XSourceSample[] = profileRes.map((res) =>
    res ? readStatuses(res.body, res.status) : { state: "unavailable" },
  );

  return assembleTokenMentions({
    symbol,
    name,
    address: identity.address,
    twitter: identity.twitter,
    search,
    profiles,
  });
}
