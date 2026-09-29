/**
 * Live token copywriter.
 * Free public LLM cascade + LanguageTool polish.
 * Facts stay locked. Writing changes every variant.
 */

import { checkLanguageTool } from "./public-apis";
import { scoreContent, type ContentKind } from "./content-score";
import {
  buildEditorialSelfCritiquePrompt,
  buildEditorialSystemPrompt,
  EDITORIAL_ENGINE_VERSION,
  validateEditorialShape,
} from "./editorial-standard";
import {
  ensureLockedMarket,
  ensureMarketVerdict,
  generateFromFactSet,
  type GeneratedContent,
  type RegenMode,
  type TokenFactSet,
} from "./content-create.ts";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function composeGenerated(text: string, kind: ContentKind, facts: TokenFactSet): Promise<string> {
  if (kind !== "post") return text;
  try {
    const { loadActiveContentLogic } = await import("./optimize/store.ts");
    const { optimizeContent } = await import("./optimize/compose.ts");
    const logic = await loadActiveContentLogic();
    const required = [facts.market.headline, facts.market.rugLine].filter((line): line is string => Boolean(line));
    return optimizeContent({
      text,
      kind,
      mode: "GENERATE",
      logic,
      requiredPhrases: required,
    }).text;
  } catch {
    return text;
  }
}

type Provider = {
  id: string;
  url: string;
  model: string;
  key?: string;
  extraHeaders?: Record<string, string>;
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
  maxTokens = 700,
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
        max_tokens: maxTokens,
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

function systemPrompt(kind: ContentKind, mode: RegenMode, variant: number): string {
  const tone =
    mode === "more_viral" || mode === "stronger_hook"
      ? "Sharp, high-signal crypto-native voice. Strong hook without hype."
      : mode === "more_professional" || mode === "more_technical"
        ? "Editorial research-desk voice. Precise, calm, specific and analytical."
        : mode === "more_human" || mode === "more_story"
          ? "Natural human narrative voice. Use a real arc rather than corporate copy."
          : mode === "more_concise"
            ? "Tight and selective. Keep only the strongest evidence and takeaway."
            : "Natural, intelligent timeline voice. Write like an experienced market writer.";

  return buildEditorialSystemPrompt(
    kind,
    { format: kind, mode, variant },
    [
      tone,
      "Use the strongest story or contradiction first, then choose evidence that advances that thesis. Do not follow source-field order.",
      kind === "thread"
        ? "Build 8-10 connected tweets when the evidence supports that depth; hook -> evidence -> relationship -> interpretation -> tension -> payoff. Do not use outline labels."
        : kind === "article"
          ? "Build enough depth for a real editorial article: headline -> hook -> context -> evidence -> analysis -> implications -> conclusion. Do not pad to hit an arbitrary word count."
          : "Build one compact publishable post around one central thesis. Select only the evidence that earns its place.",
      buildEditorialSelfCritiquePrompt(kind),
      "The selected mode must materially affect voice, rhythm, evidence selection or structure. Variant is a regeneration choice, not decorative metadata.",
    ],
  );
}

function userPrompt(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode,
  variant: number,
  trendGuidance: Array<Record<string, unknown>>,
  contentGuidance: Array<Record<string, unknown>>,
): string {
  const payload = {
    token: {
      name: facts.identity.name,
      symbol: facts.identity.symbol,
      chain: facts.identity.chain,
      contract: facts.identity.address,
    },
    market: {
      state: facts.market.state,
      headline: facts.market.headline,
      rugLine: facts.market.rugLine,
      rugPullRisk: facts.market.rugPullRisk,
      riskScore: facts.market.riskScore,
      riskBand: facts.market.riskBand,
    },
    metrics: Object.fromEntries(facts.metrics.map((item) => [item.key, item.value])),
    verifiedFacts: facts.market.facts.slice(0, 12),
    conclusions: facts.market.conclusions.slice(0, 8),
    caveats: facts.market.caveats.slice(0, 8),
    risks: facts.risks.slice(0, 8),
    findings: facts.findings.slice(0, 12),
    xSignals: facts.xPatterns.slice(0, 8),
    trendGuidance,
    contentGuidance,
    requestedFormat: kind,
    requestedMode: mode,
    variant,
  };

  return [
    "Create original editorial content from the evidence below.",
    "First find the single strongest story or contradiction. Then build the content around that thesis.",
    "Do not mention every field. Select the evidence that actually advances the argument.",
    "Use viral trend guidance only to improve hook, sequencing, pacing and narrative mechanics. Never copy wording.",
    "Apply USER SETTINGS as actual writing instructions, not metadata. Format, mode and variant must be observable in the result.",
    "Do not turn the research into a list.",
    "Locked research payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

function refinementPrompt(
  facts: TokenFactSet,
  kind: ContentKind,
  draft: string,
): string {
  const checks =
    kind === "thread"
      ? [
          "Every tweet adds a new idea or useful turn.",
          "The thread progresses from hook to evidence to interpretation to payoff.",
          "At least one meaningful relationship between signals is explained.",
          "No tweet is a disguised metric list or filler.",
          "The numbering is clean 1/ 2/ 3/ and each tweet is publishable on X.",
        ]
      : kind === "article"
        ? [
            "The piece has a real thesis and editorial arc.",
            "Metrics are evidence inside the argument, not a data dump.",
            "Sections add context, interpretation, contrast or consequence.",
            "Observed facts are not presented as stronger claims than the evidence supports.",
            "The prose reads like a professional editorial article, not an AI report.",
          ]
        : [
            "There is one strong idea rather than a list of metrics.",
            "The hook is specific and earns attention.",
            "The selected evidence supports the thesis.",
            "The close provides a useful takeaway instead of generic bait.",
          ];

  return [
    "You are the final senior editor for XPulse.",
    "Refine the draft while preserving every verified number, token identity, market-state conclusion and risk caveat.",
    "Increase depth, specificity, narrative flow, rhythm and originality.",
    "Remove repetition and sentences that only restate supplied data.",
    "Do not invent missing facts or make the market diagnosis more positive.",
    checks.join("\n"),
    "Return only the revised final content.",
    "TOKEN CONTEXT:",
    JSON.stringify({
      name: facts.identity.name,
      symbol: facts.identity.symbol,
      state: facts.market.state,
      headline: facts.market.headline,
      rugLine: facts.market.rugLine,
      facts: facts.market.facts,
      risks: facts.risks,
      draft,
    }),
  ].join("\n\n");
}

function sanitize(text: string, facts: TokenFactSet, kind: ContentKind): string {
  let out = text
    .replace(/^\x60\x60\x60[\w-]*\n?|\n?\x60\x60\x60$/g, "")
    .replace(/\b(about to explode|guaranteed|100x|to the moon|ape in|can't miss|risk-free|lorem ipsum|mockup|placeholder)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (kind === "thread") {
    const lines = out
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const body = line.replace(/^\d+\s*[/.)-]\s*/, "").trim();
        return (index + 1) + "/ " + body;
      });
    out = lines.join("\n\n");
  }

  if (!out.includes(facts.identity.address)) {
    out = out + "\n\nCA: " + facts.identity.address;
  }
  if (!/not financial advice|nfa\b/i.test(out)) {
    out = out + "\n\nNFA. Read the pair yourself.";
  }
  out = ensureMarketVerdict(ensureLockedMarket(out, facts), facts);
  if (kind !== "thread") return out;
  return out
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const body = line.replace(/^\d+\s*[/.)-]\s*/, "").trim();
      return (index + 1) + "/ " + body;
    })
    .join("\n\n");
}

function repairPrompt(facts: TokenFactSet, kind: ContentKind, draft: string, violations: string[]): string {
  return [
    "Repair this XPulse draft after deterministic validation failed.",
    "Keep only claims supported by the supplied research.",
    "Remove or rewrite every unsupported numeric claim.",
    "Preserve token identity and the existing market diagnosis.",
    "Do not add facts, numbers, dates, performance claims, holders, social metrics or catalysts.",
    "Return only the repaired publishable content.",
    "Format: " + kind,
    "Validation violations: " + violations.join(", "),
    "Research:",
    JSON.stringify({
      identity: facts.identity,
      metrics: facts.metrics,
      findings: facts.findings,
      story: facts.story,
      risks: facts.risks,
      market: facts.market,
    }),
    "Draft:",
    draft,
  ].join("\n\n");
}

async function polish(text: string): Promise<string> {
  try {
    const matches = await checkLanguageTool(text);
    if (!matches.length) return text;
    const usable = [...matches]
      .filter((m) => m.replacements[0] && m.length > 0)
      .sort((a, b) => b.offset - a.offset)
      .slice(0, 10);
    let next = text;
    for (const m of usable) {
      const swap = m.replacements[0]!;
      next = next.slice(0, m.offset) + swap + next.slice(m.offset + m.length);
    }
    return next;
  } catch {
    return text;
  }
}

export async function writeTokenCopy(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode = "default",
  variant = 0,
): Promise<GeneratedContent> {
  const { loadActiveViralTrend, loadActiveContentLogic } = await import("./optimize/store.ts");
  const [trend, logic] = await Promise.all([
    loadActiveViralTrend(),
    loadActiveContentLogic(),
  ]);

  const trendGuidance = trend.patterns
    .filter(
      (pattern) =>
        pattern.status === "ACTIVE" ||
        pattern.confidence === "HIGH" ||
        pattern.confidence === "VERY_HIGH",
    )
    .sort((a, b) => {
      const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 } as const;
      const confidenceDelta = rank[b.confidence] - rank[a.confidence];
      return confidenceDelta !== 0
        ? confidenceDelta
        : (b.engagementLift ?? -1) - (a.engagementLift ?? -1);
    })
    .slice(0, 10)
    .map((pattern) => ({
      name: pattern.name,
      format: pattern.format,
      confidence: pattern.confidence,
      direction: pattern.trendDirection,
      description: pattern.description,
      usage: pattern.recommendedUsage,
      engagementLift: pattern.engagementLift,
    }));

  const contentGuidance = logic.rules
    .filter((rule) => rule.status === "ACTIVE" && rule.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((rule) => ({
      appliesTo: rule.appliesTo,
      description: rule.description,
      confidence: rule.confidence,
      weight: rule.weight,
    }));

  const system = systemPrompt(kind, mode, variant);
  const user = userPrompt(
    facts,
    kind,
    mode,
    variant,
    trendGuidance,
    contentGuidance,
  );
  const temperature =
    mode === "more_concise"
      ? 0.62
      : kind === "thread" || kind === "article"
        ? 0.8
        : 0.86;
  const maxTokens =
    kind === "thread"
      ? 2200
      : kind === "article"
        ? 2600
        : 1100;
  const applied: string[] = [];

  for (const provider of providers()) {
    const draft = await chatComplete(
      provider,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      maxTokens,
    );

    if (!draft || draft.length < 120) {
      applied.push(provider.id + ": draft unavailable");
      continue;
    }

    const refined = await chatComplete(
      provider,
      [
        { role: "system", content: system },
        {
          role: "user",
          content: refinementPrompt(facts, kind, draft),
        },
      ],
      Math.max(0.42, temperature - 0.2),
      maxTokens,
    );

    let candidate = refined && refined.length >= 120 ? refined : draft;
    let cleaned = await polish(sanitize(candidate, facts, kind));
    let composed = await composeGenerated(cleaned, kind, facts);
    let validation = validateGeneratedContent(composed, kind, facts);

    // Controlled repair: one deterministic retry per provider, then reject and move to the next provider.
    if (!validation.pass) {
      applied.push(
        "Deterministic validation: rejected " + validation.violations.join(", "),
      );
      const repaired = await chatComplete(
        provider,
        [
          { role: "system", content: system },
          {
            role: "user",
            content: repairPrompt(facts, kind, composed, validation.violations),
          },
        ],
        Math.max(0.35, temperature - 0.3),
        maxTokens,
      );
      if (repaired && repaired.length >= 120) {
        cleaned = await polish(sanitize(repaired, facts, kind));
        composed = await composeGenerated(cleaned, kind, facts);
        validation = validateGeneratedContent(composed, kind, facts);
      }
    }

    if (!validation.pass) {
      applied.push(
        "Deterministic validation: provider rejected after retry " +
          validation.violations.join(", "),
      );
      continue;
    }

    const score = scoreContent(composed, kind);

    applied.push(
      "Editorial engine: " + EDITORIAL_ENGINE_VERSION,
      "Writer: " + provider.id,
      refined ? "Editorial refinement: passed" : "Editorial refinement: fallback to draft",
      "AI synthesis from token research + active viral guidance",
      "Deterministic validation: passed",
      validation.warnings.length
        ? "Validation warnings: " + validation.warnings.join(", ")
        : "Validation warnings: none",
      "Market state locked: " + facts.market.state,
      "Viral patterns supplied: " + trendGuidance.length,
      "Content rules supplied: " + contentGuidance.length,
      "Variant: " + variant,
      "Mode: " + mode,
      "Content score " + score.total + "/100",
    );

    return {
      kind,
      angle: {
        id: "why",
        label: "Editorial synthesis",
        focus: "Original content built from the strongest relationship in the token research.",
        why: "Research is synthesized into a thesis instead of being copied into prose.",
      },
      text: composed,
      score,
      applied,
    };
  }

  const fallback = generateFromFactSet(facts, kind, mode, variant);
  const text = await polish(await composeGenerated(fallback.text, kind, facts));

  return {
    ...fallback,
    text,
    applied: [
      ...fallback.applied,
      "Fallback: local fact-grounded copywriter (AI providers unavailable)",
    ],
  };
}
