import { callLlm, parseJsonObject, type LlmResult } from "./llm-runtime.ts";
import { scoreContent, type ContentScoreReport } from "./content-score.ts";
import type { EditorDossier } from "./editor/pipeline.ts";
import { memoryPromptContext } from "./memory.ts";
import { detectEcho } from "./echo-detector.ts";

export type AiSuggestion = {
  id: string;
  position: string;
  problem: string;
  correction: string;
  criterion: string;
};

export type AiAnalysis = {
  summary: string;
  motivations: Array<{ criterion: string; score: number; reason: string }>;
  strengths: string[];
  weaknesses: string[];
  suggestions: AiSuggestion[];
  trace: { provider: string; model: string; durationMs: number; attempt: number };
};

export type AiRevision = {
  text: string;
  changed: Array<{ id: string; before: string; after: string; reason: string }>;
  trace: AiAnalysis["trace"];
};

function stringArray(value: unknown, max = 8): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim()).slice(0, max)
    : [];
}

function validateAnalysis(raw: string): boolean {
  const obj = parseJsonObject(raw);
  if (!obj) return false;
  return typeof obj.summary === "string" &&
    Array.isArray(obj.motivations) &&
    Array.isArray(obj.strengths) &&
    Array.isArray(obj.weaknesses) &&
    Array.isArray(obj.suggestions);
}

function parseAnalysis(raw: string, report: ContentScoreReport, trace: LlmResult["trace"]): AiAnalysis | null {
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj.summary !== "string") return null;
  const deterministic = new Map(report.dimensions.map((d) => [d.key, d]));
  const motivations = Array.isArray(obj.motivations)
    ? obj.motivations.map((item) => item as Record<string, unknown>).flatMap((item) => {
        const criterion = typeof item.criterion === "string" ? item.criterion : "";
        const dimension = deterministic.get(criterion);
        const score = dimension?.score ?? null;
        const reason = typeof item.reason === "string" ? item.reason.trim() : "";
        if (!criterion || !dimension || score == null || !reason) return [];
        return [{ criterion, score, reason: reason.slice(0, 500) }];
      }).slice(0, 12)
    : [];
  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions.map((item, index) => item as Record<string, unknown>).flatMap((item, index) => {
        const position = typeof item.position === "string" ? item.position : "";
        const problem = typeof item.problem === "string" ? item.problem : "";
        const correction = typeof item.correction === "string" ? item.correction : "";
        const criterion = typeof item.criterion === "string" ? item.criterion : "";
        if (!problem || !correction || !criterion) return [];
        return [{
          id: typeof item.id === "string" ? item.id : `suggestion-${index + 1}`,
          position: position.slice(0, 160),
          problem: problem.slice(0, 500),
          correction: correction.slice(0, 700),
          criterion: criterion.slice(0, 120),
        }];
      }).slice(0, 10)
    : [];
  return {
    summary: obj.summary.trim().slice(0, 900),
    motivations,
    strengths: stringArray(obj.strengths),
    weaknesses: stringArray(obj.weaknesses),
    suggestions,
    trace: {
      provider: trace.provider,
      model: trace.model,
      durationMs: trace.durationMs,
      attempt: trace.attempt,
    },
  };
}

function factsPayload(dossier: EditorDossier) {
  return {
    text: dossier.input.text,
    language: dossier.input.language,
    format: dossier.input.format,
    intent: dossier.input.intent,
    facts: dossier.input.facts.slice(0, 20),
    claims: dossier.input.claims.slice(0, 20),
    scores: dossier.score.original,
    deterministicAnalysis: dossier.analysis,
    plan: dossier.plan,
  };
}

export async function analyzeWithLlm(dossier: EditorDossier): Promise<AiAnalysis | null> {
  const report = scoreContent(dossier.input.text, dossier.output.kind);
  const result = await callLlm(
    [
      {
        role: "system",
        content: [
          "You are XPulse's analysis explainer, not its scoring engine.",
          "All numeric scores below are authoritative and deterministic. Never change them.",
          "Explain why each score makes sense using only the supplied text, facts, claims, database-derived plan and rules.",
          "Return JSON only with: summary, motivations[{criterion,score,reason}], strengths[], weaknesses[], suggestions[{id,position,problem,correction,criterion}].",
          "Suggestions must be concrete edits, not generic advice. Never invent facts or numbers.",
          "The purpose is to identify changes that materially improve the draft. Do not suggest keeping the text unchanged.",
          "Keep every reason under 500 characters and every correction under 700 characters.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({ ...factsPayload(dossier), memory: memoryPromptContext(dossier.input.text, dossier.output.kind) }),
      },
    ],
    {
      json: true,
      temperature: 0.25,
      maxTokens: 1800,
      validate: (raw) => validateAnalysis(raw),
      repairPrompt: "Return valid JSON matching the exact requested schema. Do not change deterministic scores and do not add unsupported facts.",
      maxAttempts: 2,
    },
  );
  return result ? parseAnalysis(result.text, report, result.trace) : null;
}

export async function suggestWithLlm(dossier: EditorDossier): Promise<AiSuggestion[] | null> {
  const analysis = await analyzeWithLlm(dossier);
  return analysis?.suggestions ?? null;
}

function validateRevision(raw: string, maxLength: number): boolean {
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj.text !== "string" || obj.text.trim().length < 1) return false;
  if (obj.text.length > maxLength) return false;
  return Array.isArray(obj.changed);
}

export async function reviseWithLlm(
  dossier: EditorDossier,
  selected: AiSuggestion[],
): Promise<AiRevision | null> {
  if (!selected.length) return null;
  const maxLength = dossier.output.kind === "thread" ? 4000 : dossier.output.kind === "article" ? 16000 : 4000;
  const result = await callLlm(
    [
      {
        role: "system",
        content: [
          "You are XPulse's revision writer.",
          "TRANSFORM THE DRAFT. Do not return it verbatim. Apply the selected interventions and make every selected change visible in changed[].",
          "Apply ONLY the selected interventions to the supplied draft.",
          "Preserve all facts, numbers, names, URLs, tickers and meaning.",
          "Return JSON only: {text:string,changed:[{id,before,after,reason}]}",
          "Do not invent or delete factual claims. If an intervention would require a new fact, leave that intervention unapplied.",
          "Respect format: " + dossier.output.kind,
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({ draft: dossier.output.text || dossier.input.text, selected, memory: memoryPromptContext(dossier.output.text || dossier.input.text, dossier.output.kind) }),
      },
    ],
    {
      json: true,
      temperature: 0.35,
      maxTokens: dossier.output.kind === "article" ? 3000 : 1800,
      validate: (raw) => validateRevision(raw, maxLength),
      repairPrompt: "Return only valid JSON with text and changed[]. Apply only selected interventions and preserve all factual content.",
      maxAttempts: 2,
    },
  );
  if (!result) return null;
  const obj = parseJsonObject(result.text);
  if (!obj || typeof obj.text !== "string" || !Array.isArray(obj.changed)) return null;
  const sourceText = dossier.output.text || dossier.input.text;
  if (detectEcho(sourceText, obj.text).isEcho) return null;
  const changed = obj.changed.flatMap((item) => {
    const row = item as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.before === "string" && typeof row.after === "string" && typeof row.reason === "string"
      ? [{ id: row.id, before: row.before, after: row.after, reason: row.reason }]
      : [];
  }).slice(0, selected.length);
  return {
    text: obj.text.trim(),
    changed,
    trace: {
      provider: result.trace.provider,
      model: result.trace.model,
      durationMs: result.trace.durationMs,
      attempt: result.trace.attempt,
    },
  };
}
