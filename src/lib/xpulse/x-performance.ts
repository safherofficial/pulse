/**
 * Real X content-performance intelligence.
 *
 * This module learns only from posts already stored in xpulse_posts.
 * It never invents performance data and never asks an LLM to calculate metrics.
 * The resulting guidance is evidence for generation, not a deterministic rule.
 */

import { getSql } from "../db.ts";
import type { ContentKind } from "./content-score.ts";
import type { PostMetrics } from "./types.ts";

type StoredPost = {
  id: string;
  type: string;
  text: string;
  metrics: unknown;
  published_at: string;
};

export type ContentPerformanceGuidance = {
  sampleCount: number;
  measuredCount: number;
  windowDays: number;
  baseline: {
    medianEngagementRate: number | null;
    medianEngagementScore: number | null;
  };
  patterns: Array<{
    signal: string;
    observation: string;
    lift: number | null;
    sampleSize: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  }>;
  topPosts: Array<{
    id: string;
    type: string;
    engagementRate: number | null;
    engagementScore: number;
    hook: string;
    publishedAt: string;
  }>;
  note: string;
};

function asMetrics(value: unknown): PostMetrics {
  if (!value || typeof value !== "object") {
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
  const raw = value as Record<string, unknown>;
  const n = (key: keyof PostMetrics) => {
    const v = Number(raw[key] ?? 0);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  };
  return {
    impressions: n("impressions"),
    likes: n("likes"),
    replies: n("replies"),
    reposts: n("reposts"),
    bookmarks: n("bookmarks"),
    profileClicks: n("profileClicks"),
    linkClicks: n("linkClicks"),
    detailExpands: raw.detailExpands == null ? null : n("detailExpands"),
    dwellMs: raw.dwellMs == null ? null : n("dwellMs"),
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function engagementScore(metrics: PostMetrics): number {
  return metrics.likes + metrics.replies * 3 + metrics.reposts * 2 + metrics.bookmarks * 2;
}

function engagementRate(metrics: PostMetrics): number | null {
  if (metrics.impressions <= 0) return null;
  return engagementScore(metrics) / metrics.impressions;
}

function confidence(sampleSize: number): "LOW" | "MEDIUM" | "HIGH" {
  if (sampleSize >= 12) return "HIGH";
  if (sampleSize >= 6) return "MEDIUM";
  return "LOW";
}

function liftAgainst(group: number[], baseline: number | null): number | null {
  const groupMedian = median(group);
  if (groupMedian == null || baseline == null || baseline === 0) return null;
  return (groupMedian - baseline) / Math.abs(baseline);
}

function featureSignals(text: string): Record<string, boolean> {
  const clean = text.trim();
  const first = clean.split(/\n+/)[0]?.trim() ?? clean;
  const firstWords = first.split(/\s+/).filter(Boolean).length;
  const words = clean.split(/\s+/).filter(Boolean).length;
  const hashtags = (clean.match(/(^|\s)#\w+/g) ?? []).length;
  return {
    shortHook: first.length > 0 && first.length <= 90,
    numericHook: /\d/.test(first),
    questionClose: /\?\s*$/.test(clean),
    contrast: /\b(but|however|while|despite|vs\.?|versus)\b/i.test(clean),
    concise: words >= 20 && words <= 70,
    structured: /\n\s*\n/.test(clean),
    lowHashtags: hashtags <= 1,
  };
}

export function deriveContentPerformance(
  posts: Array<{
    id: string;
    type: string;
    text: string;
    metrics: PostMetrics;
    publishedAt: string;
  }>,
): ContentPerformanceGuidance {
  const usable = posts.filter((post) => post.text.trim());
  const rates = usable.map((post) => engagementRate(post.metrics)).filter((v): v is number => v != null);
  const scores = usable.map((post) => engagementScore(post.metrics));
  const baselineRate = median(rates);
  const baselineScore = median(scores);
  const patterns: ContentPerformanceGuidance["patterns"] = [];

  const addFeaturePattern = (
    signal: string,
    observation: string,
    predicate: (post: (typeof usable)[number]) => boolean,
  ) => {
    const group = usable.filter(predicate);
    if (group.length < 3) return;
    const groupRates = group.map((post) => engagementRate(post.metrics)).filter((v): v is number => v != null);
    const lift = liftAgainst(groupRates, baselineRate);
    if (lift != null && lift < 0.10) return;
    patterns.push({
      signal,
      observation,
      lift,
      sampleSize: group.length,
      confidence: confidence(group.length),
    });
  };

  addFeaturePattern(
    "short_hook",
    "Posts with a short first line have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).shortHook,
  );
  addFeaturePattern(
    "numeric_hook",
    "Posts whose opening line contains a concrete number have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).numericHook,
  );
  addFeaturePattern(
    "question_close",
    "Posts ending with a genuine question have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).questionClose,
  );
  addFeaturePattern(
    "contrast",
    "Posts using a real contrast or comparison have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).contrast,
  );
  addFeaturePattern(
    "concise",
    "Posts in a compact 20–70 word range have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).concise,
  );
  addFeaturePattern(
    "structured",
    "Posts with deliberate paragraph separation have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).structured,
  );
  addFeaturePattern(
    "low_hashtags",
    "Posts using zero or one hashtag have historically produced stronger normalized engagement in this account sample.",
    (post) => featureSignals(post.text).lowHashtags,
  );

  const ranked = [...usable]
    .sort((a, b) => engagementScore(b.metrics) - engagementScore(a.metrics))
    .slice(0, 5);

  const topPosts = ranked.map((post) => ({
    id: post.id,
    type: post.type,
    engagementRate: engagementRate(post.metrics),
    engagementScore: engagementScore(post.metrics),
    hook: post.text.split(/\n+/)[0]?.trim().slice(0, 180) ?? post.text.slice(0, 180),
    publishedAt: post.publishedAt,
  }));

  return {
    sampleCount: usable.length,
    measuredCount: rates.length,
    windowDays: usable.length
      ? Math.max(
          1,
          Math.round(
            (Date.now() - Math.min(...usable.map((post) => new Date(post.publishedAt).getTime()))) /
              86_400_000,
          ),
        )
      : 0,
    baseline: {
      medianEngagementRate: baselineRate,
      medianEngagementScore: baselineScore,
    },
    patterns: patterns
      .sort((a, b) => (b.lift ?? -Infinity) - (a.lift ?? -Infinity))
      .slice(0, 8),
    topPosts,
    note:
      usable.length >= 6
        ? "Guidance is derived from real stored X post metrics. It should influence structure and emphasis, not force every future post into one template."
        : "The account has too little stored performance history for reliable behavioral guidance.",
  };
}

export async function loadUserContentPerformance(
  userId: string,
  kind?: ContentKind,
): Promise<ContentPerformanceGuidance> {
  try {
    const sql = await getSql();
    const rows = await sql<StoredPost>`
      select id, type, text, metrics, published_at
      from xpulse_posts
      where user_id = ${userId}
        and published_at is not null
      order by published_at desc
      limit 150
    `;

    const posts = rows
      .map((row) => ({
        id: row.id,
        type: row.type,
        text: row.text,
        metrics: asMetrics(row.metrics),
        publishedAt: row.published_at,
      }))
      .filter((post) => {
        if (!kind) return true;
        if (kind === "thread") return post.type === "thread";
        if (kind === "article") return post.type === "article";
        return post.type === "tweet" || post.type === "post";
      });

    return deriveContentPerformance(posts);
  } catch {
    return {
      sampleCount: 0,
      measuredCount: 0,
      windowDays: 0,
      baseline: { medianEngagementRate: null, medianEngagementScore: null },
      patterns: [],
      topPosts: [],
      note: "Stored X performance data is temporarily unavailable.",
    };
  }
}

export function performancePromptContext(guidance: ContentPerformanceGuidance): string {
  if (!guidance.sampleCount) {
    return "REAL X PERFORMANCE DATA: unavailable. Do not invent account-specific performance conclusions.";
  }

  return [
    "REAL X PERFORMANCE DATA — account history, not a generic benchmark:",
    `Sample: ${guidance.sampleCount} stored posts; ${guidance.measuredCount} with impressions; window: ${guidance.windowDays} days.`,
    `Median engagement rate: ${guidance.baseline.medianEngagementRate == null ? "unavailable" : (guidance.baseline.medianEngagementRate * 100).toFixed(2) + "%"}.`,
    ...guidance.patterns.map(
      (pattern) =>
        `Observed pattern [${pattern.confidence}, n=${pattern.sampleSize}${pattern.lift == null ? "" : ", lift=" + (pattern.lift * 100).toFixed(1) + "%"}]: ${pattern.observation}`,
    ),
    "Use these observations to choose hooks, pacing, evidence density and closes. They are account-specific signals, not guarantees.",
  ].join("\n");
}
