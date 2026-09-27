/**
 * Persistence for optimization runs and versions.
 * Realtime generation never waits on this module's analysis.
 */

import { getSql, type Sql } from "@/lib/db";
import { getTrendSnapshot } from "../trends.ts";
import { baselineContent, baselineTrend } from "./baseline.ts";
import { emitLogs } from "./log.ts";
import { planDailyOptimization } from "./runner.ts";
import { dailyOptimizationTime, isDue, nextRunAt, romeDayKey } from "./schedule.ts";
import type {
  ContentLogicVersion,
  ObservedPost,
  OptimizationSummary,
  PlannedOptimization,
  TopicSignal,
  ViralTrendVersion,
} from "./types.ts";

const RUN_TIMEOUT_MS = 20_000;
const STALE_RUNNING_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 2;

type RunRow = {
  optimization_run_id: string;
  day_key: string;
  started_at: string | Date;
  completed_at: string | Date | null;
  status: string;
  previous_trend_version: string;
  previous_content_version: string;
  trend_version: string;
  content_logic_version: string;
  rollback_available: boolean;
  attempts: number;
  payload: PlannedOptimization | string;
};

function asObject<T>(value: T | string): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value;
}

function stamp(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadActive(sql: Sql): Promise<{ trend: ViralTrendVersion; content: ContentLogicVersion }> {
  const trendRows = await sql<{ payload: ViralTrendVersion | string }>`
    select payload from xpulse_trend_versions
    where status = 'active'
    order by version_number desc
    limit 1
  `;
  const contentRows = await sql<{ payload: ContentLogicVersion | string }>`
    select payload from xpulse_content_logic_versions
    where status = 'active'
    order by version_number desc
    limit 1
  `;
  return {
    trend: trendRows[0] ? asObject(trendRows[0].payload) : baselineTrend(),
    content: contentRows[0] ? asObject(contentRows[0].payload) : baselineContent(),
  };
}

async function ensureBaseline(sql: Sql): Promise<void> {
  const trend = baselineTrend();
  const content = baselineContent();
  await sql`
    insert into xpulse_trend_versions (version, version_number, status, payload)
    values (${trend.version}, ${trend.versionNumber}, 'active', ${JSON.stringify(trend)}::jsonb)
    on conflict (version) do nothing
  `;
  await sql`
    insert into xpulse_content_logic_versions (version, version_number, trend_version, status, payload)
    values (${content.version}, ${content.versionNumber}, ${content.basedOnTrendVersion}, 'active', ${JSON.stringify(content)}::jsonb)
    on conflict (version) do nothing
  `;
}

async function loadPosts(sql: Sql): Promise<ObservedPost[]> {
  const rows = await sql<{
    id: string;
    type: string;
    text: string;
    metrics: Record<string, unknown> | string | null;
    published_at: string | Date | null;
  }>`
    select id, type, text, metrics, published_at
    from xpulse_posts
    where published_at is not null
    order by published_at desc
    limit 400
  `;
  return rows.map((row) => {
    const metrics = row.metrics ? asObject(row.metrics) : {};
    const kind = row.type === "thread" || row.type === "article" ? row.type : "post";
    return {
      id: row.id,
      text: row.text,
      kind,
      publishedAt: stamp(row.published_at) ?? new Date(0).toISOString(),
      impressions: finite(metrics.impressions),
      likes: finite(metrics.likes),
      replies: finite(metrics.replies),
      reposts: finite(metrics.reposts),
      quotes: finite(metrics.quotes),
      bookmarks: finite(metrics.bookmarks),
    };
  });
}

async function loadTopics(): Promise<{ topics: TopicSignal[]; notes: string[] }> {
  const notes: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const snapshot = await withTimeout(getTrendSnapshot(attempt > 1), 8_000);
      return {
        topics: snapshot.items.map((item) => ({
          id: item.id,
          label: item.label,
          source: item.source,
          score: Number.isFinite(item.score) ? item.score : null,
        })),
        notes: snapshot.items.length ? notes : ["Topic snapshot returned no rows."],
      };
    } catch {
      notes.push(attempt === 1 ? "Topic snapshot failed. Retrying once." : "Topic snapshot unavailable. Post corpus only.");
    }
  }
  return { topics: [], notes };
}

function summaryFrom(plan: PlannedOptimization | null, trend: string, content: string): OptimizationSummary {
  const time = dailyOptimizationTime();
  const lastDay =
    plan && ["completed", "kept_stable", "rolled_back"].includes(plan.status) ? plan.dayKey : null;
  return {
    trendVersion: plan?.trendVersion ?? trend,
    contentLogicVersion: plan?.contentLogicVersion ?? content,
    lastRun: plan
      ? {
          id: plan.optimizationRunId,
          status: plan.status,
          startedAt: plan.startedAt,
          completedAt: plan.completedAt,
          dayKey: plan.dayKey,
          scoreDelta: plan.report.scoreImpact.scoreDelta,
        }
      : null,
    nextRunAt: nextRunAt(new Date(), time, lastDay).toISOString(),
    schedule: {
      time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`,
      timezone: "Europe/Rome",
    },
    rulesChanged: plan?.report.ruleChanges ?? [],
    patternsDiscovered: plan?.report.newPatterns ?? [],
    experimentsActive: plan?.report.experiments ?? [],
    lastScoreDelta: plan?.status === "completed" ? plan.report.scoreImpact.scoreDelta : null,
    rollbackAvailable: plan?.rollbackAvailable ?? false,
  };
}

async function savePlan(sql: Sql, plan: PlannedOptimization, attempts: number): Promise<void> {
  if (plan.status === "not_due" || plan.status === "skipped_duplicate") return;
  if (plan.nextTrend) {
    await sql`
      update xpulse_trend_versions set status = 'superseded' where status = 'active' and version <> ${plan.nextTrend.version}
    `;
    await sql`
      insert into xpulse_trend_versions (version, version_number, status, payload)
      values (${plan.nextTrend.version}, ${plan.nextTrend.versionNumber}, 'active', ${JSON.stringify(plan.nextTrend)}::jsonb)
      on conflict (version) do update set status = 'active', payload = excluded.payload
    `;
  }
  if (plan.nextContent) {
    await sql`
      update xpulse_content_logic_versions set status = 'superseded' where status = 'active' and version <> ${plan.nextContent.version}
    `;
    await sql`
      insert into xpulse_content_logic_versions (version, version_number, trend_version, status, payload)
      values (
        ${plan.nextContent.version},
        ${plan.nextContent.versionNumber},
        ${plan.nextContent.basedOnTrendVersion},
        'active',
        ${JSON.stringify(plan.nextContent)}::jsonb
      )
      on conflict (version) do update set status = 'active', payload = excluded.payload
    `;
  }
  await sql`
    insert into xpulse_optimization_runs (
      optimization_run_id, day_key, started_at, completed_at, status,
      previous_trend_version, previous_content_version, trend_version, content_logic_version,
      rollback_available, attempts, payload
    ) values (
      ${plan.optimizationRunId},
      ${plan.dayKey},
      ${plan.startedAt},
      ${plan.completedAt},
      ${plan.status},
      ${plan.previousVersion.trend},
      ${plan.previousVersion.content},
      ${plan.trendVersion},
      ${plan.contentLogicVersion},
      ${plan.rollbackAvailable},
      ${attempts},
      ${JSON.stringify(plan)}::jsonb
    )
    on conflict (optimization_run_id) do update set
      completed_at = excluded.completed_at,
      status = excluded.status,
      trend_version = excluded.trend_version,
      content_logic_version = excluded.content_logic_version,
      rollback_available = excluded.rollback_available,
      attempts = excluded.attempts,
      payload = excluded.payload
  `;
  for (const experiment of plan.report.experiments) {
    const [ruleId, status] = experiment.split(":");
    if (!ruleId || !status) continue;
    await sql`
      insert into xpulse_optimization_experiments (experiment_id, run_id, rule_id, status, payload)
      values (${`${plan.optimizationRunId}:${ruleId}`}, ${plan.optimizationRunId}, ${ruleId}, ${status}, ${JSON.stringify({ experiment })}::jsonb)
      on conflict (experiment_id) do update set status = excluded.status, payload = excluded.payload
    `;
  }
}

export async function loadActiveContentLogic(): Promise<ContentLogicVersion> {
  try {
    const sql = await getSql();
    await ensureBaseline(sql);
    const { content } = await loadActive(sql);
    return content;
  } catch {
    return baselineContent();
  }
}

export async function getOptimizationSummary(): Promise<OptimizationSummary> {
  try {
    const sql = await getSql();
    await ensureBaseline(sql);
    const { trend, content } = await loadActive(sql);
    const rows = await sql<RunRow>`
      select * from xpulse_optimization_runs
      order by started_at desc
      limit 1
    `;
    const plan = rows[0] ? asObject(rows[0].payload) : null;
    return summaryFrom(plan, trend.version, content.version);
  } catch {
    return summaryFrom(null, "v1", "v1");
  }
}

export async function executeDailyOptimization(options: { force?: boolean; now?: Date } = {}): Promise<OptimizationSummary> {
  const now = options.now ?? new Date();
  const sql = await getSql();
  await ensureBaseline(sql);
  const dayKey = romeDayKey(now);
  const existingRows = await sql<RunRow>`
    select * from xpulse_optimization_runs where day_key = ${dayKey} limit 1
  `;
  const existing = existingRows[0];
  if (existing && ["completed", "kept_stable", "rolled_back"].includes(existing.status)) {
    return summaryFrom(asObject(existing.payload), existing.trend_version, existing.content_logic_version);
  }
  if (existing?.status === "failed" && existing.attempts >= MAX_ATTEMPTS) {
    return summaryFrom(asObject(existing.payload), existing.trend_version, existing.content_logic_version);
  }
  if (existing?.status === "running" && now.getTime() - new Date(stamp(existing.started_at) ?? now).getTime() < STALE_RUNNING_MS) {
    return summaryFrom(asObject(existing.payload), existing.trend_version, existing.content_logic_version);
  }

  const active = await loadActive(sql);
  const attempts = (existing?.attempts ?? 0) + 1;
  if (!options.force && !isDue(now, dailyOptimizationTime(), null)) {
    const clock = planDailyOptimization({
      now,
      time: dailyOptimizationTime(),
      corpus: { asOf: now.toISOString(), posts: [], topics: [], notes: [] },
      trend: active.trend,
      content: active.content,
      existing: null,
      previousTopicLabels: active.trend.topicLabels,
      force: false,
    });
    emitLogs(clock.logs);
    return summaryFrom(clock, active.trend.version, active.content.version);
  }

  const lockId = `opt-${dayKey}`;
  const locked = await sql<{ optimization_run_id: string }>`
    insert into xpulse_optimization_runs (
      optimization_run_id, day_key, started_at, completed_at, status,
      previous_trend_version, previous_content_version, trend_version, content_logic_version,
      rollback_available, attempts, payload
    ) values (
      ${lockId}, ${dayKey}, ${now.toISOString()}, null, 'running',
      ${active.trend.version}, ${active.content.version}, ${active.trend.version}, ${active.content.version},
      false, ${attempts}, ${JSON.stringify({ status: "running", dayKey })}::jsonb
    )
    on conflict (day_key) do nothing
    returning optimization_run_id
  `;
  if (!locked.length && existing && ["running", "failed"].includes(existing.status) === false) {
    return summaryFrom(asObject(existing.payload), existing.trend_version, existing.content_logic_version);
  }

  const posts = await loadPosts(sql);
  const topics = await loadTopics();
  const lastRows = await sql<RunRow>`
    select payload from xpulse_optimization_runs
    where status in ('completed', 'kept_stable', 'rolled_back')
    order by started_at desc
    limit 1
  `;
  const lastPlan = lastRows[0] ? asObject(lastRows[0].payload) : null;
  const plan = await withTimeout(
    Promise.resolve().then(() =>
      planDailyOptimization({
        now,
        time: dailyOptimizationTime(),
        corpus: {
          asOf: now.toISOString(),
          posts,
          topics: topics.topics,
          notes: topics.notes,
        },
        trend: active.trend,
        content: active.content,
        existing: null,
        previousTopicLabels: lastPlan?.report.topics
          ? [...lastPlan.report.topics.unchanged, ...lastPlan.report.topics.added]
          : active.trend.topicLabels,
        force: true,
      }),
    ),
    RUN_TIMEOUT_MS,
  );
  emitLogs(plan.logs);
  await savePlan(sql, plan, attempts);
  return summaryFrom(plan, plan.trendVersion, plan.contentLogicVersion);
}
