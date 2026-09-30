/**
 * Editor server path.
 * Analyzer + strategist: runEditorPipeline (scoreContent, entities, plan).
 * Writer: one configured model (Groq, OpenRouter, or Gemini) when a key exists.
 * Critic: fact, number, language, and promo checks. A failed critic reverts.
 * Scorer: compare baseline vs candidates across craft, repetition, integrity, and intent dimensions.
 * Public Pollinations and LLM7 are not called from this path.
 */

import { baselineContent } from "../optimize/baseline.ts";
import type { ContentLogicVersion } from "../optimize/types.ts";
import { extractPublicXPostId, resolvePublicXPost } from "../x-public.ts";
import { isEditorMode, runEditorPipeline, type EditorDossier, type EditorMode } from "./pipeline.ts";
import { classifyUrl, extractPublicPage, type UrlExtraction } from "./url.ts";
import { getTrendSnapshot } from "../trends.ts";
import { loadMemory, memoryPromptContext } from "../memory.ts";
import { detectEcho } from "../echo-detector.ts";

const ANALYSIS_CACHE = new Map<string, { at: number; value: EditorDossier }>();
const TTL_MS = 5 * 60 * 1000;

type Rewrite = (input: {
  text: string;
  mode: string;
  kind: "post" | "thread" | "article";
  language: string;
  plan: string[];
  request?: string;
  attempt?: number;
  strategy?: string;
  optimizationTargets?: string[];
  repair?: string;
}) => Promise<{ text: string; source: string } | null>;

export type EditorRequest = {
  text?: string;
  url?: string;
  mode?: unknown;
  kind?: "post" | "thread" | "article" | null;
  request?: string;
};

export type EditorDeps = {
  loadLogic?: () => Promise<ContentLogicVersion>;
  fetchImpl?: typeof fetch;
  rewrite?: Rewrite | null;
  polish?: (text: string) => Promise<{ text: string; notes: string[] }>;
  performanceContext?: string;
  resolveX?: (url: string) => Promise<{ text: string; title: string | null }>;
};

export function clearEditorCache(): void {
  ANALYSIS_CACHE.clear();
}

export function splitEditorInput(text: string, urlField: string): { text: string; url: string } {
  const url = urlField.trim();
  const body = text.trim();
  if (url) return { text: body, url };
  if (body && !body.includes(" ") && !body.includes("\n") && classifyUrl(body)) return { text: "", url: body };
  return { text: body, url: "" };
}

export async function readEditorUrl(
  input: string,
  deps: Pick<EditorDeps, "fetchImpl" | "resolveX"> = {},
): Promise<UrlExtraction> {
  const classified = classifyUrl(input);
  if (!classified) {
    return { url: input.trim(), kind: "invalid", status: "invalid", title: null, text: null, reason: "Not a usable URL." };
  }
  if (classified.kind === "x" && extractPublicXPostId(classified.url)) {
    try {
      const post = deps.resolveX
        ? await deps.resolveX(classified.url)
        : await resolvePublicXPost(classified.url).then((row) => ({
            text: row.text,
            title: row.authorUsername ? `@${row.authorUsername}` : null,
          }));
      if (!post.text?.trim()) {
        return {
          url: classified.url,
          kind: "x",
          status: "unavailable",
          title: null,
          text: null,
          reason: "The public post had no text. Paste it.",
        };
      }
      return {
        url: classified.url,
        kind: "x",
        status: "extracted",
        title: post.title,
        text: post.text.trim(),
        reason: null,
      };
    } catch (error) {
      return {
        url: classified.url,
        kind: "x",
        status: "unavailable",
        title: null,
        text: null,
        reason: error instanceof Error ? error.message : "X post could not be read. Paste the text.",
      };
    }
  }
  return extractPublicPage(classified.url, deps.fetchImpl ?? fetch);
}

async function defaultLogic(): Promise<ContentLogicVersion> {
  try {
    const { loadActiveContentLogic } = await import("../optimize/store.ts");
    const active = await loadActiveContentLogic();
    const memory = loadMemory();
    return { ...active, scoreWeights: active.scoreWeights ?? memory.weights.criteria, scoreTypeMultipliers: active.scoreTypeMultipliers ?? memory.weights.contentTypes };
  } catch {
    return baselineContent();
  }
}

function cacheGet(key: string): EditorDossier | null {
  const hit = ANALYSIS_CACHE.get(key);
  if (!hit || Date.now() - hit.at >= TTL_MS) return null;
  return hit.value;
}

function cacheSet(key: string, value: EditorDossier): EditorDossier {
  ANALYSIS_CACHE.set(key, { at: Date.now(), value });
  return value;
}
function normalizeRequest(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
}

function resolveRequestMode(value: string | undefined): EditorMode {
  const request = normalizeRequest(value).toLowerCase();
  if (!request) return "ANALYZE";
  if (/\b(thread|threadify|threaded)\b/.test(request)) return "MAKE_THREAD";
  if (/\b(article|long[- ]form)\b/.test(request)) return "MAKE_ARTICLE";
  if (/\b(hook|opening|first line|stop the scroll)\b/.test(request)) return "IMPROVE_HOOK";
  if (/\b(structure|flow|order|organize)\b/.test(request)) return "IMPROVE_STRUCTURE";
  if (/\b(fact[- ]?check|verify|claims|credib)\b/.test(request)) return "FACT_CHECK";
  if (/\b(score|rate|grade)\b/.test(request)) return "SCORE";
  if (/\b(shorten|shorter|concise|cut)\b/.test(request)) return "SHORTEN";
  if (/\b(expand|longer|develop)\b/.test(request)) return "EXPAND";
  if (/\b(rewrite|rephrase|redraft)\b/.test(request)) return "REWRITE";
  if (/\b(improve|better|fix|weakness|stronger)\b/.test(request)) return "IMPROVE";
  if (/\b(post|tweet)\b/.test(request)) return "MAKE_POST";
  return "ANALYZE";
}


async function loadActiveViralTrend() {
  try {
    const { loadActiveViralTrend: load } = await import("../optimize/store.ts");
    return await load();
  } catch {
    const { baselineTrend } = await import("../optimize/baseline.ts");
    return baselineTrend();
  }
}

export async function executeEditor(input: EditorRequest, deps: EditorDeps = {}): Promise<EditorDossier> {
  const requestedMode = resolveRequestMode(input.request);
  const mode: EditorMode = isEditorMode(input.mode) && input.mode !== "ANALYZE" ? input.mode : requestedMode;
  const request = normalizeRequest(input.request);
  const kind = input.kind === "thread" || input.kind === "article" || input.kind === "post" ? input.kind : null;
  const split = splitEditorInput(input.text ?? "", input.url ?? "");
  let text = split.text;
  let urlResult: UrlExtraction | null = null;
  if (split.url) {
    urlResult = await readEditorUrl(split.url, deps);
    if (!text && urlResult.text) text = urlResult.text;
  }
  const [logic, trend, liveTrends] = await Promise.all([
    (deps.loadLogic ?? defaultLogic)(),
    loadActiveViralTrend(),
    getTrendSnapshot().catch(() => null),
  ]);
  let effectiveLogic = logic;
  let deterministic: EditorDossier;
  try {
    deterministic = runEditorPipeline({ text, mode, kind, request, logic: effectiveLogic, url: urlResult, trend, liveTrends });
  } catch {
    effectiveLogic = baselineContent();
    deterministic = runEditorPipeline({ text, mode, kind, request, logic: effectiveLogic, url: urlResult, trend, liveTrends });
  }

  const cacheKey = JSON.stringify({
    mode,
    kind,
    request,
    version: effectiveLogic.version,
    text,
    url: urlResult?.status ?? null,
    body: urlResult?.text ?? null,
  });
  const cacheableAnalysis = mode === "ANALYZE" || mode === "SCORE" || mode === "FACT_CHECK";
  const cached = cacheableAnalysis ? cacheGet(cacheKey) : null;
  if (cached) return cached;

  if (text.trim() && (mode === "ANALYZE" || mode === "SCORE" || mode === "FACT_CHECK")) {
    try {
      const { analyzeWithLlm } = await import("../editor-llm.ts");
      const ai = await analyzeWithLlm(deterministic);
      if (ai) {
        deterministic.analysis = {
          ...deterministic.analysis,
          ai,
          why: [...deterministic.analysis.why, ai.summary],
        };
        deterministic.output.notes = [
          ...deterministic.output.notes,
          `AI analysis: ${ai.trace.provider} / ${ai.trace.model} / ${ai.trace.durationMs}ms`,
        ];
      } else {
        deterministic.output.notes = [
          ...deterministic.output.notes,
          "AI analysis unavailable: deterministic scoring and rule analysis retained.",
        ];
      }
    } catch {
      deterministic.output.notes = [
        ...deterministic.output.notes,
        "AI analysis failed: deterministic scoring and rule analysis retained.",
      ];
    }
  }
  const rewriteMode = mode !== "ANALYZE" && mode !== "SCORE" && mode !== "FACT_CHECK";
  const writer: Rewrite | null =
    deps.rewrite === undefined
      ? async (payload) => {
          const { rewriteWithConfiguredModel } = await import("../content-improve.ts");
          return rewriteWithConfiguredModel(payload);
        }
      : deps.rewrite;
  if (!rewriteMode || !text.trim() || !writer) return cacheSet(cacheKey, deterministic);

  let memoryContext = "";
  try {
    memoryContext = memoryPromptContext(text, deterministic.output.kind);
  } catch {
    // Optional enrichment must never block rewriting.
  }
  const plans = [
    ...deterministic.plan.map((item) => `${item.action} ${item.target}: ${item.reason}`),
    memoryContext,
    deps.performanceContext ?? "",
  ].filter(Boolean);
  const candidates: EditorDossier[] = [];
  const optimizationTargets = deterministic.score.dimensions
    .filter((dimension) => dimension.score < 72)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((dimension) => dimension.label);
  const strategies = [
    "HOOK OPTIMIZATION: rebuild the opening around the strongest concrete tension, specificity, or unanswered question. Do not change facts.",
    "INFORMATION COMPRESSION: remove filler and repetition, strengthen verbs, compress the signal, and make every sentence carry useful information.",
    "EMOTIONAL RESONANCE: make the human stakes, consequence, tension, or relevance clearer using only implications already supported by the source. Do not fabricate emotion.",
    "SHAREABILITY: craft one memorable, quotable insight and a useful payoff. Increase discussion value without adding claims or engagement bait.",
    "STRUCTURAL REWRITE: change the architecture materially into hook → context → insight → tension/implication → payoff. Do not merely paraphrase.",
    "WEB3-NATIVE EDITORIAL: use natural Web3-native language where appropriate, remove corporate/AI filler and fake hype, and keep the source's factual posture.",
  ];
  const targetLine = optimizationTargets.length
    ? `PRIMARY OPTIMIZATION TARGETS (weakest first): ${optimizationTargets.join(", ")}.`
    : "PRIMARY OPTIMIZATION TARGETS: improve the weakest measurable craft signals without changing facts.";
  const candidateAttempts = strategies.length;

  const evaluateCandidate = async (
    proposed: string,
    source: string,
    attempt: number,
    strategy: string,
    repair?: string,
  ): Promise<EditorDossier | null> => {
    const echo = detectEcho(text, proposed);
    if (echo.isEcho) {
      deterministic.output.notes = [...deterministic.output.notes, `LLM echo rejected: ${echo.combinedSimilarity.toFixed(3)} similarity (attempt ${attempt}).`];
      return null;
    }
    const trial = runEditorPipeline({
      text,
      mode,
      kind,
      request,
      logic: effectiveLogic,
      url: urlResult,
      proposed: { text: proposed, source },
      trend,
      liveTrends,
    });
    if (!trial.output.keptOriginal && trial.validation.factsPreserved && trial.validation.numbersPreserved && trial.validation.languageKept && !trial.validation.promoAdded) {
      trial.output.notes = [...trial.output.notes, `Optimization strategy: ${strategy}`, repair ? `Targeted repair: ${repair}` : targetLine];
      candidates.push(trial);
      return trial;
    }
    return null;
  };

  for (let attempt = 1; attempt <= candidateAttempts; attempt += 1) {
    const strategy = strategies[attempt - 1]!;
    let candidate: { text: string; source: string } | null = null;
    try {
      candidate = await writer({
        text,
        mode,
        kind: deterministic.output.kind,
        language: deterministic.input.language,
        request,
        plan: [...plans, targetLine, strategy],
        attempt,
        strategy,
        optimizationTargets,
      });
    } catch {
      candidate = null;
    }
    if (!candidate?.text.trim()) continue;
    let proposed = candidate.text;
    try {
      const polish = deps.polish ?? (async (value: string) => {
        const { polishDraft } = await import("../content-improve.ts");
        return polishDraft(value);
      });
      const polished = await polish(proposed);
      if (polished.text.trim()) proposed = polished.text;
    } catch {
      /* polishing is optional */
    }
    await evaluateCandidate(proposed, candidate.source, attempt, strategy);
  }

  const originalScore = deterministic.score.original.total;
  const originalViral = deterministic.score.original.viral;
  const targetKeys = deterministic.score.dimensions
    .filter((dimension) => optimizationTargets.includes(dimension.label))
    .map((dimension) => dimension.key);
  const targetGain = (candidate: EditorDossier) => targetKeys.reduce((sum, key) => {
    const dimension = candidate.score.dimensions.find((item) => item.key === key);
    return sum + Math.max(0, dimension?.delta ?? 0);
  }, 0);
  const materiallyImproved = (candidate: EditorDossier) =>
    !candidate.output.keptOriginal &&
    candidate.score.dimensions.some((dimension) => dimension.delta > 0) &&
    (targetKeys.length === 0 || targetGain(candidate) > 0);

  let acceptedBest = candidates
    .filter(materiallyImproved)
    .sort((a, b) => {
      const aGain = targetGain(a);
      const bGain = targetGain(b);
      return (bGain - aGain) ||
        ((b.score.improved.total - originalScore) - (a.score.improved.total - originalScore)) ||
        ((b.score.improved.viral - originalViral) - (a.score.improved.viral - originalViral));
    })[0];

  if (!acceptedBest && candidates.length) {
    let repairBase = [...candidates].sort((a, b) => b.score.improved.total - a.score.improved.total)[0]!;
    for (let repairRound = 1; repairRound <= 2 && !acceptedBest; repairRound += 1) {
      const weakRepairTargets = repairBase.score.dimensions
        .filter((dimension) => dimension.score < 78)
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
        .map((dimension) => dimension.label);
      const repair = weakRepairTargets.length
        ? `Repair only these weak dimensions: ${weakRepairTargets.join(", ")}. Preserve every fact, number, name, ticker, URL and meaning. Make a material editorial change, not a paraphrase.`
        : "Repair the weakest remaining craft signal and make the wording materially sharper without adding facts.";
      let repaired: { text: string; source: string } | null = null;
      try {
        repaired = await writer({
          text: repairBase.output.text,
          mode,
          kind: repairBase.output.kind,
          language: deterministic.input.language,
          request,
          plan: [...plans, targetLine, repair],
          attempt: candidateAttempts + repairRound,
          strategy: "TARGETED REPAIR",
          optimizationTargets: weakRepairTargets,
          repair,
        });
      } catch {
        repaired = null;
      }
      if (!repaired?.text.trim()) continue;
      let repairedText = repaired.text;
      try {
        const polish = deps.polish ?? (async (value: string) => {
          const { polishDraft } = await import("../content-improve.ts");
          return polishDraft(value);
        });
        const polished = await polish(repairedText);
        if (polished.text.trim()) repairedText = polished.text;
      } catch {
        /* optional */
      }
      const trial = await evaluateCandidate(repairedText, repaired.source, candidateAttempts + repairRound, "TARGETED REPAIR", repair);
      if (trial && materiallyImproved(trial)) acceptedBest = trial;
      if (trial) repairBase = trial;
    }
  }

  const explicitTransformation = mode !== "ANALYZE" && mode !== "SCORE" && mode !== "FACT_CHECK";
  const bestAnyValid = candidates
    .filter((candidate) => !candidate.output.keptOriginal)
    .sort((a, b) => b.score.improved.total - a.score.improved.total)[0];
  const selectedBest = explicitTransformation ? (acceptedBest ?? bestAnyValid) : null;

  if (!selectedBest) {
    deterministic.output = {
      ...deterministic.output,
      text: deterministic.input.text,
      keptOriginal: true,
      notes: [
        ...deterministic.output.notes,
        "No safe transformed candidate survived factuality/editorial validation after bounded optimization. Source retained as an integrity fallback.",
      ],
    };
    return cacheableAnalysis ? cacheSet(cacheKey, deterministic) : deterministic;
  }
  selectedBest.output.notes = [
    ...selectedBest.output.notes,
    selectedBest.score.improved.total > originalScore
      ? `Validated improvement: ${originalScore} → ${selectedBest.score.improved.total} (+${selectedBest.score.improved.total - originalScore}).`
      : "User-requested transformation accepted after factuality, language, and editorial validation.",
    `Viral score: ${originalViral} → ${selectedBest.score.improved.viral} (${selectedBest.score.improved.viral - originalViral >= 0 ? "+" : ""}${selectedBest.score.improved.viral - originalViral}).`,
  ];
  return cacheableAnalysis ? cacheSet(cacheKey, selectedBest) : selectedBest;
}

export type ImproveLoopResult = {
  target: number;
  rounds: Array<{
    round: number;
    before: EditorDossier;
    after: EditorDossier;
    selected: number;
    revisionApplied: boolean;
  }>;
  final: EditorDossier;
  stoppedReason: "target_reached" | "max_rounds" | "no_suggestions" | "revision_failed";
};

export async function executeImproveLoop(input: EditorRequest, deps: EditorDeps = {}, target = 80): Promise<ImproveLoopResult> {
  const rounds: ImproveLoopResult["rounds"] = [];
  let current = await executeEditor({
    ...input,
    mode: "IMPROVE",
    request: input.request || "Improve this content by targeting its weakest measured editorial dimensions.",
  }, deps);

  for (let round = 1; round <= 3; round += 1) {
    if (current.score.improved.total >= target) {
      return { target, rounds, final: current, stoppedReason: "target_reached" };
    }

    const weakest = current.score.dimensions
      .filter((dimension) => dimension.score < 78)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((dimension) => dimension.label);

    const request = weakest.length
      ? `Target these measured weaknesses, in order: ${weakest.join(", ")}. Make a material editorial improvement while preserving every factual element.`
      : "Make the smallest material editorial improvement that raises at least one measured craft dimension without changing facts.";

    const next = await executeEditor({
      text: current.output.text || current.input.text,
      mode: "IMPROVE",
      kind: current.output.kind,
      request,
    }, deps);

    rounds.push({
      round,
      before: current,
      after: next,
      selected: weakest.length,
      revisionApplied: next.output.text.trim() !== current.output.text.trim(),
    });

    if (next.output.text.trim() === current.output.text.trim()) {
      return { target, rounds, final: current, stoppedReason: "max_rounds" };
    }
    current = next;
  }

  return { target, rounds, final: current, stoppedReason: "max_rounds" };
}
