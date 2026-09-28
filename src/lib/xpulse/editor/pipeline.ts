/**
 * Editorial pipeline. Score numbers come from scoreContent.
 * Rewrites may rearrange or delete template noise. They do not add facts.
 */

import { scoreContent, type ContentKind, type ContentScoreReport } from "../content-score.ts";
import { baselineContent } from "../optimize/baseline.ts";
import { preservesAuthorFacts, PROMO_RE } from "../optimize/benchmarks.ts";
import { isAlreadyStrong, optimizeContent } from "../optimize/compose.ts";
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

export function namedScore(report: ContentScoreReport): NamedScore {
  const dim = (key: string) => report.dimensions.find((item) => item.key === key)?.score ?? null;
  const score = (key: string) => report.dimensions.find((item) => item.key === key)?.score ?? 0;
  const viral = Math.round(
    score("hook") * 0.3 +
    score("curiosity") * 0.25 +
    score("shareability") * 0.25 +
    score("emotion") * 0.1 +
    score("structure") * 0.1,
  );
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
}): EditorDossier {
  const text = normalizeDraft(input.text);
  const request = (input.request ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
  const language = detectLanguage(text);
  const format = detectFormat(text, input.kind === "headline" || input.kind === "note" ? null : input.kind);
  const kind = toKind(input.mode, format);
  const intent = detectIntent(text);
  const entities = extractEntities(text);
  const statements = extractStatements(text);
  const before = text ? scoreContent(text, kind) : emptyReport();
  const plan = buildPlan(before, text, statements.claims, request);
  const logic = input.logic ?? baselineContent();
  const drafted = input.proposed?.text.trim()
    ? {
        text: normalizeDraft(input.proposed.text),
        kind,
        notes: [`Configured model ${input.proposed.source}. Critic still checks facts, numbers, language, and promo wording.`],
      }
    : applyMode(text, input.mode, kind, logic);
  const validated = validate(text, drafted.text, language);
  const finalText = validated.ok ? drafted.text : text;
  const after = scoreContent(finalText, drafted.kind);
  const original = namedScore(before);
  const improved = namedScore(after);
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
      dimensions: before.dimensions.map((dimension) => {
        const next = after.dimensions.find((item) => item.key === dimension.key)?.score ?? dimension.score;
        return {
          key: dimension.key,
          label: dimension.label,
          before: dimension.score,
          after: next,
          delta: next - dimension.score,
        };
      }),
    },
    analysis: {
      works: before.working,
      limits: before.limiting,
      why: [
        ...(request ? [`User request: ${request}`] : []),
        ...plan.filter((item) => item.action !== "KEEP").map((item) => `${item.target}: ${item.reason}`),
      ],
      risks: riskLines(text, intent),
      viral: activePatterns.length
        ? [`Active measured patterns: ${activePatterns.join(", ")}. They cannot change the facts.`]
        : ["No promoted viral pattern is active. Craft rules only."],
    },
    plan,
    output: {
      text: finalText,
      kind: drafted.kind,
      keptOriginal: finalText === text,
      notes: validated.ok
        ? drafted.notes
        : ["Rewrite dropped a fact, a number, the author's language, or added promo wording. Original kept.", ...drafted.notes],
      source: validated.ok && input.proposed ? "configured-llm" : (input.source ?? "deterministic"),
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

function validate(before: string, after: string, language: DraftLanguage): {
  ok: boolean;
  facts: boolean;
  numbers: boolean;
  promoAdded: boolean;
  language: boolean;
} {
  const facts = !before.trim() || preservesAuthorFacts(before, after);
  const numbers = (before.match(/\d+(?:[.,]\d+)?%?/g) ?? []).every((token) => token.length < 2 || after.includes(token));
  const promoAdded = !PROMO_RE.test(before) && PROMO_RE.test(after);
  const languageKept = language === "und" || language === "en" || sharesLanguageToken(before, after, language);
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
