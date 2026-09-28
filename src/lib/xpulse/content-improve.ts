/**
 * Analyze / improve / threadify.
 * Free public stack: Groq, OpenRouter :free, Gemini, Pollinations, LLM7,
 * LanguageTool, Datamuse. Local thread packer as fallback.
 */

import { checkLanguageTool } from "./public-apis";
import { scoreContent, type ContentKind, type ContentScoreReport } from "./content-score";
import { buildEditorialSelfCritiquePrompt, buildEditorialSystemPrompt, EDITORIAL_ENGINE_VERSION, validateEditorialShape } from "./editorial-standard";
import type { GeneratedContent } from "./content-create";
import { baselineContent } from "./optimize/baseline.ts";
import { optimizeContent, type CompositionResult } from "./optimize/compose.ts";
import { preservesAuthorFacts } from "./optimize/benchmarks.ts";
import type { ContentLogicVersion } from "./optimize/types.ts";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
};

export type ImproveResult = GeneratedContent & {
  before: ContentScoreReport;
  after: ContentScoreReport;
  source: string;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  const groq = env("GROQ_API_KEY");
  if (groq) {
    list.push({
      id: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: env("GROQ_MODEL") ?? "openai/gpt-oss-20b",
      key: groq,
    });
  }
  const openrouter = env("OPENROUTER_API_KEY");
  if (openrouter) {
    list.push({
      id: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: env("OPENROUTER_MODEL") ?? "qwen/qwen3.8-27b:free",
      key: openrouter,
      extraHeaders: {
        "HTTP-Referer": env("APP_URL") ?? "https://xpulse.app",
        "X-Title": "XPulse",
      },
    });
  }
  const gemini = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY");
  if (gemini) {
    list.push({
      id: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: env("GEMINI_MODEL") ?? "gemini-2.5-flash",
      key: gemini,
    });
  }
  const pollen = env("POLLINATIONS_API_KEY");
  if (pollen) {
    list.push({
      id: "pollinations",
      url: "https://gen.pollinations.ai/v1/chat/completions",
      model: "openai",
      key: pollen,
    });
  }
  list.push({
    id: "pollinations-public",
    url: "https://text.pollinations.ai/openai",
    model: "openai",
  });
  list.push({
    id: "llm7",
    url: "https://api.llm7.io/v1/chat/completions",
    model: env("LLM7_MODEL") ?? "gpt-4o-mini",
  });
  return list;
}

async function chatComplete(
  provider: Provider,
  messages: ChatMessage[],
  temperature: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18_000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(provider.extraHeaders ?? {}),
    };
    if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
    const res = await fetch(provider.url, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: provider.model,
        temperature,
        max_tokens: 900,
        messages,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
      content?: string;
    };
    const text =
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.text ??
      (typeof json.content === "string" ? json.content : "");
    return text?.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripFence(text: string) {
  return text
    .replace(/^```[\w]*\n?|\n?```$/g, "")
    .replace(/\b(lorem ipsum|mockup|placeholder|TODO)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function polish(text: string): Promise<{ text: string; notes: string[] }> {
  const notes: string[] = [];
  let next = text;
  try {
    const vocab = await expandVagueVocabulary(next);
    const keys = Object.keys(vocab);
    for (const key of keys.slice(0, 4)) {
      const swap = vocab[key]?.find((w) => w.length >= 3 && w.length <= 16 && w.toLowerCase() !== key.toLowerCase());
      if (!swap) continue;
      const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(next)) {
        next = next.replace(re, swap);
        notes.push(`Datamuse: ${key} → ${swap}`);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const matches = await checkLanguageTool(next);
    const usable = [...matches]
      .filter((m) => m.replacements[0] && m.length > 0)
      .sort((a, b) => b.offset - a.offset)
      .slice(0, 12);
    if (usable.length) {
      for (const m of usable) {
        next = next.slice(0, m.offset) + m.replacements[0] + next.slice(m.offset + m.length);
      }
      notes.push(`LanguageTool: ${usable.length} fix(es)`);
    }
  } catch {
    /* ignore */
  }
  return { text: stripFence(next), notes };
}

async function writeWithLlm(system: string, user: string): Promise<{ text: string; source: string } | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  for (const provider of providers()) {
    const raw = await chatComplete(provider, messages, 0.25);
    if (raw && raw.length >= 60) return { text: stripFence(raw), source: provider.id };
  }
  return null;
}

async function loadLogic(): Promise<ContentLogicVersion> {
  try {
    const { loadActiveContentLogic } = await import("./optimize/store.ts");
    return await loadActiveContentLogic();
  } catch {
    return baselineContent();
  }
}

function fromComposition(result: CompositionResult, source: string): ImproveResult {
  return {
    kind: result.kind,
    angle: {
      id: "why",
      label: "Score improve",
      focus: "Raise weak dimensions without new facts.",
      why: "A higher score only counts when scoreContent measures it.",
    },
    text: result.text,
    score: result.after,
    before: result.before,
    after: result.after,
    source,
    applied: [
      `Score ${result.originalScore} → ${result.optimizedScore}`,
      result.keptOriginal ? "Original kept" : `Rules: ${result.appliedRuleIds.join(", ") || "mode"}`,
      ...result.dimensionDeltas.map((delta) => `${delta.label} ${delta.delta > 0 ? "+" : ""}${delta.delta}`),
      ...result.notes.slice(0, 4),
    ],
  };
}
export async function improveDraftCopy(text: string, kind: ContentKind): Promise<ImproveResult> {
  const logic = await loadLogic();
  const local = optimizeContent({ text, kind, mode: "SCORE_IMPROVE", logic });
  const before = local.before;
  const weak = before.dimensions
    .filter((d) => d.score < 72)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((d) => `${d.label} (${d.score}): ${d.note}`);

  const live = await writeWithLlm(
    buildEditorialSystemPrompt(
      kind,
      { format: kind, mode: "IMPROVE", variant: before.total },
      [
        "Rewrite the draft into finished publishable editorial content.",
        kind === "thread"
          ? "Use a true narrative progression. Number publishable tweets 1/ 2/ 3/. Keep each tweet under 270 characters and do not use outline labels."
          : kind === "article"
            ? "Develop a coherent editorial argument with a title and purposeful sections. Do not pad with generic background."
            : "Write one compressed, high-signal post with a strong first sentence; do not turn it into a mini-article.",
        "Keep every concrete fact, number, name, ticker, URL, and contract. Do not invent new metrics.",
        "Use the score weaknesses below as craft guidance, not as permission to change the facts.",
        "WEAK DIMENSIONS:\n" + (weak.join("\n") || "None materially below threshold."),
        buildEditorialSelfCritiquePrompt(kind),
      ],
    ),
    "Kind: " + kind + "\nScore now: " + before.total + "/100\nDRAFT:\n" + text,
  );
  let chosen = fromComposition(local, "local-score");
  if (live?.text) {
    const polished = await polish(live.text);
    const candidate = polished.text;
    const report = scoreContent(candidate, kind);
    const gate = validateEditorialShape(candidate, kind);
    if (gate.pass && report.total > chosen.after.total && preservesAuthorFacts(text, candidate)) {
      chosen = {
        ...chosen,
        text: candidate,
        score: report,
        after: report,
        source: live.source,
        applied: [
          `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`,
          `Writer: ${live.source}`,
          `Score ${before.total} → ${report.total}`,
          ...polished.notes,
          ...report.improvements.slice(0, 3),
        ],
      };
    }
  }
  return chosen;
}

export async function threadifyDraftCopy(text: string): Promise<ImproveResult> {
  const { buildPublishThread } = await import("./thread-builder");
  const packed = await buildPublishThread(text);
  const logic = await loadLogic();
  const local = optimizeContent({ text, kind: "thread", mode: "THREADIFY", logic });
  if (local.optimizedScore > packed.after.total && preservesAuthorFacts(text, local.text)) {
    return fromComposition(local, "local-thread");
  }
  return packed;
}

export async function strongerHookCopy(text: string, kind: ContentKind): Promise<ImproveResult> {
  const logic = await loadLogic();
  const local = optimizeContent({ text, kind, mode: "HOOK_OPTIMIZE", logic });
  const live = await writeWithLlm(
    buildEditorialSystemPrompt(
      kind,
      { format: kind, mode: "IMPROVE_HOOK" },
      [
        "Rewrite the opening materially stronger while keeping the rest lightly tightened.",
        "The first line must earn attention through specificity, contrast or a useful unanswered question, never clickbait.",
        "Keep every existing fact and do not invent numbers or flip a negative market read.",
        buildEditorialSelfCritiquePrompt(kind),
      ],
    ),
    text,
  );
  let chosen = fromComposition(local, "local-hook");
  if (live?.text) {
    const polished = await polish(live.text);
    const report = scoreContent(polished.text, kind);
    const gate = validateEditorialShape(polished.text, kind);
    if (gate.pass && report.total > chosen.after.total && preservesAuthorFacts(text, polished.text)) {
      chosen = {
        ...chosen,
        text: polished.text,
        score: report,
        after: report,
        source: live.source,
        applied: [`Editorial engine: ${EDITORIAL_ENGINE_VERSION}`, `Writer: ${live.source}`, `Score ${local.originalScore} → ${report.total}`, ...polished.notes],
      };
    }
  }
  return chosen;
}

/** True only when a keyed provider is configured. Public cascades are not treated as configured. */
export function hasConfiguredWriter(): boolean {
  return providers().some((provider) => Boolean(provider.key));
}

export async function polishDraft(text: string): Promise<{ text: string; notes: string[] }> {
  return polish(text);
}

/**
 * One writer call against Groq, OpenRouter, or Gemini when a key exists.
 * Does not walk the public Pollinations or LLM7 cascade.
 */
export async function rewriteWithConfiguredModel(input: {
  text: string;
  mode: string;
  kind: ContentKind;
  language: string;
  request?: string;
  plan: string[];
  attempt?: number;
}): Promise<{ text: string; source: string } | null> {
  const keyed = providers().filter((provider) => provider.key);
  const publicFallback = providers().filter((provider) => provider.id === "pollinations-public");
  const available = keyed.length ? keyed : publicFallback;
  if (!available.length) return null;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are the writer stage of an editorial pipeline. A critic will reject you if you invent or flip facts.",
        "Keep the author's language, names, tickers, mentions, hashtags, URLs, emoji, and numbers.",
        "Do not add a statistic, quote, source, partnership, price, or market-cap figure.",
        "Do not turn a bearish, severe, or collapsed read into a bullish one.",
        "Do not add a CTA, emoji, or hashtag unless the draft already uses that device.",
        "Do not return the original draft unchanged. Make concrete editorial improvements: strengthen the first line, increase specificity and curiosity, tighten structure, improve readability, and create a more quotable/shareable line while staying truthful.",
        "Banned: exciting opportunity, great potential, could explode, high potential, to the moon, this changes everything, the future is here, here's why, as an AI.",
        input.kind === "thread"
          ? "If the mode asks for a thread, number existing beats as 1/ 2/ 3/. Do not add a new beat."
          : input.kind === "article"
            ? "If the mode asks for an article, use the draft's own sentences as the sections."
            : "If the mode asks for a post, keep it one publishable post.",
        input.mode === "IMPROVE_HOOK" ? "The opening must be materially stronger than the original while preserving the factual meaning." : "",
        input.mode === "MAKE_THREAD" ? "Turn the source into a genuine progression of beats with setup, tension, evidence already present, and payoff." : "",
        input.mode === "MAKE_ARTICLE" ? "Create a coherent long-form structure from the source instead of merely adding line breaks." : "",
        "Output only the rewritten text.",
        input.request ? `Follow this explicit user request exactly when it is compatible with the facts: ${input.request}` : "",
      ].filter(Boolean).join(" "),
    },
    {
      role: "user",
      content: `Mode: ${input.mode}\nAttempt: ${input.attempt ?? 1}\nKind: ${input.kind}\nLanguage: ${input.language}\nUser request: ${input.request ?? "General editorial analysis"}\nPlan:\n${input.plan.join("\n")}\n\nDRAFT:\n${input.text}`,
    },
  ];
  for (const provider of available) {
    const raw = await chatComplete(provider, messages, 0.15);
    if (raw && raw.length >= 20) return { text: stripFence(raw), source: provider.id };
  }
  return null;
}
