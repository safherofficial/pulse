/**
 * Editorial patterns from publicly available posts.
 * Never invent metrics. Never copy source text into generated content.
 * UI must not expose provider names.
 */

import type { TokenIntel } from "./token-intel";

export type XContentPattern = {
  /** Observed structural pattern — not a copied post. */
  pattern: string;
  /** Why it appears to work, based only on available public signals. */
  why: string;
  /** Engagement signals when present; null fields stay unavailable. */
  signals: {
    likes: number | null;
    replies: number | null;
    reposts: number | null;
    views: number | null;
  };
};

export type XContentIntel = {
  patterns: XContentPattern[];
  sampleCount: number;
  note: string;
  updatedAt: string;
};

function finite(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim()) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

function scoreEngagement(t: {
  likes?: number;
  replies?: number;
  retweets?: number;
  views?: number | string;
}): number {
  const likes = finite(t.likes) ?? 0;
  const replies = finite(t.replies) ?? 0;
  const reposts = finite(t.retweets) ?? 0;
  const views = finite(t.views) ?? 0;
  // Relative ranking only within this sample — not absolute "viral" claims
  return likes * 1 + replies * 3 + reposts * 2 + Math.min(views, 1_000_000) * 0.0001;
}

function detectPatterns(
  posts: Array<{
    text: string;
    likes: number | null;
    replies: number | null;
    reposts: number | null;
    views: number | null;
  }>,
): XContentPattern[] {
  const patterns: XContentPattern[] = [];
  if (!posts.length) return patterns;

  const withNumbers = posts.filter((p) => /\d/.test(p.text));
  if (withNumbers.length >= Math.ceil(posts.length * 0.4)) {
    const best = withNumbers.sort(
      (a, b) =>
        scoreEngagement({
          likes: a.likes ?? undefined,
          replies: a.replies ?? undefined,
          retweets: a.reposts ?? undefined,
          views: a.views ?? undefined,
        }) -
        scoreEngagement({
          likes: b.likes ?? undefined,
          replies: b.replies ?? undefined,
          retweets: b.reposts ?? undefined,
          views: b.views ?? undefined,
        }),
    )[withNumbers.length - 1];
    patterns.push({
      pattern: "Lead with a concrete number or measured change in the first line.",
      why: "Posts in this sample that open with quantifiable detail ranked higher on available engagement signals.",
      signals: {
        likes: best?.likes ?? null,
        replies: best?.replies ?? null,
        reposts: best?.reposts ?? null,
        views: best?.views ?? null,
      },
    });
  }

  const shortHooks = posts.filter((p) => {
    const first = p.text.split(/\n/)[0] ?? p.text;
    return first.length > 0 && first.length <= 120;
  });
  if (shortHooks.length >= 2) {
    patterns.push({
      pattern: "Keep the opening line short and specific — under ~120 characters.",
      why: "Shorter first lines appear frequently among higher-signal posts in the available sample.",
      signals: {
        likes: null,
        replies: null,
        reposts: null,
        views: null,
      },
    });
  }

  const contrast = posts.filter((p) =>
    /\b(while|but|however|despite|vs\.?|versus)\b/i.test(p.text),
  );
  if (contrast.length >= 1) {
    patterns.push({
      pattern: "Use a real contrast (price vs liquidity, short-term vs 24h) when the data supports it.",
      why: "Contrast framing showed up in posts that carried replies and reposts in this sample.",
      signals: {
        likes: null,
        replies: null,
        reposts: null,
        views: null,
      },
    });
  }

  const questions = posts.filter((p) => /\?/.test(p.text));
  if (questions.length >= 1) {
    patterns.push({
      pattern: "End with a genuine question only when it invites discussion of the data — not engagement bait.",
      why: "Question-shaped closes appeared in conversational posts; avoid empty CTAs.",
      signals: {
        likes: null,
        replies: null,
        reposts: null,
        views: null,
      },
    });
  }

  return patterns.slice(0, 6);
}

/**
 * Best-effort X content intel from the token's official public account when linked.
 * Does not scrape search; does not invent posts or metrics.
 */
export async function researchXContentIntel(
  intel: TokenIntel,
): Promise<XContentIntel> {
  const updatedAt = new Date().toISOString();
  const empty = (note: string): XContentIntel => ({
    patterns: [],
    sampleCount: 0,
    note,
    updatedAt,
  });

  const twitter = intel.identity.twitter;
  if (!twitter) {
    return empty(
      "No official X link on this token profile — content patterns limited to market data only.",
    );
  }

  const m = twitter.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  const handle = m?.[1];
  if (!handle || ["i", "intent", "share", "search"].includes(handle.toLowerCase())) {
    return empty("Official X link could not be resolved to a public profile.");
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(
      `https://api.fxtwitter.com/2/profile/${encodeURIComponent(handle)}/statuses?count=20`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      return empty("Public X sample temporarily unavailable for this profile.");
    }
    const data = (await res.json()) as {
      results?: Array<{
        text?: string;
        likes?: number;
        replies?: number;
        reposts?: number;
        views?: number | string;
      }>;
    };
    const tweets = data.results ?? [];
    const posts = tweets
      .filter((t) => t.text && t.text.trim().length > 0)
      .map((t) => ({
        text: t.text!.slice(0, 500),
        likes: finite(t.likes),
        replies: finite(t.replies),
        reposts: finite(t.reposts),
        views: finite(t.views),
      }));

    if (!posts.length) {
      return empty("No public posts available from the official account sample.");
    }

    // Rank by available engagement for pattern detection only
    posts.sort(
      (a, b) =>
        scoreEngagement({
          likes: b.likes ?? undefined,
          replies: b.replies ?? undefined,
          retweets: b.reposts ?? undefined,
          views: b.views ?? undefined,
        }) -
        scoreEngagement({
          likes: a.likes ?? undefined,
          replies: a.replies ?? undefined,
          retweets: a.reposts ?? undefined,
          views: a.views ?? undefined,
        }),
    );

    const patterns = detectPatterns(posts.slice(0, 12));
    return {
      patterns,
      sampleCount: posts.length,
      note:
        patterns.length > 0
          ? `Editorial patterns derived from ${posts.length} public posts on the official account. Source text is never copied into generated content.`
          : `Reviewed ${posts.length} public posts; no strong structural patterns detected beyond market facts.`,
      updatedAt,
    };
  } catch {
    return empty("Public X sample temporarily unavailable.");
  }
}
