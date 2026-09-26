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
    `${identity.name} (${identity.symbol}) · ${identity.chain}`,
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

function extractFacts(draft: string): string[] {
  const lines = draft
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const facts: string[] = [];
  for (const line of lines) {
    if (/\d/.test(line) || /\$|%|volume|liquidity|mcap|holders|chain|price/i.test(line)) {
      facts.push(line.replace(/^[-•*]\s*/, ""));
    }
  }
  return facts.slice(0, 12);
}

function hasEnoughResearch(draft: string): boolean {
  const facts = extractFacts(draft);
  const words = draft.trim().split(/\s+/).length;
  return facts.length >= 2 || words >= 40;
}

export function generateFromDraft(
  draft: string,
  kind: ContentKind,
  angleId?: string,
  variant = 0,
): GeneratedContent {
  const cleaned = draft.trim();
  const angles = suggestAngles(cleaned);
  const angle = angles.find((a) => a.id === angleId) ?? angles[0]!;
  const facts = extractFacts(cleaned);

  if (!cleaned) {
    const score = scoreContent("", kind);
    return {
      kind,
      angle,
      text: "More research is required before creating a reliable analysis.",
      score,
      applied: ["Blocked: empty research input"],
    };
  }

  if (!hasEnoughResearch(cleaned) && kind !== "post") {
    const score = scoreContent(cleaned, kind);
    return {
      kind,
      angle,
      text: "More research is required before creating a reliable analysis.\n\nAdd concrete facts, numbers, or verified events from your research step, then generate again.",
      score,
      applied: ["Blocked: insufficient research density"],
    };
  }

  const seeded = applyAnglePrefix(cleaned, angle);
  const rewritten = rewritePost(seeded, variant);
  let text = rewritten.text;

  if (kind === "post") {
    // One focused idea grounded in research
    const lead = facts[0] ?? text.split(/\n+/)[0] ?? text;
    const body = text.replace(lead, "").trim() || facts.slice(1, 3).join(" ");
    text = [lead, body].filter(Boolean).join("\n\n").slice(0, 1200);
  }

  if (kind === "thread") {
    const beats: string[] = [];
    beats.push(`Hook: ${facts[0] ?? text.split(/\n+/)[0] ?? "What the data shows"}`);
    beats.push(`Context: ${facts[1] ?? "Here is the setup behind the number."}`);
    for (const f of facts.slice(2, 6)) beats.push(f);
    if (facts.length) {
      beats.push(`Insight: ${facts[Math.min(2, facts.length - 1)]}`);
      beats.push("Implication: why this is worth attention now — without hype.");
    }
    beats.push("Summary: stick to the measured facts above; treat everything else as open.");
    const rewrittenBeats = beats.map((b, i) => {
      const r = rewritePost(b, variant + i);
      return `${i + 1}/ ${r.text.replace(/^\d+\/\s*/, "").split(/\n+/)[0]}`;
    });
    text = rewrittenBeats.join("\n\n");
  }

  if (kind === "article") {
    const title = facts[0] ?? cleaned.split(/\n+/)[0] ?? "Research note";
    const sections = [
      title,
      "",
      "Subtitle: What the available data actually shows.",
      "",
      "Introduction",
      rewritePost(cleaned.slice(0, 400), variant).text,
      "",
      "Context",
      facts[1] ?? "Context is limited to what the research step returned.",
      "",
      "Data",
      ...(facts.length ? facts.map((f) => `• ${f}`) : ["• Data unavailable beyond the draft notes."]),
      "",
      "Analysis",
      rewritePost(facts.slice(0, 5).join(". ") || cleaned, variant + 2).text,
      "",
      "Key findings",
      ...(facts.slice(0, 4).map((f) => `• ${f}`) || ["• Insufficient findings."]),
      "",
      "Implications",
      "Read the numbers in context. Missing fields stay unavailable — no estimates were added.",
      "",
      "Conclusion",
      "This article only uses facts present in the research input. It is informational, not advice.",
    ];
    text = sections.join("\n");
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
      `Facts used: ${facts.length}`,
      `Content score ${score.total}/100`,
    ],
  };
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


/** Locked factual layer for token content — never altered by regeneration. */
export type TokenFactSet = {
  identity: {
    name: string;
    symbol: string;
    chain: string;
    address: string;
  };
  metrics: Array<{ key: string; value: string }>;
  findings: string[];
  story: string | null;
  risks: string[];
  dexPaid: "paid" | "not_paid" | "unknown";
  boosts: number | null;
  builtAt: string;
};

export type RegenMode =
  | "default"
  | "stronger_hook"
  | "more_professional"
  | "more_viral"
  | "more_technical"
  | "more_human"
  | "more_concise"
  | "more_data"
  | "more_story"
  | "different_angle";

export function buildTokenFactSet(intel: TokenIntel): TokenFactSet {
  const { identity, market, analysis } = intel;
  const metrics: TokenFactSet["metrics"] = [];
  const push = (key: string, value: string | null | undefined) => {
    if (value && value !== "unavailable" && value !== "Data unavailable") {
      metrics.push({ key, value });
    }
  };
  push("price", formatPrice(market.priceUsd));
  if (market.priceChange1h != null) push("change_1h", `${market.priceChange1h.toFixed(1)}%`);
  if (market.priceChange6h != null) push("change_6h", `${market.priceChange6h.toFixed(1)}%`);
  if (market.priceChange24h != null) push("change_24h", `${market.priceChange24h.toFixed(1)}%`);
  push("liquidity", formatUsd(market.liquidityUsd));
  push("volume_24h", formatUsd(market.volume24h));
  push("market_cap", formatUsd(market.marketCap));
  push("fdv", formatUsd(market.fdv));
  if (market.buys24h != null || market.sells24h != null) {
    push("trades_24h", `${market.buys24h ?? "—"} buys / ${market.sells24h ?? "—"} sells`);
  }
  if (market.dexId) push("dex", market.dexId);

  const findings: string[] = [];
  if (market.priceChange24h != null && market.volume24h != null) {
    if (Math.abs(market.priceChange24h) > 15 && market.volume24h > 50_000) {
      findings.push(
        `Price moved ${market.priceChange24h >= 0 ? "+" : ""}${market.priceChange24h.toFixed(1)}% over 24h while volume printed ${formatUsd(market.volume24h)}.`,
      );
    }
  }
  if (market.liquidityUsd != null && market.marketCap != null && market.marketCap > 0) {
    const ratio = market.liquidityUsd / market.marketCap;
    if (ratio < 0.05) {
      findings.push(
        `Liquidity is thin relative to market cap (${(ratio * 100).toFixed(1)}% of mcap).`,
      );
    } else if (ratio > 0.25) {
      findings.push(
        `Liquidity is relatively deep versus market cap (${(ratio * 100).toFixed(1)}% of mcap).`,
      );
    }
  }
  if (market.volume24h != null && market.liquidityUsd != null && market.liquidityUsd > 0) {
    const turn = market.volume24h / market.liquidityUsd;
    if (turn > 3) {
      findings.push(`24h volume is ${turn.toFixed(1)}× liquidity — elevated turnover.`);
    }
  }
  if (market.priceChange24h != null && market.priceChange1h != null) {
    if (Math.sign(market.priceChange24h) !== Math.sign(market.priceChange1h) && Math.abs(market.priceChange1h) > 3) {
      findings.push(
        `Short-term (1h ${market.priceChange1h >= 0 ? "+" : ""}${market.priceChange1h.toFixed(1)}%) diverges from the 24h move.`,
      );
    }
  }
  for (const line of [analysis.snapshot, analysis.activity, analysis.marketStructure]) {
    if (line && !findings.includes(line)) findings.push(line);
  }

  const story = findings[0] ?? null;

  let dexPaid: TokenFactSet["dexPaid"] = "unknown";
  if (market.dexPaid === true) dexPaid = "paid";
  else if (market.dexPaid === false) dexPaid = "not_paid";

  return {
    identity: {
      name: identity.name,
      symbol: identity.symbol,
      chain: identity.chain,
      address: identity.address,
    },
    metrics,
    findings: findings.slice(0, 8),
    story,
    risks: analysis.risks.slice(0, 6),
    dexPaid,
    boosts: market.boostActive,
    builtAt: new Date().toISOString(),
  };
}

function factSetToDraft(facts: TokenFactSet): string {
  const lines = [
    `${facts.identity.name} (${facts.identity.symbol}) · ${facts.identity.chain}`,
    `CA: ${facts.identity.address}`,
    ...facts.metrics.map((m) => `${m.key}: ${m.value}`),
    `dex_paid: ${facts.dexPaid}`,
    facts.boosts != null ? `boosts: ${facts.boosts}` : "",
    "",
    "Key findings:",
    ...facts.findings.map((f) => `• ${f}`),
    "",
    "Risks:",
    ...facts.risks.map((r) => `• ${r}`),
    "",
    "Informational only — not financial advice. Unverified claims are omitted.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

function pickHook(facts: TokenFactSet, mode: RegenMode, variant: number): string {
  const candidates: string[] = [];
  if (facts.story) candidates.push(facts.story);
  for (const f of facts.findings) candidates.push(f);
  for (const m of facts.metrics) {
    if (m.key.includes("change") || m.key === "volume_24h" || m.key === "liquidity") {
      candidates.push(`${facts.identity.symbol}: ${m.key.replace(/_/g, " ")} ${m.value}`);
    }
  }
  if (!candidates.length) {
    candidates.push(
      `${facts.identity.name} (${facts.identity.symbol}) on ${facts.identity.chain} — reading the available market structure.`,
    );
  }
  const idx = Math.abs(variant) % candidates.length;
  let hook = candidates[idx]!;
  if (mode === "stronger_hook" || mode === "more_viral") {
    hook = hook.replace(/\.$/, "");
    if (!/[?]$/.test(hook) && variant % 2 === 0) {
      // observation emphasis, not fake claim
      hook = `Worth noting: ${hook.charAt(0).toLowerCase()}${hook.slice(1)}`;
    }
  }
  if (mode === "more_concise") {
    hook = hook.split(/[.—]/)[0]!.trim();
  }
  return hook;
}

/**
 * Generate token content from a locked FactSet.
 * Regeneration changes writing only — never the facts.
 */
export function generateFromFactSet(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode = "default",
  variant = 0,
): GeneratedContent {
  const draft = factSetToDraft(facts);
  const angleId =
    mode === "more_data"
      ? "data"
      : mode === "more_story"
        ? "story"
        : mode === "different_angle"
          ? undefined
          : "data";
  const base = generateFromDraft(draft, kind, angleId, variant);
  const hook = pickHook(facts, mode, variant);

  let text = base.text;
  // Force factual hook as first beat for posts
  if (kind === "post") {
    const rest = text.split(/\n\n+/).slice(1).join("\n\n");
    const metricLine = facts.metrics
      .filter((m) => ["price", "change_24h", "liquidity", "volume_24h", "market_cap"].includes(m.key))
      .slice(0, 4)
      .map((m) => `${m.key.replace(/_/g, " ")} ${m.value}`)
      .join(" · ");
    const riskLine = facts.risks[0] ? `Risk flag: ${facts.risks[0]}` : "";
    text = [hook, metricLine, rest || riskLine, "Informational only — not financial advice."]
      .filter(Boolean)
      .join("\n\n");
    if (mode === "more_concise") {
      text = [hook, metricLine].filter(Boolean).join("\n\n");
    }
    if (mode === "more_technical") {
      text = [
        hook,
        facts.metrics.map((m) => `${m.key}: ${m.value}`).join("\n"),
        facts.dexPaid !== "unknown" ? `dex_paid: ${facts.dexPaid}` : "dex_paid: unknown",
        riskLine,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  // Strip hype phrases that rewrite may introduce
  text = text
    .replace(/\b(about to explode|guaranteed|100x|to the moon|ape in)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const score = scoreContent(text, kind);
  // Penalty already in scoreContent; reinforce data quality via applied notes
  return {
    kind,
    angle: base.angle,
    text,
    score,
    applied: [
      ...base.applied,
      `Fact set locked (${facts.metrics.length} metrics, ${facts.findings.length} findings)`,
      `Mode: ${mode}`,
      `Variant: ${variant}`,
      `Story: ${facts.story ? "derived from data" : "none"}`,
    ],
  };
}

export function generateFromToken(
  intel: TokenIntel,
  kind: ContentKind,
  angleId?: string,
  variant = 0,
): GeneratedContent {
  const facts = buildTokenFactSet(intel);
  if (angleId === "story") {
    return generateFromFactSet(facts, kind, "more_story", variant);
  }
  if (angleId === "data") {
    return generateFromFactSet(facts, kind, "more_data", variant);
  }
  return generateFromFactSet(facts, kind, "default", variant);
}

/** Unlimited regeneration — same FactSet, new writing. */
export function regenerateFromFactSet(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode,
  previousVariant: number,
): GeneratedContent {
  return generateFromFactSet(facts, kind, mode, previousVariant + 1 + Math.floor(Math.random() * 17));
}
