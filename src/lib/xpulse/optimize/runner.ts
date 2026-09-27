/**
 * One Rome-day optimization pass.
 * Order is fixed: viral trend, then content logic, then score feedback.
 * A second call for the same completed day does not mint another version.
 */

import { updateContentLogic } from "./content-logic.ts";
import { isDue, romeDayKey, type ClockTime } from "./schedule.ts";
import { analyzeTrends } from "./trend-engine.ts";
import type {
  ContentLogicVersion,
  DailyReport,
  ObservationCorpus,
  OptimizationLogEvent,
  PlannedOptimization,
  RunStatus,
  ViralTrendVersion,
} from "./types.ts";

export type ExistingRun = {
  optimizationRunId: string;
  status: RunStatus;
  trendVersion: string;
  contentLogicVersion: string;
  dayKey: string;
};

function event(
  optimizationRunId: string,
  at: string,
  name: OptimizationLogEvent["event"],
  detail?: OptimizationLogEvent["detail"],
): OptimizationLogEvent {
  return { event: name, optimizationRunId, at, detail };
}

function emptyReport(partial: Omit<DailyReport, "title">): DailyReport {
  return { title: "DAILY OPTIMIZATION REPORT", ...partial };
}

export function planDailyOptimization(input: {
  now: Date;
  time: ClockTime;
  corpus: ObservationCorpus;
  trend: ViralTrendVersion;
  content: ContentLogicVersion;
  existing: ExistingRun | null;
  previousTopicLabels: string[];
  force?: boolean;
}): PlannedOptimization {
  const startedAt = input.now.toISOString();
  const dayKey = romeDayKey(input.now);
  const runId = `opt-${dayKey}`;
  const logs: OptimizationLogEvent[] = [event(runId, startedAt, "optimization_started")];
  const base = {
    optimizationRunId: runId,
    startedAt,
    completedAt: startedAt,
    dayKey,
    previousVersion: { trend: input.trend.version, content: input.content.version },
    metrics: input.content.benchmark,
    nextTrend: null,
    nextContent: null,
    errors: [] as string[],
  };

  const finished = input.existing && ["completed", "kept_stable", "rolled_back"].includes(input.existing.status);
  if (finished && input.existing) {
    logs.push(event(runId, startedAt, "optimization_skipped", { reason: "same_day" }));
    return {
      ...base,
      status: "skipped_duplicate",
      newVersion: { trend: null, content: null },
      trendVersion: input.existing.trendVersion,
      contentLogicVersion: input.existing.contentLogicVersion,
      rollbackAvailable: false,
      duplicateOf: input.existing.optimizationRunId,
      logs,
      report: emptyReport({
        date: dayKey,
        runId,
        previousViralVersion: input.trend.version,
        newViralVersion: null,
        previousContentVersion: input.content.version,
        newContentVersion: null,
        newPatterns: [],
        strengthenedPatterns: [],
        weakenedPatterns: [],
        removedPatterns: [],
        stablePatterns: [],
        experimentalPatterns: [],
        newRules: [],
        ruleChanges: [],
        experiments: [],
        scoreImpact: nullScores(),
        rollback: "Duplicate run ignored. Active versions were not rewritten.",
        notes: ["Same Rome day already has a finished optimization."],
        windows: null,
        ordering: [],
        topics: topicDiff(input.previousTopicLabels, input.corpus.topics.map((topic) => topic.label)),
      }),
    };
  }

  if (!input.force && !isDue(input.now, input.time, null)) {
    logs.push(event(runId, startedAt, "optimization_skipped", { reason: "not_due" }));
    return {
      ...base,
      status: "not_due",
      newVersion: { trend: null, content: null },
      trendVersion: input.trend.version,
      contentLogicVersion: input.content.version,
      rollbackAvailable: false,
      logs,
      report: emptyReport({
        date: dayKey,
        runId,
        previousViralVersion: input.trend.version,
        newViralVersion: null,
        previousContentVersion: input.content.version,
        newContentVersion: null,
        newPatterns: [],
        strengthenedPatterns: [],
        weakenedPatterns: [],
        removedPatterns: [],
        stablePatterns: [],
        experimentalPatterns: [],
        newRules: [],
        ruleChanges: [],
        experiments: [],
        scoreImpact: nullScores(),
        rollback: "Not due. Last stable versions stay active.",
        notes: ["Europe/Rome clock has not reached DAILY_OPTIMIZATION_TIME."],
        windows: null,
        ordering: [],
        topics: { added: [], removed: [], unchanged: [] },
      }),
    };
  }

  const ordering: DailyReport["ordering"] = [];
  try {
    ordering.push("viral_trend");
    const trendResult = analyzeTrends(input.corpus, input.trend, startedAt);
    logs.push(
      event(runId, startedAt, "data_analyzed", {
        posts: input.corpus.posts.length,
        topics: input.corpus.topics.length,
      }),
    );
    logs.push(event(runId, startedAt, "patterns_discovered", { count: trendResult.version.patterns.length }));
    if (trendResult.validError) {
      return fail(base, logs, ordering, input, [trendResult.validError], startedAt, dayKey);
    }
    ordering.push("content_logic");
    const contentResult = updateContentLogic(trendResult.version, input.content, startedAt);
    ordering.push("score_feedback");
    logs.push(event(runId, startedAt, "rules_changed", { count: contentResult.ruleChanges.length }));
    if (contentResult.experiments.length) {
      logs.push(event(runId, startedAt, "experiments_created", { count: contentResult.experiments.length }));
    }

    const activateTrend = trendResult.changed;
    const activateContent = contentResult.changed && !contentResult.rejected;
    if (contentResult.rejected) logs.push(event(runId, startedAt, "rollback_performed", { reason: "score_regression" }));
    if (activateTrend) logs.push(event(runId, startedAt, "viral_version_created", { version: trendResult.version.version }));
    if (activateContent) logs.push(event(runId, startedAt, "content_version_created", { version: contentResult.version.version }));
    logs.push(event(runId, startedAt, "validation_completed", { rejected: contentResult.rejected }));

    const status: RunStatus = contentResult.rejected ? "rolled_back" : activateTrend || activateContent ? "completed" : "kept_stable";
    const trendVersion = activateTrend ? trendResult.version.version : input.trend.version;
    const contentVersion = activateContent ? contentResult.version.version : input.content.version;
    const topics = topicDiff(input.previousTopicLabels, input.corpus.topics.map((topic) => topic.label));
    return {
      ...base,
      status,
      completedAt: startedAt,
      newVersion: {
        trend: activateTrend ? trendResult.version.version : null,
        content: activateContent ? contentResult.version.version : null,
      },
      trendVersion,
      contentLogicVersion: contentVersion,
      metrics: contentResult.benchmark,
      rollbackAvailable: status === "rolled_back" || activateTrend || activateContent,
      nextTrend: activateTrend ? trendResult.version : null,
      nextContent: activateContent ? contentResult.version : null,
      logs,
      errors: contentResult.rejected ? ["Candidate content rules lowered the benchmark mean. Previous rules stay active."] : [],
      report: emptyReport({
        date: dayKey,
        runId,
        previousViralVersion: input.trend.version,
        newViralVersion: activateTrend ? trendResult.version.version : null,
        previousContentVersion: input.content.version,
        newContentVersion: activateContent ? contentResult.version.version : null,
        newPatterns: trendResult.differential.newPatterns,
        strengthenedPatterns: trendResult.differential.strengthenedPatterns,
        weakenedPatterns: trendResult.differential.weakenedPatterns,
        removedPatterns: trendResult.differential.removedPatterns,
        stablePatterns: trendResult.differential.stablePatterns,
        experimentalPatterns: trendResult.differential.experimentalPatterns,
        newRules: activateContent ? contentResult.newRules : [],
        ruleChanges: activateContent ? contentResult.ruleChanges : contentResult.rejected ? contentResult.ruleChanges : [],
        experiments: contentResult.experiments,
        scoreImpact: {
          meanScoreBefore: contentResult.benchmark.meanScoreBefore,
          meanScoreAfter: contentResult.benchmark.meanScoreAfter,
          medianScoreBefore: contentResult.benchmark.medianScoreBefore,
          medianScoreAfter: contentResult.benchmark.medianScoreAfter,
          scoreDelta: contentResult.incrementalDelta,
          highScoreRate: contentResult.benchmark.highScoreRate,
          regressionRate: contentResult.benchmark.regressionRate,
        },
        rollback: contentResult.rejected
          ? "Score regression. Active content logic was not replaced."
          : activateTrend || activateContent
            ? `Previous versions ${input.trend.version} / ${input.content.version} remain stored for rollback.`
            : "No rule change cleared the evidence gates. Active versions stay in place.",
        notes: [
          ...input.corpus.notes,
          `Pace: ${trendResult.version.pace}.`,
          "Topic labels are context only. They do not change market facts or force a bullish read.",
        ],
        windows: trendResult.version.windows,
        ordering,
        topics,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "optimization failed";
    return fail(base, logs, ordering, input, [message], startedAt, dayKey);
  }
}

function nullScores(): DailyReport["scoreImpact"] {
  return {
    meanScoreBefore: null,
    meanScoreAfter: null,
    medianScoreBefore: null,
    medianScoreAfter: null,
    scoreDelta: null,
    highScoreRate: null,
    regressionRate: null,
  };
}

function topicDiff(previous: string[], next: string[]) {
  const prior = new Set(previous);
  const current = new Set(next);
  return {
    added: next.filter((label) => !prior.has(label)),
    removed: previous.filter((label) => !current.has(label)),
    unchanged: next.filter((label) => prior.has(label)),
  };
}

function fail(
  base: Omit<PlannedOptimization, "status" | "newVersion" | "trendVersion" | "contentLogicVersion" | "rollbackAvailable" | "logs" | "report" | "errors">,
  logs: OptimizationLogEvent[],
  ordering: DailyReport["ordering"],
  input: { trend: ViralTrendVersion; content: ContentLogicVersion; corpus: ObservationCorpus; previousTopicLabels: string[] },
  errors: string[],
  startedAt: string,
  dayKey: string,
): PlannedOptimization {
  logs.push(event(base.optimizationRunId, startedAt, "optimization_failed", { message: errors[0] ?? "failed" }));
  return {
    ...base,
    status: "failed",
    newVersion: { trend: null, content: null },
    trendVersion: input.trend.version,
    contentLogicVersion: input.content.version,
    rollbackAvailable: false,
    errors,
    logs,
    nextTrend: null,
    nextContent: null,
    report: emptyReport({
      date: dayKey,
      runId: base.optimizationRunId,
      previousViralVersion: input.trend.version,
      newViralVersion: null,
      previousContentVersion: input.content.version,
      newContentVersion: null,
      newPatterns: [],
      strengthenedPatterns: [],
      weakenedPatterns: [],
      removedPatterns: [],
      stablePatterns: [],
      experimentalPatterns: [],
      newRules: [],
      ruleChanges: [],
      experiments: [],
      scoreImpact: nullScores(),
      rollback: "Run failed. Last stable viral and content versions stay active.",
      notes: errors,
      windows: null,
      ordering,
      topics: topicDiff(input.previousTopicLabels, input.corpus.topics.map((topic) => topic.label)),
    }),
  };
}
