/**
 * Shipped v1. This is the last-known-good craft baseline, not a learned model.
 * Later versions are created only when measured evidence changes a rule.
 */

import type { ContentLogicVersion, ContentRule, ViralTrendVersion } from "./types.ts";
import { EDITORIAL_ENGINE_VERSION } from "../editorial-standard.ts";

const EMPTY_WINDOW = {
  posts: 0,
  withCoreEngagement: 0,
  medianCoreEngagement: null,
  medianReplyDensity: null,
  medianViewEfficiency: null,
  medianEngagementPerHour: null,
};

export const BASELINE_SCORE_WEIGHTS: Record<string, number> = { hook: 1.25, clarity: 1.1, density: 1, curiosity: 1.05, emotion: 0.8, shareability: 1.1, structure: 1.1, readability: 0.9, thread_craft: 1.15, human: 1, anti_spam: 0.95 };

export const BASELINE_WEIGHTS: Record<string, number> = {
  core_engagement: 1,
  reply_density: 1,
  repost_signal: 1,
  view_efficiency: 1,
  engagement_per_hour: 1,
  persistence: 1,
  freshness: 1,
};

function craftRule(
  lever: string,
  description: string,
  appliesTo: ContentRule["appliesTo"],
): ContentRule {
  return {
    ruleId: `rule:baseline:${lever}`,
    version: 1,
    weight: 1,
    confidence: "HIGH",
    status: "ACTIVE",
    lastUpdated: "1970-01-01T00:00:00.000Z",
    successRate: null,
    sampleCount: 0,
    scoreImpact: null,
    rollbackVersion: null,
    appliesTo,
    lever,
    description,
    patternId: null,
    learned: false,
  };
}

export function baselineRules(now = "1970-01-01T00:00:00.000Z"): ContentRule[] {
  const rules = [
    craftRule("strip_ai_slack", "Remove known template phrases. Do not add claims.", ["post", "thread", "article"]),
    craftRule("drop_outline_labels", "Drop Hook:/Context: labels. Keep the author's sentence.", ["post", "thread", "article"]),
    craftRule("break_paragraphs", "Break a wall of text into sentences the author already wrote.", ["post", "article"]),
    craftRule("number_thread_beats", "Number existing thread beats. Do not add a new closer.", ["thread"]),
    craftRule("reframe_sparse_brief", "Turn a one-line content brief into a concise publishable form without adding factual claims.", ["post"]),
  ];
  return rules.map((rule) => ({ ...rule, lastUpdated: now }));
}

export function baselineTrend(now = "1970-01-01T00:00:00.000Z"): ViralTrendVersion {
  return {
    version: "v1",
    versionNumber: 1,
    weights: { ...BASELINE_WEIGHTS },
    patterns: [],
    confidence: "LOW",
    createdAt: now,
    sourceSignals: ["baseline:no-corpus"],
    changesFromPreviousVersion: [],
    status: "active",
    topicLabels: [],
    windows: { "1h": { ...EMPTY_WINDOW }, "6h": { ...EMPTY_WINDOW }, "24h": { ...EMPTY_WINDOW }, all: { ...EMPTY_WINDOW } },
    pace: "insufficient",
  };
}

export function baselineContent(now = "1970-01-01T00:00:00.000Z"): ContentLogicVersion {
  return {
    version: "v1",
    versionNumber: 1,
    editorialEngineVersion: EDITORIAL_ENGINE_VERSION,
    rules: baselineRules(now),
    createdAt: now,
    basedOnTrendVersion: "v1",
    changesFromPreviousVersion: [],
    status: "active",
    benchmark: null,
    scoreWeights: { ...BASELINE_SCORE_WEIGHTS },
    scoreTypeMultipliers: { post: 1, thread: 1.05, article: 0.95 },
  };
}

export function nextVersionLabel(current: string): { version: string; versionNumber: number } {
  const n = Number(current.replace(/^v/, ""));
  const versionNumber = Number.isFinite(n) && n >= 1 ? n + 1 : 2;
  return { version: `v${versionNumber}`, versionNumber };
}
