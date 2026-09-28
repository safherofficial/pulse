/**
 * Content composition update. Call this only with a trend version that already
 * finished validation. Learned rules ship only when scoreContent improves.
 */

import { scoreContent } from "../content-score.ts";
import { EDITORIAL_ENGINE_VERSION } from "../editorial-standard.ts";
import { BENCHMARKS, preservesAuthorFacts } from "./benchmarks.ts";
import { nextVersionLabel } from "./baseline.ts";
import { measureRules } from "./compose.ts";
import { detectorById } from "./patterns.ts";
import type { ContentLogicVersion, ContentRule, ScoreBenchmark, ViralTrendVersion } from "./types.ts";

const MAX_REGRESSION = 0.34;

export type ContentUpdate = {
  version: ContentLogicVersion;
  changed: boolean;
  rejected: boolean;
  benchmark: ScoreBenchmark;
  /** Change in mean benchmark score versus the previous active rule set. */
  incrementalDelta: number;
  experiments: string[];
  newRules: string[];
  ruleChanges: string[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function benchmarkRules(rules: ContentRule[]): ScoreBenchmark {
  const active = rules.filter((rule) => rule.status === "ACTIVE" && rule.weight > 0);
  const cases = BENCHMARKS.map((bench) => {
    const before = scoreContent(bench.text, bench.kind).total;
    const measured = measureRules(bench.text, bench.kind, active);
    const preserved = preservesAuthorFacts(bench.text, measured.text);
    const after = scoreContent(measured.text, bench.kind).total;
    return {
      id: bench.id,
      before,
      after,
      delta: round2(after - before),
      preserved,
    };
  });
  const befores = cases.map((row) => row.before);
  const afters = cases.map((row) => row.after);
  return {
    meanScoreBefore: round2(mean(befores)),
    meanScoreAfter: round2(mean(afters)),
    medianScoreBefore: round2(median(befores)),
    medianScoreAfter: round2(median(afters)),
    scoreDelta: round2(mean(afters) - mean(befores)),
    highScoreRate: round2(cases.filter((row) => row.after >= 72).length / cases.length),
    regressionRate: round2(
      cases.filter((row) => !row.preserved || row.after < row.before).length / Math.max(cases.length, 1),
    ),
    cases,
  };
}

function signature(rules: ContentRule[]): string {
  return rules
    .map((rule) => `${rule.ruleId}:${rule.status}:${rule.weight}`)
    .sort()
    .join("|");
}

function learnedRule(patternId: string, now: string, versionNumber: number): ContentRule | null {
  const detector = detectorById(patternId);
  if (!detector) return null;
  return {
    ruleId: `rule:learned:${patternId}`,
    version: versionNumber,
    weight: 0,
    confidence: "LOW",
    status: "EXPERIMENTAL",
    lastUpdated: now,
    successRate: null,
    sampleCount: 0,
    scoreImpact: null,
    rollbackVersion: null,
    appliesTo: detector.appliesTo,
    lever: detector.lever,
    description: detector.leverDescription,
    patternId,
    learned: true,
  };
}

export function updateContentLogic(
  trend: ViralTrendVersion,
  previous: ContentLogicVersion,
  now: string,
): ContentUpdate {
  const rules = previous.rules.map((rule) => ({ ...rule }));
  const newRules: string[] = [];
  for (const pattern of trend.patterns) {
    if (rules.some((rule) => rule.patternId === pattern.patternId)) continue;
    const detector = detectorById(pattern.patternId);
    if (!detector) continue;
    if (rules.some((rule) => rule.lever === detector.lever)) continue;
    const created = learnedRule(pattern.patternId, now, previous.versionNumber);
    if (!created) continue;
    rules.push(created);
    newRules.push(created.ruleId);
  }

  for (const rule of rules) {
    const isolated: ContentRule = { ...rule, status: "ACTIVE", weight: 1 };
    const bench = benchmarkRules([isolated]);
    const preserved = bench.cases.every((row) => row.preserved);
    rule.scoreImpact = preserved ? bench.scoreDelta : null;
    rule.successRate = preserved
      ? round2(bench.cases.filter((row) => row.delta > 0).length / bench.cases.length)
      : null;
    rule.sampleCount = rule.learned
      ? (trend.patterns.find((pattern) => pattern.patternId === rule.patternId)?.sampleSize ?? rule.sampleCount)
      : bench.cases.length;
    rule.lastUpdated = now;
    const pattern = rule.patternId ? trend.patterns.find((item) => item.patternId === rule.patternId) : undefined;

    if (!preserved || (rule.scoreImpact != null && rule.scoreImpact < 0) || (rule.learned && bench.regressionRate > MAX_REGRESSION)) {
      rule.status = "ROLLED_BACK";
      rule.weight = 0;
      rule.rollbackVersion = previous.versionNumber;
      continue;
    }

    if (!rule.learned) continue;

    const eligible =
      pattern?.status === "ACTIVE" &&
      (pattern.confidence === "HIGH" || pattern.confidence === "VERY_HIGH") &&
      rule.scoreImpact != null &&
      rule.scoreImpact > 0 &&
      bench.regressionRate <= MAX_REGRESSION;
    if (eligible) {
      rule.status = "ACTIVE";
      rule.weight = 1;
      rule.confidence = pattern.confidence;
    } else if (pattern?.status === "DEPRECATED" || pattern?.status === "ROLLED_BACK") {
      if (!(rule.scoreImpact != null && rule.scoreImpact > 0 && rule.status === "ACTIVE")) {
        rule.status = "DEPRECATED";
        rule.weight = 0;
      }
    } else if (rule.status !== "ROLLED_BACK") {
      rule.status = "EXPERIMENTAL";
      rule.weight = 0;
      if (pattern) rule.confidence = pattern.confidence === "VERY_HIGH" ? "HIGH" : pattern.confidence;
    }
  }

  const previousBench = benchmarkRules(previous.rules);
  const nextBench = benchmarkRules(rules);
  const changed = signature(rules) !== signature(previous.rules);
  const regressed = changed && nextBench.meanScoreAfter + 0.001 < previousBench.meanScoreAfter;
  const incrementalDelta = round2(nextBench.meanScoreAfter - previousBench.meanScoreAfter);
  const experiments = rules
    .filter((rule) => rule.learned && (rule.status === "EXPERIMENTAL" || rule.status === "ROLLED_BACK"))
    .map((rule) => `${rule.ruleId}:${rule.status}`);
  const ruleChanges = rules
    .filter((rule) => {
      const prior = previous.rules.find((item) => item.ruleId === rule.ruleId);
      return !prior || prior.status !== rule.status || prior.weight !== rule.weight;
    })
    .map((rule) => {
      const prior = previous.rules.find((item) => item.ruleId === rule.ruleId);
      return prior ? `${rule.ruleId} ${prior.status} → ${rule.status}` : `${rule.ruleId} added as ${rule.status}`;
    });

  if (!changed || regressed) {
    return {
      version: previous,
      changed: false,
      rejected: regressed,
      benchmark: regressed ? nextBench : previousBench,
      incrementalDelta,
      experiments,
      newRules: regressed ? [] : newRules,
      ruleChanges: regressed ? ruleChanges : [],
    };
  }

  const label = nextVersionLabel(previous.version);
  return {
    version: {
      version: label.version,
      versionNumber: label.versionNumber,
      editorialEngineVersion: EDITORIAL_ENGINE_VERSION,
      rules,
      createdAt: now,
      basedOnTrendVersion: trend.version,
      changesFromPreviousVersion: ruleChanges,
      status: "active",
      benchmark: nextBench,
    },
    changed: true,
    rejected: false,
    benchmark: nextBench,
    incrementalDelta,
    experiments,
    newRules,
    ruleChanges,
  };
}
