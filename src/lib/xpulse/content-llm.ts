/**
 * Live token copywriter.
 * Free public LLM cascade + LanguageTool polish.
 * Facts stay locked. Writing changes every variant.
 */

import { checkLanguageTool } from "./public-apis";
import { scoreContent, type ContentKind } from "./content-score";
import {
  ensureLockedMarket,
  ensureMarketVerdict,
  generateFromFactSet,
  type GeneratedContent,
  type RegenMode,
  type TokenFactSet,
} from "./content-create.ts";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function composeGenerated(
  text: string,
  kind: ContentKind,
  facts: TokenFactSet,
): Promise<string> {
  // AI owns narrative construction for long-form formats. The deterministic
  // optimizer is limited to posts so it cannot flatten thread/article structure.
  if (kind !== "post") return text;

  try {
    const { loadActiveContentLogic } = await import("./optimize/store.ts");
    const { optimizeContent } = await import("./optimize/compose.ts");
    const logic = await loadActiveContentLogic();
    const required = [facts.market.headline, facts.market.rugLine].filter(
      (line): line is string => Boolean(line),
    );
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

  const system = systemPrompt(kind, mode);
  const user = userPrompt(facts, kind, mode, variant, trendGuidance, contentGuidance);
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

    const candidate = refined && refined.length >= 120 ? refined : draft;
    const cleaned = await polish(sanitize(candidate, facts, kind));
    const composed = await composeGenerated(cleaned, kind, facts);
    const score = scoreContent(composed, kind);

    applied.push(
      "Writer: " + provider.id,
      refined ? "Editorial refinement: passed" : "Editorial refinement: fallback to draft",
      "AI synthesis from token research + active viral guidance",
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