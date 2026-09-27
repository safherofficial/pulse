/**
 * Viral trend pass. Runs before any content-rule change.
 * Engagement lift is omitted when likes, replies, and reposts are not all present.
 * A single post cannot promote a pattern.
 */

import { nextVersionLabel } from "./baseline.ts";
import { PATTERN_DETECTORS } from "./patterns.ts";
import type {
  Confidence,
  ObservationCorpus,
  ObservedPost,
  PatternDirection,
  ViralPattern,
  ViralTrendVersion,
  WindowStats,
} from "./types.ts";

const MIN_RECORD = 3;
const MIN_SIDE = 5;
const LIFT_MIN = 0.15;
const MIN_HIGH = 20;
const MIN_VERY_HIGH = 40;

export type TrendAnalysis = {
  version: ViralTrendVersion;
  changed: boolean;
  validError: string | null;
  differential: {
    newPatterns: string[];
    strengthenedPatterns: string[];
    weakenedPatterns: string[];
    removedPatterns: string[];
    stablePatterns: string[];
    experimentalPatterns: string[];
  };
};

function coreEngagement(post: ObservedPost): number | null {
  if (post.likes == null || post.replies == null || post.reposts == null) return null;
  return post.likes + post.replies * 1.5 + post.reposts * 2;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function inRange(post: ObservedPost, start: number, end: number): boolean {
  const time = Date.parse(post.publishedAt);
  if (!Number.isFinite(time)) return false;
  return time >= start && time < end;
}

function windowPosts(posts: ObservedPost[], asOf: number, hours: number | null): ObservedPost[] {
  if (hours == null) return posts.filter((post) => Number.isFinite(Date.parse(post.publishedAt)));
  return posts.filter((post) => inRange(post, asOf - hours * 3_600_000, asOf + 1));
}

function statsFor(posts: ObservedPost[], asOf: number): WindowStats {
  const core: number[] = [];
  const reply: number[] = [];
  const view: number[] = [];
  const pace: number[] = [];
  for (const post of posts) {
    const engagement = coreEngagement(post);
    if (engagement == null) continue;
    core.push(engagement);
    const flow = (post.likes ?? 0) + (post.replies ?? 0) + (post.reposts ?? 0);
    if (flow > 0 && post.replies != null) reply.push(post.replies / flow);
    if (post.impressions != null && post.impressions > 0) view.push(engagement / post.impressions);
    const published = Date.parse(post.publishedAt);
    if (Number.isFinite(published)) {
      const hours = Math.max(0.25, (asOf - published) / 3_600_000);
      pace.push(engagement / hours);
    }
  }
  return {
    posts: posts.length,
    withCoreEngagement: core.length,
    medianCoreEngagement: median(core),
    medianReplyDensity: median(reply),
    medianViewEfficiency: median(view),
    medianEngagementPerHour: median(pace),
  };
}

function lift(match: number[], rest: number[]): { value: number | null; overfit: boolean } {
  if (match.length < MIN_SIDE || rest.length < MIN_SIDE) return { value: null, overfit: false };
  const raw = relative(median(match), median(rest));
  if (match.length < MIN_SIDE + 1) return { value: raw, overfit: false };
  const trimmed = [...match].sort((a, b) => a - b).slice(0, -1);
  const without = relative(median(trimmed), median(rest));
  const overfit = raw != null && raw >= LIFT_MIN && (without == null || without < LIFT_MIN);
  return { value: without ?? raw, overfit };
}

function relative(match: number | null, rest: number | null): number | null {
  if (match == null || rest == null) return null;
  return (match - rest) / Math.max(Math.abs(rest), 1);
}

function engagements(posts: ObservedPost[]): number[] {
  return posts.map(coreEngagement).filter((value): value is number => value != null);
}

function directionFor(current: number, previous: number, unstable: boolean): PatternDirection {
  if (unstable) return "unstable";
  if (current < MIN_RECORD && previous < MIN_RECORD) return "insufficient";
  if (current >= previous * 1.25 && current > previous) return "up";
  if (previous >= MIN_RECORD && current <= previous * 0.75 && current < previous) return "down";
  if (current < MIN_RECORD) return "insufficient";
  return "flat";
}

function confidenceFor(sample: number, promotable: boolean): Confidence {
  if (!promotable) return sample >= 8 ? "MEDIUM" : "LOW";
  if (sample >= MIN_VERY_HIGH) return "VERY_HIGH";
  if (sample >= MIN_HIGH) return "HIGH";
  return "MEDIUM";
}

function signature(version: ViralTrendVersion): string {
  const patterns = version.patterns
    .map((pattern) => `${pattern.patternId}:${pattern.status}:${pattern.confidence}:${pattern.trendDirection}`)
    .sort()
    .join(",");
  const weights = Object.entries(version.weights)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value.toFixed(2)}`)
    .join(",");
  return `${patterns}|${weights}|${version.pace}`;
}

function validate(version: ViralTrendVersion): string | null {
  if (!/^v\d+$/.test(version.version)) return "Trend version label is invalid.";
  for (const [key, weight] of Object.entries(version.weights)) {
    if (!Number.isFinite(weight) || weight < 0.25 || weight > 2) return `Weight ${key} is outside 0.25–2.`;
  }
  for (const pattern of version.patterns) {
    if (pattern.sampleSize < MIN_RECORD) return `Pattern ${pattern.patternId} is below the record minimum.`;
    if (pattern.status !== "ACTIVE") continue;
    if (pattern.sampleSize < MIN_HIGH) return `Pattern ${pattern.patternId} is active without enough samples.`;
    if (pattern.engagementLift == null || pattern.engagementLift < LIFT_MIN) {
      return `Pattern ${pattern.patternId} is active without measured lift.`;
    }
    if (pattern.confidence !== "HIGH" && pattern.confidence !== "VERY_HIGH") {
      return `Pattern ${pattern.patternId} is active at ${pattern.confidence} confidence.`;
    }
    if (pattern.riskOfOverfitting === "high") return `Pattern ${pattern.patternId} is overfit.`;
  }
  return null;
}

export function analyzeTrends(
  corpus: ObservationCorpus,
  previous: ViralTrendVersion,
  nowIso: string,
): TrendAnalysis {
  const asOf = Date.parse(corpus.asOf);
  if (!Number.isFinite(asOf)) throw new Error("corpus.asOf is not a valid timestamp");

  const posts = corpus.posts.filter((post) => typeof post.text === "string" && post.text.trim());
  const hour = windowPosts(posts, asOf, 1);
  const six = windowPosts(posts, asOf, 6);
  const day = windowPosts(posts, asOf, 24);
  const all = windowPosts(posts, asOf, null);
  const previousDay = posts.filter((post) => inRange(post, asOf - 48 * 3_600_000, asOf - 24 * 3_600_000));
  const windows = {
    "1h": statsFor(hour, asOf),
    "6h": statsFor(six, asOf),
    "24h": statsFor(day, asOf),
    all: statsFor(all, asOf),
  };

  const currentPace = windows["24h"].medianEngagementPerHour;
  const priorPace = statsFor(previousDay, asOf).medianEngagementPerHour;
  const pace =
    currentPace == null || priorPace == null || windows["24h"].withCoreEngagement < MIN_SIDE
      ? "insufficient"
      : currentPace > priorPace * 1.15
        ? "acceleration"
        : currentPace < priorPace * 0.85
          ? "deceleration"
          : "stable";

  const patterns: ViralPattern[] = [];
  for (const detector of PATTERN_DETECTORS) {
    const matchesAll = all.filter((post) => detector.test(post));
    if (matchesAll.length < MIN_RECORD) continue;
    const restAll = all.filter((post) => !detector.test(post));
    const dayMatches = day.filter((post) => detector.test(post));
    const dayRest = day.filter((post) => !detector.test(post));
    const previousMatches = previousDay.filter((post) => detector.test(post));
    const measured = lift(engagements(dayMatches), engagements(dayRest));
    const historical = lift(engagements(matchesAll), engagements(restAll));
    const stableLift =
      measured.value != null &&
      historical.value != null &&
      measured.value >= LIFT_MIN &&
      historical.value >= LIFT_MIN &&
      !measured.overfit;
    const sample = Math.min(dayMatches.length, matchesAll.length);
    const promotable = stableLift && sample >= MIN_HIGH && measured.value != null;
    const status = promotable ? "ACTIVE" : "EXPERIMENTAL";
    const unstable = measured.value != null && historical.value != null && measured.value > 0 && historical.value < 0;
    patterns.push({
      patternId: detector.patternId,
      name: detector.name,
      description: detector.description,
      confidence: confidenceFor(sample, promotable),
      sampleSize: matchesAll.length,
      observedAt: nowIso,
      trendDirection: directionFor(dayMatches.length, previousMatches.length, unstable),
      supportingSignals: supporting(windows["24h"]),
      riskOfOverfitting: measured.overfit ? "high" : sample < MIN_HIGH ? "high" : "low",
      recommendedUsage: promotable
        ? "Repeated lift cleared the sample gate. Composition may use it only if the score loop agrees."
        : "Observed only. Not applied to generation.",
      status,
      engagementLift: measured.value,
      format: detector.format,
    });
  }

  const previousById = new Map(previous.patterns.map((pattern) => [pattern.patternId, pattern]));
  for (const prior of previous.patterns) {
    if (prior.status === "ACTIVE" && !patterns.some((pattern) => pattern.patternId === prior.patternId && pattern.status === "ACTIVE")) {
      const current = patterns.find((pattern) => pattern.patternId === prior.patternId);
      if (current) current.status = "DEPRECATED";
      else {
        patterns.push({ ...prior, status: "DEPRECATED", trendDirection: "down", observedAt: nowIso });
      }
    }
  }

  const weights = { ...previous.weights };
  for (const pattern of patterns) {
    const prior = previousById.get(pattern.patternId);
    if (pattern.status === "ACTIVE" && prior?.status !== "ACTIVE" && pattern.engagementLift != null) {
      const base = weights[pattern.patternId] ?? 1;
      const next = Math.max(0.25, Math.min(2, base * (1 + Math.min(0.25, pattern.engagementLift))));
      weights[pattern.patternId] = Math.round(next * 100) / 100;
    }
    if (pattern.status !== "ACTIVE" && prior?.status === "ACTIVE" && pattern.patternId in weights) {
      weights[pattern.patternId] = 1;
    }
  }

  const changedShape = signature({ ...previous, patterns, weights, pace }) !== signature(previous);
  const label = changedShape ? nextVersionLabel(previous.version) : { version: previous.version, versionNumber: previous.versionNumber };
  const version: ViralTrendVersion = {
    version: label.version,
    versionNumber: label.versionNumber,
    weights,
    patterns,
    confidence: patterns.some((pattern) => pattern.status === "ACTIVE")
      ? patterns.some((pattern) => pattern.status === "ACTIVE" && pattern.confidence === "VERY_HIGH")
        ? "VERY_HIGH"
        : "HIGH"
      : "LOW",
    createdAt: changedShape ? nowIso : previous.createdAt,
    sourceSignals: [
      `posts:${posts.length}`,
      `core:${windows.all.withCoreEngagement}`,
      `topics:${corpus.topics.length}`,
      ...corpus.notes,
    ],
    changesFromPreviousVersion: describeChanges(previous, patterns, weights, pace),
    status: "active",
    topicLabels: corpus.topics.map((topic) => topic.label),
    windows,
    pace,
  };
  if (!changedShape) version.changesFromPreviousVersion = [];

  const differential = diffPatterns(previous.patterns, patterns);
  return { version, changed: changedShape, validError: validate(version), differential };
}

function supporting(stats: WindowStats): string[] {
  const signals: string[] = [];
  if (stats.medianCoreEngagement != null) signals.push("core_engagement");
  if (stats.medianReplyDensity != null) signals.push("reply_density");
  if (stats.medianViewEfficiency != null) signals.push("view_efficiency");
  if (stats.medianEngagementPerHour != null) signals.push("engagement_per_hour");
  return signals;
}

function describeChanges(
  previous: ViralTrendVersion,
  patterns: ViralPattern[],
  weights: Record<string, number>,
  pace: ViralTrendVersion["pace"],
): string[] {
  const lines: string[] = [];
  const prior = new Map(previous.patterns.map((pattern) => [pattern.patternId, pattern]));
  for (const pattern of patterns) {
    const old = prior.get(pattern.patternId);
    if (!old) lines.push(`New pattern ${pattern.patternId} (${pattern.status}, n=${pattern.sampleSize}).`);
    else if (old.status !== pattern.status) lines.push(`${pattern.patternId} ${old.status} → ${pattern.status}.`);
  }
  for (const [key, weight] of Object.entries(weights)) {
    const old = previous.weights[key] ?? 1;
    if (Math.abs(old - weight) >= 0.01) lines.push(`Weight ${key} ${old.toFixed(2)} → ${weight.toFixed(2)}.`);
  }
  if (pace !== previous.pace) lines.push(`Pace ${previous.pace} → ${pace}.`);
  return lines;
}

function diffPatterns(previous: ViralPattern[], next: ViralPattern[]) {
  const prior = new Map(previous.map((pattern) => [pattern.patternId, pattern]));
  const newPatterns = next.filter((pattern) => !prior.has(pattern.patternId)).map((pattern) => pattern.patternId);
  const strengthened = next
    .filter((pattern) => {
      const old = prior.get(pattern.patternId);
      return old && ((old.engagementLift ?? -1) < (pattern.engagementLift ?? -1) || (old.status !== "ACTIVE" && pattern.status === "ACTIVE"));
    })
    .map((pattern) => pattern.patternId);
  const weakened = next
    .filter((pattern) => {
      const old = prior.get(pattern.patternId);
      return old && (pattern.status === "DEPRECATED" || (old.engagementLift ?? 0) > (pattern.engagementLift ?? 0) + 0.05);
    })
    .map((pattern) => pattern.patternId);
  const removed = previous.filter((pattern) => !next.some((item) => item.patternId === pattern.patternId)).map((pattern) => pattern.patternId);
  const experimental = next.filter((pattern) => pattern.status === "EXPERIMENTAL").map((pattern) => pattern.patternId);
  const stable = next
    .filter((pattern) => prior.get(pattern.patternId)?.status === pattern.status && !newPatterns.includes(pattern.patternId))
    .map((pattern) => pattern.patternId);
  return { newPatterns, strengthenedPatterns: strengthened, weakenedPatterns: weakened, removedPatterns: removed, stablePatterns: stable, experimentalPatterns: experimental };
}
