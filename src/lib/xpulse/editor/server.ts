/**
 * Editor server path.
 * Analyzer + strategist: runEditorPipeline (scoreContent, entities, plan).
 * Writer: one configured model (Groq, OpenRouter, or Gemini) when a key exists.
 * Critic: fact, number, language, and promo checks. A failed critic reverts.
 * Scorer: scoreContent again. A rewrite that does not raise the score is dropped.
 * Public Pollinations and LLM7 are not called from this path.
 */

import { baselineContent } from "../optimize/baseline.ts";
import type { ContentLogicVersion } from "../optimize/types.ts";
import { extractPublicXPostId, resolvePublicXPost } from "../x-public.ts";
import { isEditorMode, runEditorPipeline, type EditorDossier, type EditorMode } from "./pipeline.ts";
import { classifyUrl, extractPublicPage, type UrlExtraction } from "./url.ts";
import { getTrendSnapshot } from "../trends.ts";

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
    return await loadActiveContentLogic();
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
  const cacheKey = JSON.stringify({
    mode,
    kind,
    request,
    version: logic.version,
    text,
    url: urlResult?.status ?? null,
    body: urlResult?.text ?? null,
  });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const deterministic = runEditorPipeline({ text, mode, kind, request, logic, url: urlResult, trend, liveTrends });
  const rewriteMode = mode !== "ANALYZE" && mode !== "SCORE" && mode !== "FACT_CHECK";
  const writer: Rewrite | null =
    deps.rewrite === undefined
      ? async (payload) => {
          const { rewriteWithConfiguredModel } = await import("../content-improve.ts");
          return rewriteWithConfiguredModel(payload);
        }
      : deps.rewrite;
  if (!rewriteMode || !text.trim() || !writer) return cacheSet(cacheKey, deterministic);

  const plans = deterministic.plan.map((item) => `${item.action} ${item.target}: ${item.reason}`);
  const candidates: EditorDossier[] = [];

  for (const attempt of [1, 2, 3]) {
    let candidate: { text: string; source: string } | null = null;
    try {
      candidate = await writer({
        text,
        mode,
        kind: deterministic.output.kind,
        language: deterministic.input.language,
        request,
        plan: plans,
        attempt,
      });
    } catch {
      candidate = null;
    }
    if (!candidate?.text.trim()) continue;

    let proposed = candidate.text;
    try {
      const polish =
        deps.polish ??
        (async (value: string) => {
          const { polishDraft } = await import("../content-improve.ts");
          return polishDraft(value);
        });
      const polished = await polish(proposed);
      if (polished.text.trim()) proposed = polished.text;
    } catch {
      /* polishing is optional */
    }

    const trial = runEditorPipeline({
      text,
      mode,
      kind,
      request,
      logic,
      url: urlResult,
      proposed: { text: proposed, source: candidate.source },
      trend,
      liveTrends,
    });

    if (
      !trial.output.keptOriginal &&
      trial.validation.factsPreserved &&
      trial.validation.numbersPreserved &&
      trial.validation.languageKept &&
      !trial.validation.promoAdded
    ) {
      candidates.push(trial);
    }
  }

  const originalScore = deterministic.score.original.total;
  const originalViral = deterministic.score.original.viral;
  const best = [deterministic, ...candidates]
    .filter((candidate) => candidate.score.improved.total > originalScore && candidate.score.improved.viral >= originalViral)
    .sort((a, b) => {
      const aGain = a.score.improved.total - originalScore + (a.score.improved.viral - originalViral) * 0.75;
      const bGain = b.score.improved.total - originalScore + (b.score.improved.viral - originalViral) * 0.75;
      return bGain - aGain;
    })[0];

  if (!best || best.output.keptOriginal) {
    deterministic.output.notes = [
      ...deterministic.output.notes,
      "No validated transformation improved the measured score. Original facts were preserved.",
    ];
    return cacheSet(cacheKey, deterministic);
  }

  best.output.notes = [
    ...best.output.notes,
    `Validated improvement: ${originalScore} → ${best.score.improved.total} (+${best.score.improved.total - originalScore}).`,
    `Viral score: ${originalViral} → ${best.score.improved.viral} (+${best.score.improved.viral - originalViral}).`,
  ];
  return cacheSet(cacheKey, best);
}
