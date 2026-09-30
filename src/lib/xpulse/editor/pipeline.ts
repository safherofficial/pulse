/**
 * Editorial pipeline. Score numbers come from scoreContent.
 * Rewrites may rearrange or delete template noise. They do not add facts.
 */

import { scoreContent, type ContentKind, type ContentScoreReport } from "../content-score.ts";
import { EDITORIAL_ENGINE_VERSION, validateEditorialShape } from "../editorial-standard.ts";
import { baselineContent } from "../optimize/baseline.ts";
import { preservesAuthorFacts, PROMO_RE } from "../optimize/benchmarks.ts";
import { optimizeContent } from "../optimize/compose.ts";
import type { ContentLogicVersion, OptimizeMode } from "../optimize/types.ts";
import {
  detectFormat,
  detectIntent,
  detectLanguage,
  extractEntities,
  extractStatements,
  normalizeDraft,
  type DraftFormat,
  type DraftIntent,
  type DraftLanguage,
} from "./detect.ts";
import { diffLines, type DiffMark } from "./diff.ts";
import type { UrlExtraction } from "./url.ts";
import type { TrendSnapshot } from "../trends.ts";
import type { ViralTrendVersion } from "../optimize/types.ts";

export type EditorMode =
  | "ANALYZE"
  | "IMPROVE"
  | "REWRITE"
  | "SHORTEN"
  | "EXPAND"
  | "MAKE_POST"
  | "MAKE_THREAD"
  | "MAKE_ARTICLE"
  | "IMPROVE_HOOK"
  | "IMPROVE_STRUCTURE"
  | "FACT_CHECK"
  | "SCORE";

export type PlanAction = "KEEP" | "IMPROVE" | "REMOVE" | "ADD" | "VERIFY";

export type PlanItem = {
  action: PlanAction;
  target: string;
  reason: string;
  expectedImpact: "low" | "medium" | "high";
  priority: number;
};

export type NamedScore = {
  total: number;
  viral: number;
  hook: number | null;
  clarity: number | null;
  structure: number | null;
  specificity: number;
  originality: number | null;
  readability: number | null;
  valueDensity: number | null;
  engagementPotential: number | null;
  credibility: number | null;
};

export type EditorDossier = {
  mode: EditorMode;
  input: {
    text: string;
    request: string;
    language: DraftLanguage;
    format: DraftFormat;
    intent: DraftIntent;
    entities: ReturnType<typeof extractEntities>;
    facts: string[];
    claims: string[];
  };
  score: {
    original: NamedScore;
    improved: NamedScore;
    delta: number;
    dimensions: Array<{ key: string; label: string; before: number; after: number; delta: number }>;
  };
  analysis: {
    works: string[];
    limits: string[];
    why: string[];
    risks: string[];
    viral: string[];
    ai?: {
      summary: string;
      motivations: Array<{ criterion: string; score: number; reason: string }>;
      strengths: string[];
      weaknesses: string[];
      suggestions: Array<{ id: string; position: string; problem: string; correction: string; criterion: string }>;
      trace: { provider: string; model: string; durationMs: number; attempt: number };
    };
  };
  plan: PlanItem[];
  output: {
    text: string;
    kind: ContentKind;
    keptOriginal: boolean;
    notes: string[];
    source: "deterministic" | "configured-llm";
  };
  diff: DiffMark[];
  validation: {
    factsPreserved: boolean;
    numbersPreserved: boolean;
    promoAdded: boolean;
    languageKept: boolean;
  };
  url: UrlExtraction | null;
  trend?: {
    version: string;
    confidence: string;
    pace: string;
    activePatterns: string[];
    topicLabels: string[];
  };
};

const AI_SLACK =
  /\b(in today's rapidly evolving|it's important to note|the future is here|this changes everything|here's why|as an ai|game[- ]?changer)\b/i;

const MODES = new Set<EditorMode>([
  "ANALYZE",
  "IMPROVE",
  "REWRITE",
  "SHORTEN",
  "EXPAND",
  "MAKE_POST",
  "MAKE_THREAD",
  "MAKE_ARTICLE",
  "IMPROVE_HOOK",
  "IMPROVE_STRUCTURE",
  "FACT_CHECK",
  "SCORE",
]);

export function isEditorMode(value: unknown): value is EditorMode {
  return typeof value === "string" && MODES.has(value as EditorMode);
}

export function namedScore(report: ContentScoreReport, trend?: ViralTrendVersion | null, liveTrends?: TrendSnapshot | null, text = ""): NamedScore {
  const dim = (key: string) => report.dimensions.find((item) => item.key === key)?.score ?? null;
  const score = (key: string) => report.dimensions.find((item) => item.key === key)?.score ?? 0;
  const craftViral =
    score("hook") * 0.3 +
    score("curiosity") * 0.25 +
    score("shareability") * 0.25 +
    score("emotion") * 0.1 +
    score("structure") * 0.1;
  const trendMatch = trendMatchScore(text, trend, liveTrends);
  const viral = Math.round(craftViral * 0.82 + trendMatch * 0.18);
  return {
    total: report.total,
    viral,
    hook: dim("hook"),
    clarity: dim("clarity"),
    structure: dim("structure"),
    specificity: report.signals.specificity,
    originality: dim("human"),
    readability: dim("readability"),
    valueDensity: dim("density"),
    engagementPotential: dim("shareability"),
    credibility: dim("anti_spam"),
  };
}

/** Return the lowest-scoring craft levers first; integrity gates are never optimization targets. */
export function weakestLevers(
  report: Pick<EditorDossier["score"], "dimensions">,
  limit = 3,
): Array<{ key: string; label: string; score: number }> {
  return report.dimensions
    .filter((dimension) => dimension.key !== "factual_consistency" && dimension.key !== "intent_alignment" && dimension.score < 72)
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.max(1, limit))
    .map((dimension) => ({ key: dimension.key, label: dimension.label, score: dimension.score }));
}

function scoreWithLogic(text: string, kind: ContentKind, logic: ContentLogicVersion | null | undefined): ContentScoreReport {
  return scoreContent(text, kind, logic?.scoreWeights ?? undefined, logic?.scoreTypeMultipliers?.[kind] ?? 1);
}

function repetitionScore(text: string): number {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 18);
  if (sentences.length < 2) return 100;
  const unique = new Set(sentences);
  const duplicatePenalty = (sentences.length - unique.size) * 22;
  const trigrams = new Map<string, number>();
  for (const sentence of sentences) {
    const words = sentence.split(" ");
    for (let i = 0; i + 2 < words.length; i += 1) {
      const key = words.slice(i, i + 3).join(" ");
      trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
    }
  }
  const repeatedTrigrams = [...trigrams.values()].filter((count) => count > 1).length;
  return Math.max(0, Math.min(100, 100 - duplicatePenalty - repeatedTrigrams * 4));
}

function intentAlignmentScore(before: DraftIntent, afterText: string): number {
  const after = detectIntent(afterText);
  if (before === after) return 100;
  return 45;
}


export function runEditorPipeline(input: {
  text: string;
  mode: EditorMode;
  request?: string;
  kind?: DraftFormat | null;
  logic?: ContentLogicVersion | null;
  url?: UrlExtraction | null;
  source?: "deterministic" | "configured-llm";
  /** Writer candidate. The critic below still accepts or reverts it. */
  proposed?: { text: string; source: string } | null;
  trend?: ViralTrendVersion | null;
  liveTrends?: TrendSnapshot | null;
}): EditorDossier {
  const text = normalizeDraft(input.text);
  const request = (input.request ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
  const language = detectLanguage(text);
  const format = detectFormat(text, input.kind === "headline" || input.kind === "note" ? null : input.kind);
  const kind = toKind(input.mode, format);
  const intent = detectIntent(text);
  const entities = extractEntities(text);
  const statements = extractStatements(text);
  // Resolve active content logic before any scoring that depends on it.
  const logic = input.logic ?? baselineContent();
  const before = text ? scoreWithLogic(text, kind, logic) : emptyReport();
  const plan = buildPlan(before, text, statements.claims, request);
  const drafted = input.proposed?.text.trim()
    ? {
        text: normalizeDraft(input.proposed.text),
        kind,
        notes: [`Configured model ${input.proposed.source}. Critic still checks facts, numbers, language, and promo wording.`],
      }
    : applyMode(text, input.mode, kind, logic);
  const validated = validate(text, drafted.text, language, input.mode !== "ANALYZE" && input.mode !== "SCORE" && input.mode !== "FACT_CHECK");
  const editorialGate = validateEditorialShape(drafted.text, drafted.kind);
  const accepted = validated.ok && editorialGate.pass;
  const finalText = accepted ? drafted.text : text;
  const after = scoreWithLogic(finalText, drafted.kind, logic);
  const original = namedScore(before, input.trend, input.liveTrends, text);
  const improved = namedScore(after, input.trend, input.liveTrends, finalText);
  const editorialIntegrity = finalText === text
    ? { factual: 100, intent: 100 }
    : {
        factual: validated.facts && validated.numbers && validated.language && !validated.promoAdded ? 100 : 0,
        intent: intentAlignmentScore(intent, finalText),
      };
  const baseDimensions = before.dimensions.map((dimension) => {
    const next = after.dimensions.find((item) => item.key === dimension.key)?.score ?? dimension.score;
    return {
      key: dimension.key,
      label: dimension.label,
      before: dimension.score,
      after: next,
      delta: next - dimension.score,
    };
  });
  baseDimensions.push(
    {
      key: "repetition",
      label: "Repetition",
      before: repetitionScore(text),
      after: repetitionScore(finalText),
      delta: repetitionScore(finalText) - repetitionScore(text),
    },
    {
      key: "factual_consistency",
      label: "Factual consistency",
      before: 100,
      after: editorialIntegrity.factual,
      delta: editorialIntegrity.factual - 100,
    },
    {
      key: "intent_alignment",
      label: "User-intent alignment",
      before: 100,
      after: editorialIntegrity.intent,
      delta: editorialIntegrity.intent - 100,
    },
  );
  const activePatterns = logic.rules
    .filter((rule) => rule.learned && rule.status === "ACTIVE" && rule.weight > 0)
    .map((rule) => rule.patternId)
    .filter((id): id is string => Boolean(id));

  return {
    mode: input.mode,
    input: {
      text,
      request,
      language,
      format,
      intent,
      entities,
      facts: statements.facts,
      claims: statements.claims,
    },
    score: {
      original,
      improved,
      delta: improved.total - original.total,
      dimensions: baseDimensions,
    },
    analysis: {
      works: before.working,
      limits: before.limiting,
      why: [
        ...(request ? ["The user's requested outcome is being applied to this result."] : []),
        ...plan.filter((item) => item.action !== "KEEP").map((item) => `${item.target}: ${item.reason}`),
      ],
      risks: riskLines(text, intent),
      viral: [
        ...(activePatterns.length
          ? [`Active measured patterns: ${activePatterns.join(", ")}. They cannot change the facts.`]
          : ["No promoted viral pattern is active. Craft rules only."]),
        ...trendEvidence(text, input.trend, input.liveTrends),
      ],
    },
    plan,
    output: {
      text: finalText,
      kind: drafted.kind,
      keptOriginal: finalText === text,
      notes: accepted
        ? [`Editorial engine: ${EDITORIAL_ENGINE_VERSION}`, ...drafted.notes]
        : [
            !validated.ok ? "Rewrite failed factuality/language/promo validation. Original kept." : "",
            !editorialGate.pass ? `Editorial quality gate failed: ${editorialGate.violations.join(", ")}` : "",
            `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`,
            ...drafted.notes,
          ].filter(Boolean),
      source: validated.ok && input.proposed
        ? input.proposed.source === "deterministic" ? "deterministic" : "configured-llm"
        : (input.source ?? "deterministic"),
    },
    diff: diffLines(text, finalText),
    validation: {
      factsPreserved: validated.facts,
      numbersPreserved: validated.numbers,
      promoAdded: validated.promoAdded,
      languageKept: validated.language,
    },
    url: input.url ?? null,
  };
}

function applyMode(
  text: string,
  mode: EditorMode,
  kind: ContentKind,
  logic: ContentLogicVersion,
): { text: string; kind: ContentKind; notes: string[] } {
  if (!text || mode === "ANALYZE" || mode === "SCORE" || mode === "FACT_CHECK") {
    return { text, kind, notes: mode === "FACT_CHECK" ? ["Fact check only. No rewrite."] : ["Analysis only. No rewrite."] };
  }
  if (mode === "SHORTEN") return { text: shorten(text), kind, notes: ["Shorten keeps numbered sentences and drops template filler when present."] };
  if (mode === "EXPAND") {
    const expanded = text.includes("\n") ? text : text.replace(/(?<=[.!?])\s+/g, "\n\n");
    return {
      text: expanded,
      kind,
      notes: expanded === text ? ["No unused sentence was available to expand without adding a claim."] : ["Expanded only by separating sentences already in the draft."],
    };
  }
  const optimizeMode: OptimizeMode =
    mode === "MAKE_THREAD"
      ? "THREADIFY"
      : mode === "MAKE_ARTICLE"
        ? "ARTICLEIFY"
        : mode === "IMPROVE_HOOK"
          ? "HOOK_OPTIMIZE"
          : mode === "REWRITE"
            ? "REWRITE"
            : "SCORE_IMPROVE";
  const outKind = mode === "MAKE_POST" ? "post" : mode === "MAKE_THREAD" ? "thread" : mode === "MAKE_ARTICLE" ? "article" : kind;
  const result = optimizeContent({ text, kind: outKind, mode: optimizeMode, logic });
  const notes = mode === "IMPROVE_STRUCTURE"
    ? ["Structure pass uses the active craft rules. No new facts.", ...result.notes]
    : result.notes;
  return { text: result.text, kind: result.kind, notes };
}

function shorten(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return text;
  const kept = parts.filter((part, index) => index === 0 || /\d|https?:\/\//.test(part) || !AI_SLACK.test(part));
  const next = kept.join("\n\n");
  return preservesAuthorFacts(text, next) ? next : text;
}

function validate(before: string, after: string, language: DraftLanguage, requireEnglish = false): {
  ok: boolean;
  facts: boolean;
  numbers: boolean;
  promoAdded: boolean;
  language: boolean;
} {
  const beforeEntities = extractEntities(before);
  const afterEntities = extractEntities(after);
  const entitiesPreserved = (["tickers", "mentions", "urls", "addresses"] as const).every((key) =>
    beforeEntities[key].every((entity) => afterEntities[key].includes(entity)),
  );
  const facts = (!before.trim() || preservesAuthorFacts(before, after)) && entitiesPreserved;
  const numbers = (before.match(/\d+(?:[.,]\d+)?%?/g) ?? []).every((token) => token.length < 2 || after.includes(token));
  const promoAdded = !PROMO_RE.test(before) && PROMO_RE.test(after);
  const detectedOutputLanguage = detectLanguage(after);
  const languageKept = requireEnglish
    ? detectedOutputLanguage === "en" || detectedOutputLanguage === "und"
    : language === "und" || language === "en" || sharesLanguageToken(before, after, language);
  return { ok: facts && numbers && !promoAdded && languageKept, facts, numbers, promoAdded, language: languageKept };
}

function sharesLanguageToken(before: string, after: string, language: DraftLanguage): boolean {
  const needles = language === "it" ? [" che ", " non ", " per ", " una "] : language === "es" ? [" que ", " los ", " por "] : [" les ", " des ", " pour "];
  const source = ` ${before.toLowerCase()} `;
  const hit = needles.find((needle) => source.includes(needle));
  if (!hit) return true;
  return ` ${after.toLowerCase()} `.includes(hit);
}

function buildPlan(report: ContentScoreReport, text: string, claims: string[], request = ""): PlanItem[] {
  const items: PlanItem[] = [];
  let priority = 1;
  if (request) {
    items.push({
      action: "IMPROVE",
      target: "User request",
      reason: `Prioritize the requested outcome: ${request}`,
      expectedImpact: "high",
      priority: 0,
    });
  }
  for (const dimension of report.dimensions) {
    if (dimension.score >= 72) {
      items.push({
        action: "KEEP",
        target: dimension.label,
        reason: `${dimension.label} is ${dimension.score}. ${dimension.note}`,
        expectedImpact: "low",
        priority: priority++,
      });
    } else if (dimension.score < 65) {
      items.push({
        action: "IMPROVE",
        target: dimension.label,
        reason: `${dimension.label} is ${dimension.score}. ${dimension.note}`,
        expectedImpact: dimension.score < 50 ? "high" : "medium",
        priority: priority++,
      });
    }
  }
  if (AI_SLACK.test(text)) {
    items.push({
      action: "REMOVE",
      target: "Template phrase",
      reason: "A stock AI phrase is in the draft. Removing it does not remove a fact.",
      expectedImpact: "medium",
      priority: 1,
    });
  }
  if (report.signals.specificity < 60) {
    items.push({
      action: "VERIFY",
      target: "Specificity",
      reason: "Specificity is low. Do not insert a number, quote, or source that is not already in the draft.",
      expectedImpact: "high",
      priority: 1,
    });
  }
  if (!/\d/.test(text)) {
    items.push({
      action: "ADD",
      target: "Evidence",
      reason: "No number is in the draft. Add one only if the author already has it. Do not invent it.",
      expectedImpact: "medium",
      priority: 2,
    });
  }
  for (const claim of claims) {
    items.push({
      action: "VERIFY",
      target: "Claim",
      reason: `Unsupported unless the draft already proves it: ${claim}`,
      expectedImpact: "high",
      priority: 1,
    });
  }
  if (!items.length) {
    items.push({
      action: "KEEP",
      target: "Draft",
      reason: "No weak dimension cleared the change threshold.",
      expectedImpact: "low",
      priority: 1,
    });
  }
  return items.sort((a, b) => a.priority - b.priority).slice(0, 8);
}

function riskLines(text: string, intent: DraftIntent): string[] {
  const lines: string[] = [];
  if (/down\s+\d+(?:\.\d+)?%/i.test(text)) lines.push("FACT: the draft states a measured drawdown. That sentence stays a fact.");
  if (/possible rug pull/i.test(text)) lines.push("RISK SIGNAL: rug language in the draft is an inference unless the same text already says it is proven.");
  if (/confirmed rug|team stole/i.test(text)) lines.push("VERIFY: absolute rug or theft wording is a claim, not a market field.");
  if (intent === "market_caution") lines.push("Market read is cautious. Do not flip it into an opportunity.");
  if (intent === "market_positive") lines.push("Positive wording is only as strong as the move the draft already states.");
  if (!lines.length) lines.push("No market-risk phrase was detected in the draft.");
  return lines;
}

function toKind(mode: EditorMode, format: DraftFormat): ContentKind {
  if (mode === "MAKE_THREAD") return "thread";
  if (mode === "MAKE_ARTICLE") return "article";
  if (mode === "MAKE_POST") return "post";
  if (format === "thread") return "thread";
  if (format === "article") return "article";
  return "post";
}

function emptyReport(): ContentScoreReport {
  const scored = scoreContent(" ", "post");
  return { ...scored, total: 0, dimensions: scored.dimensions.map((dimension) => ({ ...dimension, score: 0 })) };
}

export const EDITOR_HANDOFF_KEY = "xpulse.editor.handoff";

export type EditorHandoff = {
  text: string;
  kind: ContentKind;
  token: {
    symbol: string;
    name: string;
    address: string;
    state: string | null;
    headline: string | null;
    rugLine: string | null;
  } | null;
  at: string;
};

export function parseEditorHandoff(raw: string | null): EditorHandoff | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<EditorHandoff>;
    if (typeof data.text !== "string" || !data.text.trim()) return null;
    const kind = data.kind === "thread" || data.kind === "article" ? data.kind : "post";
    const token = data.token;
    return {
      text: data.text,
      kind,
      token:
        token && typeof token.address === "string"
          ? {
              symbol: String(token.symbol ?? ""),
              name: String(token.name ?? ""),
              address: token.address,
              state: token.state ?? null,
              headline: token.headline ?? null,
              rugLine: token.rugLine ?? null,
            }
          : null,
      at: typeof data.at === "string" ? data.at : "",
    };
  } catch {
    return null;
  }
}


function trendMatchScore(text: string, trend?: ViralTrendVersion | null, liveTrends?: TrendSnapshot | null): number {
  let score = 50;
  if (trend?.patterns?.length) {
    const active = trend.patterns.filter((p) => p.status === "ACTIVE" && p.engagementLift != null);
    let matched = 0;
    for (const pattern of active) {
      const hit = pattern.patternId === "HOOK_QUESTION" ? /\?/.test(text.split(/\n+/)[0] ?? "")
        : pattern.patternId === "CONTRARIAN_PATTERN" ? /\b(nobody|most people|stop|wrong|don't|do not|hard truth)\b/i.test(text.split(/\n+/)[0] ?? "")
        : pattern.patternId === "DATA_PATTERN" ? /\d/.test(text)
        : pattern.patternId === "EDUCATIONAL_PATTERN" ? /\b(how to|here'?s|the reason|step \d)\b/i.test(text)
        : pattern.patternId === "STORY_PATTERN" ? /\b(i|we|yesterday|last week)\b/i.test(text) && /\b(then|after|when)\b/i.test(text)
        : pattern.patternId === "THREAD_PATTERN" ? /^\s*\d+\s*\//m.test(text)
        : pattern.patternId === "CTA_PATTERN" ? /\b(what do you|what's your|whats your|your read|reply if)\b/i.test(text)
        : pattern.patternId === "LENGTH_PATTERN" ? text.trim().split(/\s+/).length >= 12 && text.trim().split(/\s+/).length <= 45
        : pattern.patternId === "OPENING_PATTERN" ? /\d/.test(text.split(/\n+/)[0] ?? "")
        : pattern.patternId === "BREAKDOWN_PATTERN" ? /\n\s*(?:[-•]|\\d+\\.)\\s+\\S/.test(text)
        : pattern.patternId === "ARTICLE_PATTERN" ? /\n#{1,3}\\s+\\S/.test(text)
        : false;
      if (hit) matched += Math.max(1, Math.min(3, Math.round((pattern.engagementLift ?? 0) * 10)));
    }
    score += Math.min(28, matched * 4);
  }
  if (liveTrends?.items?.length) {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const item of liveTrends.items.slice(0, 12)) {
      const tokens = item.label.toLowerCase().replace(/[()]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.some((token) => lower.includes(token))) hits += 1;
    }
    score += Math.min(12, hits * 2);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function trendEvidence(text: string, trend?: ViralTrendVersion | null, liveTrends?: TrendSnapshot | null): string[] {
  const lines: string[] = [];
  if (trend) lines.push(`Trend memory ${trend.version} · confidence ${trend.confidence} · pace ${trend.pace}.`);
  const active = trend?.patterns?.filter((p) => p.status === "ACTIVE").slice(0, 4) ?? [];
  if (active.length) lines.push(`Measured active patterns available: ${active.map((p) => p.name).join(", ")}.`);
  if (liveTrends?.items?.length) lines.push(`Live public trend context refreshed ${liveTrends.fetchedAt}; topics are context, not invented claims.`);
  return lines;
}

function trendSummary(trend?: ViralTrendVersion | null, liveTrends?: TrendSnapshot | null) {
  return {
    version: trend?.version ?? "v1",
    confidence: trend?.confidence ?? "LOW",
    pace: trend?.pace ?? "insufficient",
    activePatterns: trend?.patterns?.filter((p) => p.status === "ACTIVE").map((p) => p.patternId).slice(0, 8) ?? [],
    topicLabels: (liveTrends?.web3Bias ?? trend?.topicLabels ?? []).slice(0, 8),
  };
}
