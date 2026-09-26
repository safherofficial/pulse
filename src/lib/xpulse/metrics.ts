import { formatCompact, formatPct } from "./format.ts";
import type {
  CompareGap,
  MetricDeficit,
  PostMetrics,
  PublicXPost,
  PublicXMetrics,
  PulseLink,
  PulsePost,
  WritingSignals,
} from "./types";


const SIGNAL_LABELS: Record<keyof WritingSignals, string> = {
  hook: "Hook",
  clarity: "Clarity",
  curiosity: "Curiosity",
  specificity: "Specificity",
  emotion: "Emotion",
  shareability: "Shareability",
  readability: "Readability",
  structure: "Structure",
};

const EMOTION_WORDS = /\b(love|hate|fear|shocking|surprising|secret|mistake|warning|truth|win|lose|risk|danger|easy|hard|never|always|finally|why|imagine)\b/gi;
const CURIOSITY_WORDS = /\b(why|how|what if|the reason|secret|nobody|most people|mistake|before|until|actually|truth)\b/gi;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string) {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
}

export function writingSignals(text: string): WritingSignals {
  const clean = text.trim();
  const list = words(clean);
  const first = sentences(clean)[0] ?? clean;
  const sentenceList = sentences(clean);
  const avgSentenceWords = sentenceList.length ? list.length / sentenceList.length : list.length;
  const numbers = (clean.match(/\b\d+(?:[.,]\d+)?(?:%|k|m|b)?\b/gi) ?? []).length;
  const concrete = (clean.match(/\b(\d+%?|\$\d+|€\d+|\d+\s?(?:days?|hours?|mins?|years?|steps?|ways?|times?))\b/gi) ?? []).length;
  const hashtags = (clean.match(/(^|\s)#\w+/g) ?? []).length;
  const punctuation = (clean.match(/[!?—:]/g) ?? []).length;
  const emotional = (clean.match(EMOTION_WORDS) ?? []).length;
  const curiosity = (clean.match(CURIOSITY_WORDS) ?? []).length;
  const firstWords = words(first).length;

  const hook = clampScore(
    42 +
      (firstWords >= 5 && firstWords <= 22 ? 22 : 8) +
      (/[!?]/.test(first) ? 12 : 0) +
      (/[—:]/.test(first) ? 7 : 0) +
      (numbers > 0 ? 8 : 0) +
      (curiosity > 0 ? 11 : 0),
  );
  const clarity = clampScore(
    92 - Math.max(0, avgSentenceWords - 16) * 3 - Math.max(0, hashtags - 2) * 4 - (list.length > 110 ? 10 : 0),
  );
  const specificity = clampScore(35 + Math.min(30, numbers * 10) + Math.min(25, concrete * 12) + (clean.includes("you") ? 5 : 0));
  const curiosityScore = clampScore(38 + Math.min(35, curiosity * 13) + (/[?]/.test(first) ? 18 : 0) + (firstWords <= 20 ? 8 : 0));
  const emotionScore = clampScore(32 + Math.min(48, emotional * 10) + Math.min(20, punctuation * 4));
  const readability = clampScore(100 - Math.max(0, avgSentenceWords - 12) * 4 - Math.max(0, list.length - 90) * 0.2);
  const structure = clampScore(40 + Math.min(24, sentenceList.length * 6) + (clean.includes("\n") ? 18 : 0) + (firstWords <= 22 ? 10 : 0));
  const shareability = clampScore(
    44 +
      (list.length >= 12 && list.length <= 70 ? 18 : 4) +
      (specificity > 65 ? 10 : 0) +
      (hook > 70 ? 12 : 0) +
      (emotionScore > 60 ? 8 : 0) +
      (hashtags <= 2 ? 6 : -8),
  );

  return { hook, clarity, curiosity: curiosityScore, specificity, emotion: emotionScore, shareability, readability, structure };
}

export function comparePublicPosts(viral: PublicXPost, target: PublicXPost): CompareGap[] {
  return (Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[])
    .map((signal) => {
      const viralScore = viral.signals[signal];
      const targetScore = target.signals[signal];
      const gap = viralScore - targetScore;
      return {
        signal,
        label: SIGNAL_LABELS[signal],
        viral: viralScore,
        target: targetScore,
        gap,
        advice: adviceFor(signal, gap),
      };
    })
    .filter((item) => item.gap >= 5)
    .sort((a, b) => b.gap - a.gap);
}

function adviceFor(signal: keyof WritingSignals, gap: number) {
  if (gap < 5) return "Already close to the reference pattern.";
  const advice: Record<keyof WritingSignals, string> = {
    hook: "The opening loses the race. Lead with a sharper claim, contrast, question, or concrete trigger.",
    clarity: "The point arrives late. Shorten sentences and cut the second idea.",
    curiosity: "Nothing pulls the reader forward. Open a gap the next line has to close.",
    specificity: "It stays abstract. Add a number, a named outcome, or a concrete example.",
    emotion: "The stakes feel flat. Name a human consequence instead of adding hype.",
    shareability: "Hard to repeat out of context. Make one line that can travel on its own.",
    readability: "Too dense to scan. Shorter sentences and a line break will help.",
    structure: "The order wanders. Aim for hook, then tension, then payoff.",
  };
  return advice[signal];
}

function rateOf(part: number | null, views: number | null): number | null {
  if (part == null || views == null || views <= 0) return null;
  return part / views;
}

export function compareMetricDeficits(viral: PublicXPost, target: PublicXPost): MetricDeficit[] {
  const viralViews = viral.metrics.views;
  const targetViews = target.metrics.views;
  const rows: {
    key: string;
    label: string;
    viral: number | null;
    target: number | null;
    unit: "rate" | "count";
    note: string;
    /** Target must fall below this fraction of the reference to count as a shortfall. */
    ceiling: number;
  }[] = [
    {
      key: "engagement",
      label: "Engagement rate",
      viral: publicMetricsEngagement(viral.metrics),
      target: publicMetricsEngagement(target.metrics),
      unit: "rate",
      ceiling: 0.85,
      note: "Fewer people interact with this post for each view it gets.",
    },
    {
      key: "likes",
      label: "Like rate",
      viral: rateOf(viral.metrics.likes, viralViews),
      target: rateOf(target.metrics.likes, targetViews),
      unit: "rate",
      ceiling: 0.85,
      note: "The reference earns more likes per view. The payoff is weaker here.",
    },
    {
      key: "reposts",
      label: "Repost rate",
      viral: rateOf(viral.metrics.reposts, viralViews),
      target: rateOf(target.metrics.reposts, targetViews),
      unit: "rate",
      ceiling: 0.85,
      note: "People are less willing to pass this on. Give them a line worth repeating.",
    },
    {
      key: "replies",
      label: "Reply rate",
      viral: rateOf(viral.metrics.replies, viralViews),
      target: rateOf(target.metrics.replies, targetViews),
      unit: "rate",
      ceiling: 0.85,
      note: "The reference starts more conversation. Leave a sharper opening for a reply.",
    },
    {
      key: "bookmarks",
      label: "Bookmark rate",
      viral: rateOf(viral.metrics.bookmarks, viralViews),
      target: rateOf(target.metrics.bookmarks, targetViews),
      unit: "rate",
      ceiling: 0.85,
      note: "Fewer people save this. Add something they would want to return to.",
    },
    {
      key: "views",
      label: "Reach",
      viral: viralViews,
      target: targetViews,
      unit: "count",
      ceiling: 0.5,
      note: "This post is reaching far fewer people than the reference.",
    },
  ];

  const deficits: MetricDeficit[] = [];
  for (const row of rows) {
    if (row.viral == null || row.target == null || row.viral <= 0) continue;
    const ratio = row.target / row.viral;
    if (ratio >= row.ceiling) continue;
    if (row.unit === "rate" && row.viral - row.target < 0.002) continue;
    deficits.push({
      key: row.key,
      label: row.label,
      viral: row.viral,
      target: row.target,
      viralDisplay: row.unit === "rate" ? formatPct(row.viral) : formatCompact(row.viral),
      targetDisplay: row.unit === "rate" ? formatPct(row.target) : formatCompact(row.target),
      note: row.note,
      shortfall: Math.max(0, Math.min(1, 1 - ratio)),
      unit: row.unit,
    });
  }
  return deficits.sort((a, b) => b.shortfall - a.shortfall);
}

export function publicMetricsEngagement(m: PublicXMetrics): number | null {
  if (!m.views || m.views <= 0) return null;
  const values = [m.likes, m.replies, m.reposts, m.quotes, m.bookmarks].filter((v): v is number => v != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / m.views : null;
}

export function emptyMetrics(): PostMetrics {
  return {
    impressions: 0,
    likes: 0,
    replies: 0,
    reposts: 0,
    bookmarks: 0,
    profileClicks: 0,
    linkClicks: 0,
    detailExpands: null,
    dwellMs: null,
  };
}

export function engagementRate(m: PostMetrics): number {
  if (m.impressions <= 0) return 0;
  const engaged =
    m.likes + m.replies + m.reposts + m.bookmarks + m.profileClicks + m.linkClicks;
  return engaged / m.impressions;
}

export function readRatio(m: PostMetrics): number | null {
  if (m.detailExpands == null || m.impressions <= 0) return null;
  return m.detailExpands / m.impressions;
}

function sumNullable(values: (number | null)[]): number | null {
  if (values.every((v) => v == null)) return null;
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function aggregate(posts: PulsePost[]): PostMetrics {
  const acc = emptyMetrics();
  acc.detailExpands = 0;
  if (posts.length === 0) return emptyMetrics();
  let dwellWeight = 0;
  let dwellSum = 0;
  let anyDwell = false;
  for (const post of posts) {
    const m = post.metrics;
    acc.impressions += m.impressions;
    acc.likes += m.likes;
    acc.replies += m.replies;
    acc.reposts += m.reposts;
    acc.bookmarks += m.bookmarks;
    acc.profileClicks += m.profileClicks;
    acc.linkClicks += m.linkClicks;
    if (m.dwellMs != null && m.impressions > 0) {
      dwellSum += m.dwellMs * m.impressions;
      dwellWeight += m.impressions;
      anyDwell = true;
    }
  }
  acc.detailExpands = sumNullable(posts.map((p) => p.metrics.detailExpands));
  acc.dwellMs = anyDwell && dwellWeight > 0 ? Math.round(dwellSum / dwellWeight) : null;
  return acc;
}

export function asMetrics(value: unknown): PostMetrics {
  const raw = typeof value === "string" ? safeJson(value) : value;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (key: string) => {
    const v = o[key];
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };
  const opt = (key: string): number | null => {
    if (!(key in o) || o[key] == null) return null;
    return num(key);
  };
  return {
    impressions: num("impressions"),
    likes: num("likes"),
    replies: num("replies"),
    reposts: num("reposts"),
    bookmarks: num("bookmarks"),
    profileClicks: num("profileClicks"),
    linkClicks: num("linkClicks"),
    detailExpands: opt("detailExpands"),
    dwellMs: opt("dwellMs"),
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Publish time × opens, normalized. Not a true follower clock. */
export function inferHeatmap(posts: Pick<PulsePost, "publishedAt" | "metrics">[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const post of posts) {
    const date = new Date(post.publishedAt);
    if (Number.isNaN(date.getTime())) continue;
    const dow = (date.getUTCDay() + 6) % 7;
    const hour = date.getUTCHours();
    const weight = Math.max(1, (post.metrics.detailExpands ?? 0) + post.metrics.profileClicks);
    const row = grid[dow];
    if (!row) continue;
    row[hour] = (row[hour] ?? 0) + weight;
  }
  let max = 0;
  for (const row of grid) for (const value of row) max = Math.max(max, value);
  if (max <= 0) return grid;
  return grid.map((row) => row.map((value) => value / max));
}

export function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0));
}

export function isPulseLink(value: PulseLink | undefined): value is PulseLink {
  return value === null || (!!value && "articleId" in value);
}
