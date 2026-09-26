export type PublicXPost = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
  authorUsername: string | null;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  bookmarks: number;
  views: number | null;
  provider: "fxtwitter" | "syndication";
};

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

const STATUS_ID = /^\d{1,30}$/;

export class PublicXError extends Error {
  readonly code: "INVALID_URL" | "NOT_FOUND" | "UPSTREAM" | "BAD_RESPONSE";

  constructor(
    message: string,
    code: PublicXError["code"],
  ) {
    super(message);
    this.name = "PublicXError";
    this.code = code;
  }
}

export function extractPublicXPostId(input: string): string | null {
  const value = input.trim();
  if (STATUS_ID.test(value)) return value;

  try {
    const url = new URL(value);
    if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const statusIndex = parts.findIndex(
      (part) => part.toLowerCase() === "status" || part.toLowerCase() === "statuses",
    );

    if (statusIndex < 0) return null;

    const id = parts[statusIndex + 1] ?? "";
    return STATUS_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function asNullableCount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = asCount(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function createdAt(value: unknown): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new PublicXError(
      "The post was returned without a valid publication date.",
      "BAD_RESPONSE",
    );
  }
  return date.toISOString();
}

function userFromFx(status: Record<string, unknown>) {
  const author =
    status.author && typeof status.author === "object"
      ? (status.author as Record<string, unknown>)
      : null;

  return {
    id: asString(author?.id),
    name: asString(author?.name) ?? asString(author?.display_name),
    username: asString(author?.username) ?? asString(author?.screen_name),
  };
}

function normalizeFx(payload: unknown, expectedId: string): PublicXPost {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const status =
    root.status && typeof root.status === "object"
      ? (root.status as Record<string, unknown>)
      : null;

  if (!status || !asString(status.id)) {
    throw new PublicXError(
      "That X post is unavailable or could not be resolved publicly.",
      "NOT_FOUND",
    );
  }

  const id = asString(status.id) ?? "";
  if (id !== expectedId) {
    throw new PublicXError(
      "The public X resolver returned a different post id.",
      "BAD_RESPONSE",
    );
  }

  const user = userFromFx(status);

  return {
    id,
    text: asString(status.text) ?? "",
    createdAt: createdAt(status.created_at),
    authorId: user.id,
    authorName: user.name,
    authorUsername: user.username,
    likes: asCount(status.likes),
    replies: asCount(status.replies),
    reposts: asCount(status.reposts),
    quotes: asCount(status.quotes),
    bookmarks: asCount(status.bookmarks),
    views: asNullableCount(status.views),
    provider: "fxtwitter",
  };
}

function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, "");
}

function normalizeSyndication(payload: unknown, expectedId: string): PublicXPost {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const id = asString(root.id_str) ?? asString(root.id);
  if (!id || id !== expectedId) {
    throw new PublicXError(
      "That X post is unavailable or could not be resolved publicly.",
      "NOT_FOUND",
    );
  }

  const user =
    root.user && typeof root.user === "object"
      ? (root.user as Record<string, unknown>)
      : {};

  return {
    id,
    text: asString(root.text) ?? "",
    createdAt: createdAt(root.created_at),
    authorId: asString(user.id_str) ?? asString(user.id),
    authorName: asString(user.name),
    authorUsername: asString(user.screen_name),
    likes: asCount(root.favorite_count),
    replies: asCount(root.conversation_count),
    reposts: asCount(root.retweet_count),
    quotes: asCount(root.quote_count),
    bookmarks: asCount(root.bookmark_count),
    views: asNullableCount(root.views),
    provider: "syndication",
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "XPulse/1.0 public-post-resolver",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new PublicXError(
      `Public X resolver returned HTTP ${response.status}.`,
      response.status === 404 ? "NOT_FOUND" : "UPSTREAM",
    );
  }

  try {
    return await response.json();
  } catch {
    throw new PublicXError(
      "Public X resolver returned invalid JSON.",
      "BAD_RESPONSE",
    );
  }
}

async function fetchFxTwitter(id: string): Promise<PublicXPost> {
  const payload = await fetchJson(
    `https://api.fxtwitter.com/2/status/${encodeURIComponent(id)}`,
  );
  return normalizeFx(payload, id);
}

async function fetchSyndication(id: string): Promise<PublicXPost> {
  const token = syndicationToken(id);
  const payload = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&lang=en`,
  );
  return normalizeSyndication(payload, id);
}

/**
 * Resolves public X post data without OAuth, an X API token, or an X login.
 * FxTwitter is the primary adapter; X's public syndication endpoint is the fallback.
 */
export async function resolvePublicXPost(input: string): Promise<PublicXPost> {
  const id = extractPublicXPostId(input);
  if (!id) {
    throw new PublicXError(
      "Paste a valid x.com or twitter.com status URL.",
      "INVALID_URL",
    );
  }

  let firstError: PublicXError | null = null;

  try {
    return await fetchFxTwitter(id);
  } catch (error) {
    firstError =
      error instanceof PublicXError
        ? error
        : new PublicXError("FxTwitter could not resolve the post.", "UPSTREAM");
  }

  try {
    return await fetchSyndication(id);
  } catch (error) {
    const fallback =
      error instanceof PublicXError
        ? error
        : new PublicXError("X public syndication could not resolve the post.", "UPSTREAM");

    if (firstError.code === "NOT_FOUND" && fallback.code === "NOT_FOUND") {
      throw new PublicXError(
        "That X post is unavailable, protected, or deleted.",
        "NOT_FOUND",
      );
    }

    throw new PublicXError(
      "The public X resolvers are temporarily unavailable. Try again shortly.",
      "UPSTREAM",
    );
  }
}
