import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreContent } from "../content-score.ts";
import { baselineContent, baselineTrend } from "./baseline.ts";
import { BENCHMARKS } from "./benchmarks.ts";
import { isAlreadyStrong, optimizeContent } from "./compose.ts";
import { planDailyOptimization, type ExistingRun } from "./runner.ts";
import { formatRomeHm, isDue, isWeeklyEditorialUpgradeDue, nextRunAt, parseDailyTime, romeDayKey, romeWeekKey, romeWallTimeToUtc } from "./schedule.ts";
import { analyzeTrends } from "./trend-engine.ts";
import type { ContentLogicVersion, ObservedPost, ViralPattern, ViralTrendVersion } from "./types.ts";

const AS_OF = "2026-09-28T12:00:00.000Z";
const asOf = Date.parse(AS_OF);
const TIME = parseDailyTime("06:15");

function at(hoursAgo: number): string {
  return new Date(asOf - hoursAgo * 3_600_000).toISOString();
}

function post(id: string, text: string, hoursAgo: number, likes: number, replies: number, reposts: number): ObservedPost {
  return {
    id,
    text,
    kind: "post",
    publishedAt: at(hoursAgo),
    impressions: 2000,
    likes,
    replies,
    reposts,
    quotes: null,
    bookmarks: null,
  };
}

function repeat(
  label: string,
  text: string,
  count: number,
  hoursAgo: number,
  likes: number,
  replies: number,
  reposts: number,
): ObservedPost[] {
  return Array.from({ length: count }, (_, index) =>
    post(`${label}-${hoursAgo}-${index}`, text, hoursAgo, likes, replies, reposts),
  );
}

function planWith(
  posts: ObservedPost[],
  trend = baselineTrend(),
  content = baselineContent(),
  existing: ExistingRun | null = null,
) {
  return planDailyOptimization({
    now: new Date(AS_OF),
    time: TIME,
    corpus: { asOf: AS_OF, posts, topics: [], notes: [] },
    trend,
    content,
    existing,
    previousTopicLabels: [],
    force: true,
  });
}

function questionCorpus(): ObservedPost[] {
  const question = "Why is this post still being quoted?";
  const statement = "The pool is open and the note is already public.";
  return [
    ...repeat("q-now", question, 20, 2, 40, 12, 6),
    ...repeat("q-old", question, 20, 72, 40, 12, 6),
    ...repeat("s-now", statement, 20, 2, 4, 1, 0),
    ...repeat("s-old", statement, 20, 72, 4, 1, 0),
  ];
}

function hashtagCorpus(): ObservedPost[] {
  return [
    ...repeat("h-now", "Pool update #sol", 20, 2, 50, 10, 8),
    ...repeat("h-old", "Pool update #sol", 20, 72, 50, 10, 8),
    ...repeat("p-now", "Pool update today", 20, 2, 3, 1, 0),
    ...repeat("p-old", "Pool update today", 20, 72, 3, 1, 0),
  ];
}

test("editorial rule upgrades run once per week at the Rome Monday slot", () => {
  const monday = romeWallTimeToUtc(2026, 9, 28, 6, 15);
  const before = new Date(monday.getTime() - 60_000);
  const tuesday = romeWallTimeToUtc(2026, 9, 29, 12, 0);
  const nextMonday = romeWallTimeToUtc(2026, 10, 5, 6, 15);
  assert.equal(romeWeekKey(monday), "2026-W40");
  assert.equal(isWeeklyEditorialUpgradeDue(before, TIME, null), false);
  assert.equal(isWeeklyEditorialUpgradeDue(monday, TIME, "2026-09-21T04:15:00.000Z"), true);
  assert.equal(isWeeklyEditorialUpgradeDue(monday, TIME, monday.toISOString()), false);
  assert.equal(isWeeklyEditorialUpgradeDue(tuesday, TIME, monday.toISOString()), false);
  assert.equal(isWeeklyEditorialUpgradeDue(nextMonday, TIME, monday.toISOString()), true);
});

test("schedule stays on 06:15 Europe/Rome across DST", () => {
  assert.deepEqual(parseDailyTime(undefined), { hour: 6, minute: 15 });
  assert.deepEqual(parseDailyTime("99:99"), { hour: 6, minute: 15 });
  const summer = romeWallTimeToUtc(2026, 7, 15, 6, 15);
  const winter = romeWallTimeToUtc(2026, 1, 15, 6, 15);
  assert.equal(formatRomeHm(summer), "06:15");
  assert.equal(formatRomeHm(winter), "06:15");
  assert.notEqual(summer.toISOString().slice(11, 16), winter.toISOString().slice(11, 16));
  const before = new Date(summer.getTime() - 60_000);
  const after = new Date(summer.getTime() + 60_000);
  assert.equal(isDue(before, TIME, null), false);
  assert.equal(isDue(after, TIME, null), true);
  assert.equal(isDue(after, TIME, romeDayKey(after)), false);
  assert.equal(formatRomeHm(nextRunAt(before, TIME, null)), "06:15");
  assert.equal(romeDayKey(nextRunAt(after, TIME, romeDayKey(after))), romeDayKey(new Date(after.getTime() + 24 * 3_600_000)));
});

test("a healthy repeated question pattern can promote, and a second same-day run does not", () => {
  const first = planWith(questionCorpus());
  assert.deepEqual(first.report.ordering, ["viral_trend", "content_logic", "score_feedback"]);
  assert.ok(first.nextTrend);
  const pattern = first.nextTrend?.patterns.find((item) => item.patternId === "HOOK_QUESTION");
  assert.equal(pattern?.status, "ACTIVE");
  assert.ok(pattern?.confidence === "HIGH" || pattern?.confidence === "VERY_HIGH");
  assert.ok((pattern?.sampleSize ?? 0) >= 20);
  assert.ok((pattern?.engagementLift ?? 0) > 0.15);
  const rule = first.nextContent?.rules.find((item) => item.ruleId === "rule:learned:HOOK_QUESTION");
  assert.equal(rule?.status, "ACTIVE");
  assert.ok((rule?.scoreImpact ?? 0) > 0);
  assert.equal(first.status, "completed");
  assert.ok((first.report.scoreImpact.scoreDelta ?? 0) > 0);

  const second = planWith(questionCorpus(), first.nextTrend ?? baselineTrend(), first.nextContent ?? baselineContent(), {
    optimizationRunId: first.optimizationRunId,
    status: first.status,
    trendVersion: first.trendVersion,
    contentLogicVersion: first.contentLogicVersion,
    dayKey: first.dayKey,
  });
  assert.equal(second.status, "skipped_duplicate");
  assert.equal(second.newVersion.trend, null);
  assert.equal(second.newVersion.content, null);
  assert.equal(second.trendVersion, first.trendVersion);
});

test("a sudden hashtag shift is recorded and then rejected by the score loop", () => {
  const result = planWith(hashtagCorpus());
  const pattern = result.nextTrend?.patterns.find((item) => item.patternId === "HASHTAG_PATTERN");
  assert.equal(pattern?.status, "ACTIVE");
  assert.equal(pattern?.trendDirection, "up");
  const rule = result.nextContent?.rules.find((item) => item.ruleId === "rule:learned:HASHTAG_PATTERN");
  assert.equal(rule?.status, "ROLLED_BACK");
  assert.equal(rule?.weight, 0);
  const optimized = optimizeContent({
    text: BENCHMARKS.find((item) => item.id === "weak-post")!.text,
    kind: "post",
    mode: "SCORE_IMPROVE",
    logic: result.nextContent ?? baselineContent(),
  });
  assert.doesNotMatch(optimized.text, /#update/);
});

test("trend decay marks a previously active pattern deprecated", () => {
  const priorPattern: ViralPattern = {
    patternId: "HOOK_QUESTION",
    name: "Question hook",
    description: "The opening line asks a question.",
    confidence: "HIGH",
    sampleSize: 40,
    observedAt: AS_OF,
    trendDirection: "flat",
    supportingSignals: ["core_engagement"],
    riskOfOverfitting: "low",
    recommendedUsage: "Eligible.",
    status: "ACTIVE",
    engagementLift: 1,
    format: "any",
  };
  const prior: ViralTrendVersion = { ...baselineTrend(), patterns: [priorPattern] };
  const faded = [
    ...repeat("q-now", "Why is this post still being quoted?", 20, 2, 2, 0, 0),
    ...repeat("q-old", "Why is this post still being quoted?", 20, 72, 2, 0, 0),
    ...repeat("s-now", "The pool is open and the note is already public.", 20, 2, 30, 10, 4),
    ...repeat("s-old", "The pool is open and the note is already public.", 20, 72, 30, 10, 4),
  ];
  const trend = analyzeTrends({ asOf: AS_OF, posts: faded, topics: [], notes: [] }, prior, AS_OF);
  const pattern = trend.version.patterns.find((item) => item.patternId === "HOOK_QUESTION");
  assert.equal(pattern?.status, "DEPRECATED");
  assert.ok(trend.differential.weakenedPatterns.includes("HOOK_QUESTION"));
});

test("two posts cannot create a pattern or a new version", () => {
  const result = planWith([
    post("a", "Why now?", 2, 100, 20, 10),
    post("b", "Why now?", 3, 80, 10, 5),
  ]);
  assert.equal(result.status, "kept_stable");
  assert.equal(result.nextTrend, null);
  assert.equal(result.nextContent, null);
  assert.equal(result.trendVersion, "v1");
  assert.equal(result.contentLogicVersion, "v1");
});

test("invalid corpus fails before content rules change", () => {
  const result = planDailyOptimization({
    now: new Date(AS_OF),
    time: TIME,
    corpus: { asOf: "not-a-date", posts: questionCorpus(), topics: [], notes: [] },
    trend: baselineTrend(),
    content: baselineContent(),
    existing: null,
    previousTopicLabels: [],
    force: true,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.report.ordering, ["viral_trend"]);
  assert.equal(result.trendVersion, "v1");
  assert.equal(result.contentLogicVersion, "v1");
  assert.match(result.errors[0] ?? "", /asOf/);
});

test("clock before the Rome slot does not run", () => {
  const early = romeWallTimeToUtc(2026, 9, 28, 5, 0);
  const result = planDailyOptimization({
    now: early,
    time: TIME,
    corpus: { asOf: early.toISOString(), posts: questionCorpus(), topics: [], notes: [] },
    trend: baselineTrend(),
    content: baselineContent(),
    existing: null,
    previousTopicLabels: [],
    force: false,
  });
  assert.equal(result.status, "not_due");
  assert.equal(result.nextTrend, null);
});

test("weak paste score rises with real dimension deltas", () => {
  const text = BENCHMARKS.find((item) => item.id === "weak-post")!.text;
  const result = optimizeContent({ text, kind: "post", mode: "SCORE_IMPROVE", logic: baselineContent() });
  const again = scoreContent(result.text, "post");
  assert.ok(result.optimizedScore > result.originalScore);
  assert.equal(result.optimizedScore, again.total);
  assert.equal(result.scoreDelta, again.total - scoreContent(text, "post").total);
  for (const delta of result.dimensionDeltas) {
    const before = result.before.dimensions.find((item) => item.key === delta.key);
    const after = again.dimensions.find((item) => item.key === delta.key);
    assert.equal(delta.delta, (after?.score ?? 0) - (before?.score ?? 0));
  }
  assert.equal(result.keptOriginal, false);
});

test("an already strong post is not rewritten", () => {
  const text = BENCHMARKS.find((item) => item.id === "strong-post")!.text;
  const before = scoreContent(text, "post");
  assert.equal(isAlreadyStrong(before), true);
  const result = optimizeContent({ text, kind: "post", mode: "SCORE_IMPROVE", logic: baselineContent() });
  assert.equal(result.text, text.trim());
  assert.equal(result.scoreDelta, 0);
});

test("bearish and severe copy keep the downside and gain no bullish phrasing", () => {
  const logic: ContentLogicVersion = baselineContent();
  for (const id of ["bearish-post", "severe-article"] as const) {
    const bench = BENCHMARKS.find((item) => item.id === id)!;
    const result = optimizeContent({ text: bench.text, kind: bench.kind, mode: "SCORE_IMPROVE", logic });
    assert.match(result.text, /down \d/);
    assert.doesNotMatch(result.text, /exciting opportunity|to the moon|could explode|great potential/i);
    if (id === "severe-article") {
      assert.match(result.text, /possible rug pull/i);
      assert.match(result.text, /not proof/i);
    }
  }
});

test("thread and article modes do not share one structure", () => {
  const source = "The pool is thin. Sells are leading. The 24h change is -32.0%. Read that before any story.";
  const thread = optimizeContent({ text: source, kind: "post", mode: "THREADIFY", logic: baselineContent() });
  const article = optimizeContent({ text: source, kind: "article", mode: "ARTICLEIFY", logic: baselineContent() });
  assert.match(thread.text, /^1\/ /);
  assert.equal(thread.kind, "thread");
  assert.match(article.text, /What the draft already says/);
  assert.equal(article.kind, "article");
  assert.match(thread.text, /-32\.0%/);
  assert.match(article.text, /-32\.0%/);
  assert.ok(thread.optimizedScore >= scoreContent(source, "thread").total - 0 || thread.keptOriginal);
  assert.ok(article.scoreDelta >= 0 || article.keptOriginal);
});
