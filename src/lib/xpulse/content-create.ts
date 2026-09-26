/**
 * Content angles + generation helpers for posts / threads / articles.
 * Uses the local rewrite engine; never invents market facts.
 */

import { rewritePost } from "./rewrite";
import { scoreContent, type ContentKind, type ContentScoreReport } from "./content-score";
import type { TokenIntel } from "./token-intel";

export type ContentAngle = {
  id: string;
  label: string;
  focus: string;
  why: string;
};

export type GeneratedContent = {
  kind: ContentKind;
  angle: ContentAngle;
  text: string;
  score: ContentScoreReport;
  applied: string[];
};

const ANGLES: ContentAngle[] = [
  {
    id: "breaking",
    label: "What happened",
    focus: "Lead with the concrete event or data point.",
    why: "Fresh facts stop the scroll when the first line carries the news.",
  },
  {
    id: "why",
    label: "Why it matters",
    focus: "Implications for builders, holders, or the market.",
    why: "Context turns a number into a reason to care.",
  },
  {
    id: "data",
    label: "Data-first",
    focus: "Numbers, timeframes, and measurable structure only.",
    why: "Specificity raises credibility and quote potential.",
  },
  {
    id: "story",
    label: "Narrative",
    focus: "A short arc: setup → tension → turn.",
    why: "Stories retain attention longer than bullet claims alone.",
  },
  {
    id: "edu",
    label: "Educational",
    focus: "Explain the mechanism simply without hype.",
    why: "Teaching posts earn saves and follows when they stay concrete.",
  },
  {
    id: "contrarian",
    label: "Contrarian (evidence-only)",
    focus: "Challenge the obvious reading only when data supports it.",
    why: "Disagreement without evidence is noise; disagreement with evidence is discussion.",
  },
];

export function suggestAngles(topic: string): ContentAngle[] {
  const t = topic.toLowerCase();
  const ranked = [...ANGLES];
  if (/\b(up|down|pump|dump|launch|ship|announce)\b/.test(t)) {
    ranked.sort((a, b) => (a.id === "breaking" ? -1 : b.id === "breaking" ? 1 : 0));
  } else if (/\b(how|what is|explain|guide)\b/.test(t)) {
    ranked.sort((a, b) => (a.id === "edu" ? -1 : b.id === "edu" ? 1 : 0));
  } else if (/\b(\d|%|volume|liquidity|mcap)\b/.test(t)) {
    ranked.sort((a, b) => (a.id === "data" ? -1 : b.id === "data" ? 1 : 0));
  }
  return ranked;
}

function formatPrice(n: number | null): string {
  if (n == null) return "unavailable";
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

function formatUsd(n: number | null): string {
  if (n == null) return "unavailable";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Build a research brief from token intel — facts only. */
export function tokenBrief(intel: TokenIntel): string {
  const { identity, market, analysis } = intel;
  const lines = [
    `${identity.name} (${identity.symbol}) · Solana`,
    `CA: ${identity.address}`,
    `Price: ${formatPrice(market.priceUsd)}`,
    `24h change: ${market.priceChange24h != null ? `${market.priceChange24h.toFixed(1)}%` : "unavailable"}`,
    `Liquidity: ${formatUsd(market.liquidityUsd)}`,
    `24h volume: ${formatUsd(market.volume24h)}`,
    `Market cap: ${formatUsd(market.marketCap)}`,
    `FDV: ${formatUsd(market.fdv)}`,
    "",
    analysis.snapshot,
    analysis.marketStructure,
    analysis.liquidity,
    analysis.activity,
    analysis.narrative,
    "",
    "Observable risks:",
    ...analysis.risks.map((r) => `• ${r}`),
    "",
    "Informational only — not financial advice. Unverified claims are omitted.",
  ];
  return lines.join("\n");
}

function applyAnglePrefix(text: string, angle: ContentAngle): string {
  // Light structural hint only — rewrite engine does the heavy lifting
  const first = text.split(/\n+/)[0] ?? text;
  if (angle.id === "data" && !/\d/.test(first)) {
    return text;
  }
  return text;
}

export function generateFromDraft(
  draft: string,
  kind: ContentKind,
  angleId?: string,
  variant = 0,
): GeneratedContent {
  const angles = suggestAngles(draft);
  const angle = angles.find((a) => a.id === angleId) ?? angles[0]!;
  const seeded = applyAnglePrefix(draft.trim(), angle);
  const rewritten = rewritePost(seeded, variant);
  let text = rewritten.text;

  if (kind === "thread") {
    // Ensure multi-beat structure
    const parts = text.split(/\n\n+/).filter(Boolean);
    if (parts.length < 3) {
      const extra = rewritePost(draft, variant + 3).text.split(/\n\n+/);
      text = [...parts, ...extra.slice(1, 3)].join("\n\n");
    }
    text = text
      .split(/\n\n+/)
      .map((p, i) => `${i + 1}/ ${p.replace(/^\d+\/\s*/, "")}`)
      .join("\n\n");
  }

  if (kind === "article") {
    const body = text.split(/\n\n+/);
    text = [
      body[0] ?? "Untitled",
      "",
      body.slice(1).join("\n\n") || draft,
      "",
      "—",
      "This piece is informational. Claims without primary sources are omitted.",
    ].join("\n");
  }

  const score = scoreContent(text, kind);
  return {
    kind,
    angle,
    text,
    score,
    applied: [
      ...rewritten.applied,
      `Angle: ${angle.label}`,
      `Content score ${score.total}/100`,
    ],
  };
}

export function generateFromToken(
  intel: TokenIntel,
  kind: ContentKind,
  angleId?: string,
  variant = 0,
): GeneratedContent {
  const brief = tokenBrief(intel);
  return generateFromDraft(brief, kind, angleId ?? "data", variant);
}

export function improveForScore(
  text: string,
  kind: ContentKind,
  variant = 0,
): GeneratedContent {
  const current = scoreContent(text, kind);
  let best = generateFromDraft(text, kind, undefined, variant);
  for (let i = 1; i < 5; i += 1) {
    const candidate = generateFromDraft(text, kind, undefined, variant + i * 7);
    if (candidate.score.total > best.score.total) best = candidate;
    if (best.score.total >= current.total + 8) break;
  }
  // Never claim artificial inflation
  if (best.score.total < current.total) {
    return {
      kind,
      angle: best.angle,
      text,
      score: current,
      applied: ["No higher-scoring faithful rewrite found — original kept"],
    };
  }
  return best;
}
