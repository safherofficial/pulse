/**
 * Format-specific composition. Transforms may only rearrange or delete
 * template noise. They never add a metric, a bullish claim, or a CTA.
 */

import { scoreContent, type ContentKind, type ContentScoreReport } from "../content-score.ts";
import { preservesAuthorFacts } from "./benchmarks.ts";
import type { ContentFormat, ContentLogicVersion, ContentRule, OptimizeMode } from "./types.ts";

export type DimensionDelta = {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
};

export type CompositionResult = {
  text: string;
  kind: ContentFormat;
  mode: OptimizeMode;
  originalScore: number;
  optimizedScore: number;
  scoreDelta: number;
  keptOriginal: boolean;
  dimensionDeltas: DimensionDelta[];
  appliedRuleIds: string[];
  notes: string[];
  before: ContentScoreReport;
  after: ContentScoreReport;
};

const AI_SLACK =
  /\b(in today's rapidly evolving(?: landscape)?|it's important to note that|it is important to note that|significant milestone|the future is here|game[- ]?changer|revolutionary|buckle up|delve into|leverage synergies|unlock the potential|as an ai|in conclusion)\b[, ]*/gi;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstLine(text: string): string {
  return text.split(/\n+/)[0]?.trim() ?? "";
}

function downsideLocked(text: string): boolean {
  const line = firstLine(text);
  return /down\s+\d|not a bullish|severe|rug pull|weakening/i.test(line);
}

function activeRules(rules: ContentRule[], kind: ContentFormat): ContentRule[] {
  return rules.filter((rule) => rule.status === "ACTIVE" && rule.weight > 0 && rule.appliesTo.includes(kind));
}

function stripAi(text: string): string {
  return text
    .replace(AI_SLACK, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dropLabels(text: string): string {
  return text
    .replace(/^(hook|context|insight|summary|implication|introduction)\s*:\s*/gim, "")
    .trim();
}

function breakParagraphs(text: string): string {
  if (text.includes("\n")) return text;
  const parts = sentencesOf(text);
  if (parts.length < 2) return text;
  return parts.join("\n\n");
}

function numberBeats(text: string): string {
  if (/^\s*1\s*\//m.test(text)) return text;
  const parts = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const beats = parts.length >= 3 ? parts : sentencesOf(text);
  if (beats.length < 2) return text;
  return beats
    .slice(0, 8)
    .map((beat, index) => `${index + 1}/ ${beat.replace(/^\d+\s*[/.)-]\s*/, "")}`)
    .join("\n\n");
}

function moveSentence(text: string, predicate: (sentence: string) => boolean): string {
  if (downsideLocked(text)) return text;
  const blocks = text.split(/\n\n/).map((part) => part.trim()).filter(Boolean);
  const units = blocks.length > 1 ? blocks : sentencesOf(text);
  if (units.length < 2) return text;
  const index = units.findIndex((unit, i) => i > 0 && predicate(unit));
  if (index <= 0) return text;
  const [picked] = units.splice(index, 1);
  if (!picked) return text;
  return [picked, ...units].join("\n\n");
}

function applyLever(text: string, lever: string, kind: ContentFormat, mode: OptimizeMode): string {
  if (lever === "strip_ai_slack") return stripAi(text);
  if (lever === "drop_outline_labels") return dropLabels(text);
  if (lever === "break_paragraphs" && kind !== "thread") return breakParagraphs(text);
  if (lever === "number_thread_beats" && (kind === "thread" || mode === "THREADIFY")) return numberBeats(text);
  if (lever === "surface_existing_question") {
    return moveSentence(text, (sentence) => sentence.includes("?"));
  }
  if (lever === "surface_existing_number") {
    if (/\d/.test(firstLine(text))) return text;
    return moveSentence(text, (sentence) => /\d/.test(sentence));
  }
  if (lever === "article_hierarchy" && kind === "article") return breakParagraphs(text);
  if (lever === "add_observed_hashtag") {
    if (/(^|\s)#\w+/.test(text)) return text;
    return `${text}\n\n#update`;
  }
  return text;
}

function bestExistingOrder(text: string, kind: ContentFormat, scoreWeights?: Record<string, number>, typeMultiplier = 1): string {
  const parts = sentencesOf(text);
  if (parts.length < 2 || parts.length > 12) return text;
  const originalScore = scoreContent(text, kind as ContentKind, scoreWeights, typeMultiplier).total;
  let best = text;
  let bestScore = originalScore;
  for (let i = 0; i < parts.length; i += 1) {
    const candidate = [parts[i], ...parts.filter((_, index) => index !== i)].join("\n\n");
    const score = scoreContent(candidate, kind as ContentKind, scoreWeights, typeMultiplier).total;
    if (score > bestScore && preservesAuthorFacts(text, candidate)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function articleify(text: string): string {
  const parts = sentencesOf(dropLabels(stripAi(text)));
  if (parts.length < 2) return text.trim();
  const [headline, ...rest] = parts;
  return [`${headline}`, "", "What the draft already says", "", rest.join("\n\n")].join("\n");
}

export function isAlreadyStrong(report: ContentScoreReport): boolean {
  return report.total >= 80;
}

export function dimensionDeltas(before: ContentScoreReport, after: ContentScoreReport): DimensionDelta[] {
  return before.dimensions
    .map((dimension) => {
      const next = after.dimensions.find((item) => item.key === dimension.key);
      const afterScore = next?.score ?? dimension.score;
      return {
        key: dimension.key,
        label: dimension.label,
        before: dimension.score,
        after: afterScore,
        delta: afterScore - dimension.score,
      };
    })
    .filter((row) => row.delta !== 0);
}

export function composeWithRules(
  text: string,
  kind: ContentFormat,
  rules: ContentRule[],
  mode: OptimizeMode,
  commit: "measure" | "keep_best",
  requiredPhrases: string[] = [],
  scoreWeights?: Record<string, number>,
  typeMultiplier = 1,
): CompositionResult {
  const before = scoreContent(text, kind as ContentKind, scoreWeights, typeMultiplier);
  const notes: string[] = [];
  let next = text.trim();
  const applied: string[] = [];

  const preserveStrong =
    commit === "keep_best" &&
    (mode === "SCORE_IMPROVE" || mode === "OPTIMIZE" || mode === "REWRITE" || mode === "HOOK_OPTIMIZE" || mode === "GENERATE") &&
    isAlreadyStrong(before);

  if (!preserveStrong) {
    const selected = activeRules(rules, mode === "THREADIFY" ? "thread" : mode === "ARTICLEIFY" ? "article" : kind);
    const levers =
      mode === "HOOK_OPTIMIZE"
        ? selected.filter((rule) => rule.lever === "surface_existing_question" || rule.lever === "surface_existing_number" || rule.lever === "drop_outline_labels")
        : mode === "THREADIFY"
          ? selected.filter((rule) => rule.appliesTo.includes("thread") || rule.lever === "number_thread_beats" || rule.lever === "strip_ai_slack" || rule.lever === "drop_outline_labels")
          : selected;
    if (mode === "THREADIFY" && !levers.some((rule) => rule.lever === "number_thread_beats")) {
      next = numberBeats(dropLabels(stripAi(next)));
      applied.push("mode:THREADIFY");
    }
    for (const rule of levers) {
      const updated = applyLever(next, rule.lever, mode === "THREADIFY" ? "thread" : kind, mode);
      if (updated !== next) {
        next = updated;
        applied.push(rule.ruleId);
      }
    }
    if (["SCORE_IMPROVE", "OPTIMIZE", "REWRITE", "HOOK_OPTIMIZE"].includes(mode)) {
      const reordered = bestExistingOrder(next, kind, scoreWeights, typeMultiplier);
      if (reordered !== next) {
        next = reordered;
        applied.push("optimize:existing-order");
      }
    }
    if (mode === "ARTICLEIFY") {
      const formatted = articleify(next);
      if (formatted !== next) {
        next = formatted;
        applied.push("mode:ARTICLEIFY");
      }
    }
  } else {
    notes.push("Already strong. Original wording kept.");
  }

  const phrasesHeld = requiredPhrases.every((phrase) => !phrase || next.includes(phrase));
  const preserved = preservesAuthorFacts(text, next) && phrasesHeld;
  let committed = next;
  if (commit === "keep_best") {
    const trialKind = (mode === "THREADIFY" ? "thread" : mode === "ARTICLEIFY" ? "article" : kind) as ContentKind;
    const trial = scoreContent(next, trialKind, scoreWeights, typeMultiplier);
    if (!preserved || trial.total < before.total) {
      committed = text.trim();
      if (!preserved) notes.push("Edit dropped a fact or required line. Original kept.");
      else if (trial.total < before.total) notes.push("Edit lowered the score. Original kept.");
    }
  } else if (!preserved) {
    notes.push("Measured edit does not preserve the author's facts.");
  }

  const outKind: ContentFormat = mode === "THREADIFY" ? "thread" : mode === "ARTICLEIFY" ? "article" : kind;
  const after = scoreContent(committed, outKind, scoreWeights, typeMultiplier);
  const deltas = dimensionDeltas(before, after);
  for (const delta of deltas) notes.push(`${delta.label} ${delta.delta > 0 ? "+" : ""}${delta.delta}`);
  return {
    text: committed,
    kind: outKind,
    mode,
    originalScore: before.total,
    optimizedScore: after.total,
    scoreDelta: after.total - before.total,
    keptOriginal: committed === text.trim(),
    dimensionDeltas: deltas,
    appliedRuleIds: committed === text.trim() ? [] : applied,
    notes,
    before,
    after,
  };
}

export function optimizeContent(input: {
  text: string;
  kind: ContentFormat;
  mode: OptimizeMode;
  logic: ContentLogicVersion;
  requiredPhrases?: string[];
}): CompositionResult {
  return composeWithRules(
    input.text,
    input.kind,
    input.logic.rules,
    input.mode,
    "keep_best",
    input.requiredPhrases ?? [],
    input.logic.scoreWeights,
    input.logic.scoreTypeMultipliers?.[input.kind] ?? 1,
  );
}

export function measureRules(
  text: string,
  kind: ContentFormat,
  rules: ContentRule[],
): CompositionResult {
  return composeWithRules(text, kind, rules, "SCORE_IMPROVE", "measure");
}
