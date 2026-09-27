/**
 * Public page read for the editor.
 * Failure returns no text. Nothing is invented to fill the gap.
 */

export type UrlKind = "x" | "website" | "article" | "token" | "invalid";

export type UrlExtraction = {
  url: string;
  kind: UrlKind;
  status: "extracted" | "unavailable" | "invalid";
  title: string | null;
  text: string | null;
  reason: string | null;
};

const CACHE = new Map<string, { at: number; value: UrlExtraction }>();
const TTL_MS = 10 * 60 * 1000;

export function classifyUrl(input: string): { url: string; kind: UrlKind } | null {
  const raw = input.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) {
    return { url: parsed.toString(), kind: "x" };
  }
  if (/\/tokens?\//i.test(parsed.pathname) || /dexscreener|birdeye|solscan/i.test(host)) {
    return { url: parsed.toString(), kind: "token" };
  }
  if (
    /medium\.com|substack\.com/i.test(host) ||
    /\/(?:article|articles|blog|news|story|stories)\//i.test(parsed.pathname)
  ) {
    return { url: parsed.toString(), kind: "article" };
  }
  return { url: parsed.toString(), kind: "website" };
}

export function readPublicHtml(html: string): { title: string | null; text: string | null } {
  const title =
    meta(html, "og:title") ||
    meta(html, "twitter:title") ||
    tagText(html, "title");
  const description = meta(html, "og:description") || meta(html, "description");
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1] ?? ""))
    .filter((line) => line.length > 40)
    .slice(0, 4);
  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => headlineFromJson(match[1] ?? ""))
    .filter((line): line is string => Boolean(line));
  const parts = [title, description, ...jsonLd, ...paragraphs].filter((part): part is string => Boolean(part));
  const text = parts.join("\n\n").replace(/\s+\n/g, "\n").trim();
  return {
    title: title || null,
    text: text ? text.slice(0, 4000) : null,
  };
}

export async function extractPublicPage(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UrlExtraction> {
  const classified = classifyUrl(input);
  if (!classified) {
    return { url: input.trim(), kind: "invalid", status: "invalid", title: null, text: null, reason: "Not a usable URL." };
  }
  const cached = CACHE.get(classified.url);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetchImpl(classified.url, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      return store(classified.url, empty(classified, "unavailable", `Source returned ${response.status}.`));
    }
    const html = await response.text();
    const read = readPublicHtml(html);
    if (!read.text) {
      return store(classified.url, empty(classified, "unavailable", "No public title or body was extracted. Paste the text."));
    }
    return store(classified.url, {
      url: classified.url,
      kind: classified.kind,
      status: "extracted",
      title: read.title,
      text: read.text,
      reason: null,
    });
  } catch {
    return store(classified.url, empty(classified, "unavailable", "The source timed out or blocked the read. Paste the text."));
  } finally {
    clearTimeout(timer);
  }
}

export function clearUrlCache(): void {
  CACHE.clear();
}

function store(url: string, value: UrlExtraction): UrlExtraction {
  CACHE.set(url, { at: Date.now(), value });
  return value;
}

function empty(
  classified: { url: string; kind: UrlKind },
  status: "unavailable" | "invalid",
  reason: string,
): UrlExtraction {
  return { url: classified.url, kind: classified.kind, status, title: null, text: null, reason };
}

function meta(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
    "i",
  );
  const match = html.match(pattern);
  return stripTags(match?.[1] || match?.[2] || "") || null;
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return stripTags(match?.[1] || "") || null;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineFromJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as
      | { headline?: string; description?: string }
      | Array<{ headline?: string; description?: string }>;
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    return data?.headline || data?.description || null;
  } catch {
    return null;
  }
}
