/**
 * Free, public, no-key upstreams used to enrich analysis and rewrite.
 * Every call is best-effort: timeouts and failures return empty results
 * so the local viral engine always remains the source of truth.
 */

const TIMEOUT_MS = 6_000;

export type LanguageToolMatch = {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: string[];
  ruleId: string;
  category: string;
  context: string;
};

export type DatamuseWord = {
  word: string;
  score?: number;
  tags?: string[];
};

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LanguageTool public endpoint — grammar, style, redundancy.
 * https://api.languagetool.org/v2/check (free, rate-limited, no key)
 */
export async function checkLanguageTool(text: string, language = "en-US"): Promise<LanguageToolMatch[]> {
  const clean = text.trim();
  if (!clean || clean.length > 20_000) return [];

  try {
    const body = new URLSearchParams({
      language,
      text: clean.slice(0, 12_000),
      enabledOnly: "false",
    });
    const response = await fetchWithTimeout("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      matches?: Array<{
        message?: string;
        shortMessage?: string;
        offset?: number;
        length?: number;
        replacements?: Array<{ value?: string }>;
        rule?: { id?: string; category?: { name?: string; id?: string } };
        context?: { text?: string };
      }>;
    };
    return (payload.matches ?? []).slice(0, 24).map((match) => ({
      message: match.message ?? "Style suggestion",
      shortMessage: match.shortMessage ?? match.rule?.category?.name ?? "Style",
      offset: match.offset ?? 0,
      length: match.length ?? 0,
      replacements: (match.replacements ?? [])
        .map((item) => item.value)
        .filter((value): value is string => Boolean(value))
        .slice(0, 5),
      ruleId: match.rule?.id ?? "unknown",
      category: match.rule?.category?.name ?? match.rule?.category?.id ?? "General",
      context: match.context?.text ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Datamuse — synonyms / related words (no key).
 * https://api.datamuse.com/words
 */
export async function datamuseMeansLike(phrase: string, max = 8): Promise<DatamuseWord[]> {
  const q = phrase.trim();
  if (!q) return [];
  try {
    const url = `https://api.datamuse.com/words?ml=${encodeURIComponent(q)}&max=${max}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    const rows = (await response.json()) as DatamuseWord[];
    return Array.isArray(rows) ? rows.filter((row) => row.word) : [];
  } catch {
    return [];
  }
}

export async function datamuseSynonyms(word: string, max = 6): Promise<DatamuseWord[]> {
  const q = word.trim().toLowerCase();
  if (!q || q.length < 3) return [];
  try {
    const url = `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(q)}&max=${max}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];
    const rows = (await response.json()) as DatamuseWord[];
    return Array.isArray(rows) ? rows.filter((row) => row.word) : [];
  } catch {
    return [];
  }
}

/**
 * Free Dictionary API — senses for vague abstract nouns (no key).
 * https://dictionaryapi.dev
 */
export async function dictionarySenses(word: string): Promise<string[]> {
  const q = word.trim().toLowerCase();
  if (!q || q.length < 3) return [];
  try {
    const response = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`,
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as Array<{
      meanings?: Array<{ definitions?: Array<{ definition?: string }> }>;
    }>;
    if (!Array.isArray(payload)) return [];
    const senses: string[] = [];
    for (const entry of payload) {
      for (const meaning of entry.meanings ?? []) {
        for (const def of meaning.definitions ?? []) {
          if (def.definition) senses.push(def.definition);
          if (senses.length >= 3) return senses;
        }
      }
    }
    return senses;
  } catch {
    return [];
  }
}

/**
 * VxTwitter public status mirror — alternate public metrics when FxTwitter is thin.
 * https://api.vxtwitter.com/{user}/status/{id} also accepts bare id paths on some mirrors;
 * we use the documented status form with a placeholder user segment.
 */
export async function fetchVxTwitterStatus(id: string): Promise<{
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  views: number | null;
  date?: string;
  user_name?: string;
  user_screen_name?: string;
} | null> {
  const clean = id.trim();
  if (!/^\d{5,30}$/.test(clean)) return null;
  try {
    const response = await fetchWithTimeout(
      `https://api.vxtwitter.com/Twitter/status/${encodeURIComponent(clean)}`,
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    if (!payload || typeof payload !== "object") return null;
    return {
      text: typeof payload.text === "string" ? payload.text : "",
      likes: Number(payload.likes ?? payload.likeCount ?? 0) || 0,
      retweets: Number(payload.retweets ?? payload.retweetCount ?? 0) || 0,
      replies: Number(payload.replies ?? payload.replyCount ?? 0) || 0,
      quotes: Number(payload.quotes ?? payload.quoteCount ?? 0) || 0,
      bookmarks: Number(payload.bookmarks ?? payload.bookmarkCount ?? 0) || 0,
      views:
        payload.views == null || payload.views === "0"
          ? null
          : Number(payload.views) || null,
      date: typeof payload.date === "string" ? payload.date : undefined,
      user_name: typeof payload.user_name === "string" ? payload.user_name : undefined,
      user_screen_name:
        typeof payload.user_screen_name === "string" ? payload.user_screen_name : undefined,
    };
  } catch {
    return null;
  }
}

const VAGUE_WORDS = [
  "growth",
  "better",
  "success",
  "value",
  "impact",
  "leverage",
  "optimize",
  "awesome",
  "great",
  "thing",
  "stuff",
  "content",
  "engagement",
  "viral",
];

/**
 * Pull synonym candidates for vague tokens that hurt specificity/shareability.
 */
export async function expandVagueVocabulary(text: string): Promise<Record<string, string[]>> {
  const lower = text.toLowerCase();
  const found = VAGUE_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
  const unique = [...new Set(found)].slice(0, 5);
  const out: Record<string, string[]> = {};
  await Promise.all(
    unique.map(async (word) => {
      const [syn, ml] = await Promise.all([datamuseSynonyms(word, 5), datamuseMeansLike(word, 5)]);
      const pool = [...syn, ...ml]
        .map((row) => row.word)
        .filter((w) => w && w.toLowerCase() !== word && !w.includes(" "));
      out[word] = [...new Set(pool)].slice(0, 6);
    }),
  );
  return out;
}
