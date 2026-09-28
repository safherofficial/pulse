/**
 * Shared types for the daily optimization cycle.
 * Missing measurements stay null. Nothing here is a fabricated lift.
 */

export type Confidence = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type RuleStatus = "EXPERIMENTAL" | "ACTIVE" | "DEPRECATED" | "ROLLED_BACK";

export type PatternDirection = "up" | "down" | "flat" | "unstable" | "insufficient";

export type ContentFormat = "post" | "thread" | "article";

export type OptimizeMode =
  | "GENERATE"
  | "OPTIMIZE"
  | "REWRITE"
  | "THREADIFY"
  | "ARTICLEIFY"
  | "HOOK_OPTIMIZE"
  | "SCORE_IMPROVE";

export type ObservedPost = {
  id: string;
  text: string;
  kind: ContentFormat;
  publishedAt: string;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  bookmarks: number | null;
};

export type TopicSignal = {
  id: string;
  label: string;
  source: string;
  score: number | null;
};

export type ObservationCorpus = {
  asOf: string;
  posts: ObservedPost[];
  topics: TopicSignal[];
  notes: string[];
};

export type ViralPattern = {
  patternId: string;
  name: string;
  description: string;
  confidence: Confidence;
  sampleSize: number;
  observedAt: string;
  trendDirection: PatternDirection;
  supportingSignals: string[];
  riskOfOverfitting: "low" | "medium" | "high";
  recommendedUsage: string;
  status: RuleStatus;
  /** Median core-engagement lift vs the rest of the sample. Null when not computable. */
  engagementLift: number | null;
  format: ContentFormat | "any";
};

export type ContentRule = {
  ruleId: string;
  version: number;
  weight: number;
  confidence: Confidence;
  status: RuleStatus;
  lastUpdated: string;
  /** Share of benchmark cases whose score rose. Null until measured. */
  successRate: number | null;
  sampleCount: number;
  /** Mean scoreContent delta on the fixed benchmark. Null until measured. */
  scoreImpact: number | null;
  rollbackVersion: number | null;
  appliesTo: ContentFormat[];
  lever: string;
  description: string;
  /** Detector that proposed this rule, or null for a shipped craft rule. */
  patternId: string | null;
  learned: boolean;
};

export type WindowStats = {
  posts: number;
  withCoreEngagement: number;
  medianCoreEngagement: number | null;
  medianReplyDensity: number | null;
  medianViewEfficiency: number | null;
  medianEngagementPerHour: number | null;
};

export type ViralTrendVersion = {
  version: string;
  versionNumber: number;
  weights: Record<string, number>;
  patterns: ViralPattern[];
  confidence: Confidence;
  createdAt: string;
  sourceSignals: string[];
  changesFromPreviousVersion: string[];
  status: "active" | "superseded" | "rejected";
  topicLabels: string[];
  windows: Record<"1h" | "6h" | "24h" | "all", WindowStats>;
  pace: "acceleration" | "deceleration" | "stable" | "insufficient";
};

export type ScoreBenchmark = {
  meanScoreBefore: number;
  meanScoreAfter: number;
  medianScoreBefore: number;
  medianScoreAfter: number;
  scoreDelta: number;
  highScoreRate: number;
  regressionRate: number;
  cases: Array<{
    id: string;
    before: number;
    after: number;
    delta: number;
    preserved: boolean;
  }>;
};

export type ContentLogicVersion = {
  version: string;
  /** Global editorial-engine version used to create this rule set. */
  editorialEngineVersion?: string;
  versionNumber: number;
  rules: ContentRule[];
  createdAt: string;
  basedOnTrendVersion: string;
  changesFromPreviousVersion: string[];
  status: "active" | "superseded" | "rejected";
  benchmark: ScoreBenchmark | null;
};

export type DailyReport = {
  title: "DAILY OPTIMIZATION REPORT";
  date: string;
  runId: string;
  previousViralVersion: string;
  newViralVersion: string | null;
  previousContentVersion: string;
  newContentVersion: string | null;
  newPatterns: string[];
  strengthenedPatterns: string[];
  weakenedPatterns: string[];
  removedPatterns: string[];
  stablePatterns: string[];
  experimentalPatterns: string[];
  newRules: string[];
  ruleChanges: string[];
  experiments: string[];
  scoreImpact: {
    meanScoreBefore: number | null;
    meanScoreAfter: number | null;
    medianScoreBefore: number | null;
    medianScoreAfter: number | null;
    scoreDelta: number | null;
    highScoreRate: number | null;
    regressionRate: number | null;
  };
  rollback: string;
  notes: string[];
  windows: ViralTrendVersion["windows"] | null;
  ordering: Array<"viral_trend" | "content_logic" | "score_feedback">;
  topics: { added: string[]; removed: string[]; unchanged: string[] };
};

export type RunStatus =
  | "completed"
  | "kept_stable"
  | "failed"
  | "rolled_back"
  | "skipped_duplicate"
  | "not_due";

export type PlannedOptimization = {
  optimizationRunId: string;
  startedAt: string;
  completedAt: string;
  status: RunStatus;
  dayKey: string;
  previousVersion: { trend: string; content: string };
  newVersion: { trend: string | null; content: string | null };
  trendVersion: string;
  contentLogicVersion: string;
  metrics: ScoreBenchmark | null;
  errors: string[];
  rollbackAvailable: boolean;
  report: DailyReport;
  logs: OptimizationLogEvent[];
  nextTrend: ViralTrendVersion | null;
  nextContent: ContentLogicVersion | null;
  duplicateOf?: string;
};

export type OptimizationLogEvent = {
  event:
    | "optimization_started"
    | "data_analyzed"
    | "patterns_discovered"
    | "rules_changed"
    | "viral_version_created"
    | "content_version_created"
    | "experiments_created"
    | "validation_completed"
    | "rollback_performed"
    | "optimization_skipped"
    | "optimization_failed";
  optimizationRunId: string;
  at: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type OptimizationSummary = {
  trendVersion: string;
  contentLogicVersion: string;
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    dayKey: string;
    scoreDelta: number | null;
  } | null;
  nextRunAt: string;
  schedule: { time: string; timezone: string };
  rulesChanged: string[];
  patternsDiscovered: string[];
  experimentsActive: string[];
  lastScoreDelta: number | null;
  rollbackAvailable: boolean;
};
