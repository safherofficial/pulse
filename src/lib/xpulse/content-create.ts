/**
 * Content angles + generation helpers for posts / threads / articles.
 * Token copy follows a locked market diagnosis. Style can change.
 * The price, market cap, and market-state conclusion cannot.
 */

import { rewritePost } from "./rewrite.ts";
import { scoreContent, type ContentKind, type ContentScoreReport } from "./content-score.ts";
import { EDITORIAL_ENGINE_VERSION, validateEditorialShape } from "./editorial-standard.ts";
import { formatMarketCapCompact, formatTokenPrice, marketCapBand } from "./format.ts";
import { analyzeTokenIntel, type MarketDiagnosis } from "./market-state.ts";
import type { TokenIntel } from "./token-intel.ts";

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

function formatUsd(n: number | null): string {
  if (n == null) return "unavailable";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function tokenBrief(intel: TokenIntel): string {
  const { identity, market, analysis } = intel;
  const lines = [
    `${identity.name} (${identity.symbol}) · ${identity.chain}`,
    `CA: ${identity.address}`,
    `Price: ${formatTokenPrice(market.priceUsd) ?? "unavailable"}`,
    `24h change: ${market.priceChange24h != null ? `${market.priceChange24h.toFixed(1)}%` : "unavailable"}`,
    `Liquidity: ${formatUsd(market.liquidityUsd)}`,
    `24h volume: ${formatUsd(market.volume24h)}`,
    `Market cap: ${formatMarketCapCompact(market.marketCap) ?? "unavailable"}`,
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

function hasEnoughSourceMaterial(draft: string): boolean {
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
      text: "More source material is required before creating a reliable analysis.",
      score,
      applied: ["Blocked: empty source input"],
    };
  }

  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const minimumFacts = kind === "thread" ? 4 : kind === "article" ? 3 : 2;
  const minimumWords = kind === "thread" ? 60 : kind === "article" ? 80 : 40;
  if (!hasEnoughSourceMaterial(cleaned) || (kind !== "post" && facts.length < minimumFacts && wordCount < minimumWords)) {
    const score = scoreContent(cleaned, kind);
    return {
      kind,
      angle,
      text: "More source material is required before creating reliable editorial content.\n\nAdd concrete facts, numbers, verified events, or source context, then generate again.",
      score,
      applied: ["Blocked: insufficient editorial source density", `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`],
    };
  }

  const seeded = applyAnglePrefix(cleaned, angle);
  const rewritten = rewritePost(seeded, variant);
  let text = rewritten.text;

  if (kind === "post") {
    const lead = facts[0] ?? text.split(/\n+/)[0] ?? text;
    const body = text.replace(lead, "").trim() || facts.slice(1, 3).join(" ");
    text = [lead, body].filter(Boolean).join("\n\n").slice(0, 1200);
  }

  if (kind === "thread") {
    const units = rewritePost(seeded, variant)
      .text
      .split(/\n\s*\n|\n+/)
      .map((line) => line.replace(/^\s*\d+\s*[/.):-]\s*/, "").trim())
      .filter((line) => line.length >= 12);
    const ordered = [...new Set([...facts, ...units])].slice(0, 8);
    const beats = ordered.slice(0, 8);
    if (beats.length >= 4) {
      const relationship = facts.length >= 2
        ? "Read together, " + facts[0] + " and " + facts[1].toLowerCase()
        : null;
      if (relationship && beats.length < 8) beats.splice(2, 0, relationship);
      text = beats
        .slice(0, 8)
        .map((beat, index) => (index + 1) + "/ " + beat.replace(/\s+/g, " ").slice(0, 268))
        .join("\n\n");
    } else {
      text = beats.map((beat, index) => (index + 1) + "/ " + beat).join("\n\n");
    }
  }
  if (kind === "article") {
    const units = rewritePost(cleaned, variant).text
      .split(/\n\s*\n|\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 20);
    const evidence = facts.slice(0, 6);
    const thesis = evidence.length >= 2
      ? "The editorial angle is in the relationship between " + evidence[0] + " and " + evidence[1].toLowerCase()
      : "The source contains a limited but concrete set of observations.";
    const title = facts[0] ?? units[0] ?? "Market note";
    const sections = [
      title,
      "",
      "The setup",
      units[0] ?? cleaned,
      "",
      "What the source establishes",
      evidence.length ? evidence.slice(0, 3).join(" ") : cleaned,
      "",
      "Where the signals connect",
      thesis,
      evidence.slice(2, 5).join(" "),
      "",
      "What remains uncertain",
      "Only claims supported by the supplied source are included. Missing information is not filled with assumptions.",
      "",
      "Conclusion",
      units.slice(1, 3).join(" ") || thesis,
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
      `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`,
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
  xPatterns: string[];
  xNote: string | null;
  market: MarketDiagnosis;
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
  push("price", formatTokenPrice(market.priceUsd));
  if (market.priceChange1h != null) push("change_1h", `${market.priceChange1h.toFixed(1)}%`);
  if (market.priceChange6h != null) push("change_6h", `${market.priceChange6h.toFixed(1)}%`);
  if (market.priceChange24h != null) push("change_24h", `${market.priceChange24h.toFixed(1)}%`);
  push("liquidity", formatUsd(market.liquidityUsd));
  push("volume_24h", formatUsd(market.volume24h));
  push("market_cap", formatMarketCapCompact(market.marketCap));
  push("cap_band", marketCapBand(market.marketCap));
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

  let dexPaid: TokenFactSet["dexPaid"] = "unknown";
  if (market.dexPaid === true) dexPaid = "paid";
  else if (market.dexPaid === false) dexPaid = "not_paid";

  const diagnosis = analyzeTokenIntel(intel);

  return {
    identity: {
      name: identity.name,
      symbol: identity.symbol,
      chain: identity.chain,
      address: identity.address,
    },
    metrics,
    findings: [...diagnosis.facts, ...diagnosis.conclusions, ...findings].slice(0, 12),
    story: diagnosis.headline,
    risks: [
      ...diagnosis.signals
        .filter((signal) => signal.polarity === "risk")
        .map((signal) => signal.explanation),
      ...analysis.risks,
    ].slice(0, 8),
    dexPaid,
    boosts: market.boostActive,
    xPatterns: [],
    xNote: null,
    market: diagnosis,
    builtAt: new Date().toISOString(),
  };
}

export function attachXPatterns(
  facts: TokenFactSet,
  patterns: string[],
  note: string | null,
): TokenFactSet {
  return {
    ...facts,
    xPatterns: patterns.slice(0, 6),
    xNote: note,
  };
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: Rng, items: T[]): T {
  return items[Math.floor(rng() * Math.max(items.length, 1)) % Math.max(items.length, 1)]!;
}

function metric(facts: TokenFactSet, key: string): string | null {
  return facts.metrics.find((m) => m.key === key)?.value ?? null;
}

type Tape = {
  name: string;
  symbol: string;
  ticker: string;
  chain: string;
  ca: string;
  price: string | null;
  mcap: string | null;
  band: string | null;
};

function readTape(facts: TokenFactSet): Tape {
  return {
    name: facts.identity.name,
    symbol: facts.identity.symbol,
    ticker: `$${facts.identity.symbol}`,
    chain: facts.identity.chain,
    ca: facts.identity.address,
    price: metric(facts, "price"),
    mcap: metric(facts, "market_cap"),
    band: metric(facts, "cap_band"),
  };
}

type Voice =
  | "desk"
  | "rally"
  | "operator"
  | "story"
  | "tape"
  | "brief"
  | "street"
  | "thesis"
  | "whisper"
  | "board";

function voicesFor(mode: RegenMode): Voice[] {
  switch (mode) {
    case "stronger_hook":
    case "more_viral":
      return ["rally", "street", "tape", "whisper"];
    case "more_professional":
      return ["desk", "brief", "board", "thesis"];
    case "more_technical":
      return ["operator", "desk", "tape"];
    case "more_human":
    case "more_story":
      return ["story", "whisper", "rally", "street"];
    case "more_concise":
      return ["tape", "whisper", "street"];
    case "more_data":
      return ["operator", "desk", "tape"];
    default:
      return ["desk", "rally", "operator", "story", "tape", "brief", "street", "thesis", "whisper", "board"];
  }
}

function angleForVoice(voice: Voice): ContentAngle {
  const map: Record<Voice, string> = {
    desk: "breaking",
    rally: "why",
    operator: "data",
    story: "story",
    tape: "data",
    brief: "why",
    street: "breaking",
    thesis: "edu",
    whisper: "contrarian",
    board: "why",
  };
  return ANGLES.find((a) => a.id === map[voice]) ?? ANGLES[0]!;
}

function disclaimer(rng: Rng, t: Tape): string {
  return pick(rng, [
    "Not financial advice. Read the tape yourself.",
    "Informational only — size your own risk.",
    "NFA. Liquidity and flow can flip without notice.",
    `NFA. ${t.ticker} data above is observed, not a forecast.`,
    "Do your own work. This is a market note, not a recommendation.",
  ]);
}

function caLine(rng: Rng, t: Tape): string {
  return pick(rng, [
    `CA: ${t.ca}`,
    `Contract on ${t.chain}:\n${t.ca}`,
    `${t.ticker} · ${t.chain}\n${t.ca}`,
  ]);
}

function scaleNote(band: string | null): string {
  if (band === "micro-cap") return " Still a micro-cap.";
  if (band === "small-cap") return " Small-cap range.";
  if (band === "mid-cap") return " Mid-cap size.";
  if (band === "large-cap") return " Large-cap size.";
  return "";
}

function marketLine(rng: Rng, t: Tape): string | null {
  const scale = scaleNote(t.band);
  if (t.price && t.mcap) {
    return pick(rng, [
      `${t.ticker} is sitting around ${t.price} at a ~${t.mcap}.${scale}`,
      `At roughly ${t.mcap}, ${t.ticker} is at ${t.price}.${scale}`,
      `${t.price} price, ~${t.mcap}.${scale}`,
      `${t.mcap}. That's the frame. Spot is ${t.price}.`,
    ])
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+\./g, ".")
      .trim();
  }
  if (t.mcap) return `${t.mcap}.`;
  if (t.price) return `Last price is ${t.price}.`;
  return null;
}

function lockTokenIdentity(text: string, facts: TokenFactSet): string {
  const symbol = facts.identity.symbol.trim();
  const name = facts.identity.name.trim();
  if (!symbol) return text;

  // Token-generated copy is about one locked asset. Any $TICKER emitted by a
  // writer must resolve to the fact-set ticker; this prevents hallucinated
  // tickers such as $ROXIE when the source asset is $VOXIE.
  const tickerPattern = /\$[A-Za-z][A-Za-z0-9_]{1,15}\b/g;
  let out = text.replace(tickerPattern, (match) => {
    const candidate = match.slice(1);
    return candidate.toLowerCase() === symbol.toLowerCase() ? match : '$' + symbol;
  });

  // Normalize an all-caps token name directly adjacent to the canonical ticker.
  if (name) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
    const nearTicker = new RegExp("\\b[A-Z][A-Z0-9_-]{2,24}\\b(?=\\s*\\$" + escapedSymbol + "\\b)", "g");
    out = out.replace(nearTicker, name);
  }

  // The opening line of token-generated copy is an identity-bearing field.
  // If it starts with a different all-caps token name while the canonical
  // ticker is present later, normalize that token name to the fact-set name.
  const lines = out.split(/\n/);
  if (lines.length && out.toLowerCase().includes("$" + symbol.toLowerCase())) {
    lines[0] = lines[0].replace(/^\s*([A-Z][A-Z0-9_-]{2,24})(?=\s+(?:is|has|on|at|does|:))/,
      (match, candidate: string) => candidate.toLowerCase() === name.toLowerCase() || candidate.toLowerCase() === symbol.toLowerCase()
        ? match
        : name);
    out = lines.join("\n");
  }

  return out;
}
export function ensureLockedMarket(text: string, facts: TokenFactSet): string {
  const price = metric(facts, "price");
  const mcap = metric(facts, "market_cap");
  const out = text.trim();
  const hasPrice = !price || out.includes(price);
  const hasMcap = !mcap || out.includes(mcap);
  if (hasPrice && hasMcap) return out;
  if (price && mcap && !out.includes(price) && !out.includes(mcap)) {
    return `${out}\n\n${price} price, ~${mcap}.`.trim();
  }
  if (mcap && !out.includes(mcap)) return `${out}\n\nAt roughly ${mcap}.`.trim();
  if (price && !out.includes(price)) return `${out}\n\nSpot is ${price}.`.trim();
  return out;
}

function polish(text: string): string {
  return text
    .replace(/\b(about to explode|guaranteed|100x|to the moon|ape in|can't miss|risk-free)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function opener(rng: Rng, voice: Voice, t: Tape, market: MarketDiagnosis): string {
  const severe = market.state === "SEVERE_RISK" || market.state === "COLLAPSED";
  if (severe) {
    if (voice === "rally" || voice === "street" || voice === "tape" || voice === "whisper") {
      return pick(rng, [
        `${t.ticker} does not get a hype post. The tape is the post.`,
        `Stop framing ${t.ticker} as a setup. Read the damage first.`,
        `${t.ticker}: this is a warning, written ${voice === "tape" ? "tight" : "out loud"}.`,
      ]);
    }
    return pick(rng, [
      `A straight read on ${t.ticker}. No pitch.`,
      `${t.name} on ${t.chain}. The numbers come before any adjective.`,
      `Desk note, not a rally: ${t.ticker}.`,
    ]);
  }
  if (market.state === "BEARISH" || market.state === "CAUTION") {
    return pick(rng, [
      `${t.ticker} is weakening. The useful question is what the pair is actually doing.`,
      `Downside first on ${t.ticker}. Style does not get a vote.`,
      `A ${voice} telling of a weak tape. The weakness stays.`,
    ]);
  }
  if (market.state === "BULLISH" || market.state === "POSITIVE") {
    return pick(rng, [
      `${t.ticker} is ahead on the window we can actually measure.`,
      `The constructive part of ${t.ticker} is the measured move, not a slogan.`,
      `${t.name} has a positive print. That is the claim, and it stops there.`,
    ]);
  }
  return pick(rng, [
    `${t.ticker} is not offering a clean directional story.`,
    `Balanced note on ${t.ticker}. Missing fields stay missing.`,
    `No campaign here. ${t.ticker} is a snapshot.`,
  ]);
}

function closeFor(rng: Rng, market: MarketDiagnosis, t: Tape): string {
  if (market.state === "COLLAPSED" || market.state === "SEVERE_RISK") {
    return pick(rng, [
      "Treat this as scrutiny, not an entry pitch.",
      "The close is the risk, not a call to size up.",
      `${t.ticker} needs verification before anyone calls it an opportunity.`,
    ]);
  }
  if (market.state === "BEARISH" || market.state === "CAUTION") {
    return pick(rng, [
      "The weakness is the story until the pair says otherwise.",
      "Do not upgrade a weak tape into a narrative.",
    ]);
  }
  if (market.state === "BULLISH" || market.state === "POSITIVE") {
    return pick(rng, [
      "The positive read stops where the data stops.",
      "Momentum is only the part the snapshot can support.",
    ]);
  }
  return pick(rng, [
    "No directional claim beyond this snapshot.",
    "Flat is a result. It is not a tease.",
  ]);
}

function lockedLines(market: MarketDiagnosis, snap: string | null): string[] {
  const lines = [market.headline, snap];
  for (const fact of market.facts) {
    if (fact !== market.headline) lines.push(fact);
  }
  for (const signal of market.signals) {
    if (signal.polarity === "risk" && !lines.includes(signal.explanation)) lines.push(signal.explanation);
  }
  if (market.rugLine && !lines.includes(market.rugLine)) lines.push(market.rugLine);
  const x = market.facts.find((fact) => /public x/i.test(fact));
  if (x && !lines.includes(x)) lines.push(x);
  return lines.filter((line): line is string => Boolean(line));
}

const PROMO =
  /\b(exciting opportunity|great potential|could explode|high potential|to the moon|still early|promising setup|room is awake|strong opportunity)\b/gi;

export function ensureMarketVerdict(text: string, facts: TokenFactSet): string {
  const market = facts.market;
  let out = text.trim();
  if (!market) return out;
  if (market.headline && !out.includes(market.headline)) out = `${out}\n\n${market.headline}`;
  if (market.rugLine && !out.includes(market.rugLine)) out = `${out}\n\n${market.rugLine}`;
  if (market.state === "SEVERE_RISK" || market.state === "COLLAPSED" || market.state === "BEARISH" || market.state === "CAUTION") {
    out = out.replace(PROMO, "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function pickEvidence(facts: TokenFactSet, limit: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const line of [...facts.market.facts, ...facts.findings, ...facts.market.conclusions]) {
    const value = line?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
    if (unique.length >= limit) break;
  }
  return unique;
}

function pickInterpretations(facts: TokenFactSet, limit: number): string[] {
  return facts.market.signals
    .filter((signal) => signal.basis !== "fact")
    .map((signal) => signal.explanation)
    .filter((line) => line && line !== facts.market.headline)
    .slice(0, limit);
}

function fitThreadBeat(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 260) return clean;
  const words = clean.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? out + " " + word : word;
    if (next.length > 257) break;
    out = next;
  }
  return out ? out + "…" : clean.slice(0, 257) + "…";
}

function fitPost(text: string): string {
  const clean = polish(text).replace(/\\n{3,}/g, "\\n\\n").trim();
  if (clean.length <= 280) return clean;
  const beats = clean.split(/\\n\\n/).filter(Boolean);
  const compact = beats.slice(0, 4).join("\\n\\n");
  if (compact.length <= 280) return compact;
  return compact.slice(0, 277).replace(/\\s+\\S*$/, "") + "…";
}

function writeStatePost(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(
    variant * 9973 + 13 + hashStr(facts.identity.address + facts.builtAt + mode),
  );
  const voice = pick(rng, voicesFor(mode));
  const t = readTape(facts);
  const market = facts.market;
  const snap = marketLine(rng, t);
  const evidence = pickEvidence(facts, 3);
  const interpretation = pickInterpretations(facts, 2);

  // Professional X post arc: hook -> proof -> read -> payoff.
  const hook = opener(rng, voice, t, market);
  const proof = [snap, evidence[0]].filter(Boolean).join(" ");
  const read = interpretation[0] ?? evidence[1] ?? null;
  const payoff = closeFor(rng, market, t);

  return {
    text: fitPost([hook, proof, read, payoff].filter(Boolean).join("\n\n")),
    voice,
  };
}

function writeStateThread(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(
    variant * 4999 + 101 + hashStr(facts.identity.symbol + mode),
  );
  const voice = pick(rng, voicesFor(mode));
  const t = readTape(facts);
  const market = facts.market;
  const evidence = pickEvidence(facts, 5);
  const interpretations = pickInterpretations(facts, 4);
  const risk = market.signals.find((signal) => signal.polarity === "risk")?.explanation ?? market.rugLine;
  const social = market.facts.find((fact) => /public x|official/i.test(fact));

  // Professional thread arc: thesis -> context -> evidence -> turn -> payoff.
  const beats = [
    opener(rng, voice, t, market),
    market.headline,
    snapLine(t, market),
    evidence[0],
    evidence[1],
    interpretations[0] ?? relationshipLine(facts),
    evidence[2],
    risk ?? interpretations[1],
    social ?? interpretations[2],
    closeFor(rng, market, t),
  ].filter((line): line is string => Boolean(line));

  const unique = [...new Set(beats.map((beat) => beat.trim()).filter(Boolean))].slice(0, 8);
  const text = unique
    .map((beat, index) => `${index + 1}/ ${fitThreadBeat(beat.replace(/^\\d+\\/\\s*/, ""))}`)
    .join("\\n\\n");

  return { text: polish(text), voice };
}

function relationshipLine(facts: TokenFactSet): string | null {
  const signal = facts.market.signals.find(
    (item) => item.type === "volume_liquidity" || item.type === "sell_pressure" || item.type === "flow",
  );
  return signal?.explanation ?? null;
}

function snapLine(t: Tape, market: MarketDiagnosis): string {
  const pieces = [
    t.price ? "Price " + t.price : null,
    t.mcap ? "market cap " + t.mcap : null,
    t.band ? t.band : null,
  ].filter(Boolean);
  if (pieces.length) return pieces.join(" · ") + ".";
  return market.facts.find((fact) => /price|market cap/i.test(fact)) ?? t.ticker + " on " + t.chain + ".";
}

function writeStateArticle(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(
    variant * 3343 + 7 + hashStr(facts.identity.name + mode),
  );
  const voice = pick(rng, voicesFor(mode === "default" ? "more_professional" : mode));
  const t = readTape(facts);
  const market = facts.market;
  const evidence = pickEvidence(facts, 7);
  const interpretations = pickInterpretations(facts, 5);
  const social = market.facts.find((fact) => /public x|official/i.test(fact));

  const title =
    market.state === "SEVERE_RISK" || market.state === "COLLAPSED" || market.state === "BEARISH"
      ? `${t.ticker}: reading the tape without turning it into a pitch`
      : `${t.ticker} on ${t.chain}: what the current tape actually says`;

  const sections = [
    title,
    "",
    market.headline ?? "A data-led snapshot of the token using only the fields returned by the current research pass.",
    "",
    "What happened",
    opener(rng, voice, t, market) + " " + (snapLine(t, market) ?? ""),
    "",
    "What the data shows",
    evidence.slice(0, 4).map((line) => line.trim().replace(/^[•-]\\s*/, "")).join(" "),
    "",
    "What it means",
    interpretations.slice(0, 3).join(" ") ||
      "The available evidence supports a measured snapshot, but not a stronger inference.",
    "",
    "The tension",
    [evidence[4], social, interpretations[3]].filter(Boolean).join(" ") ||
      "No additional signal is strong enough to extend the thesis without overstating the evidence.",
    "",
    "What remains uncertain",
    market.rugLine
      ? market.rugLine + " " + (riskContext(facts) ?? "")
      : facts.risks[0] ?? "Missing fields remain unresolved; they are not estimated.",
    "",
    "Bottom line",
    closeFor(rng, market, t) + " " +
      (market.caveats[0] ?? "The conclusion remains limited to the current snapshot."),
    "",
    "Contract",
    t.ca,
    "",
    disclaimer(rng, t),
  ];

  return { text: polish(sections.join("\\n")), voice };
}

function riskContext(facts: TokenFactSet): string | null {
  return facts.market.caveats.find((line) => /confirm|evidence|uncertain|verify/i.test(line)) ??
    facts.risks.find((line) => /liquidity|sell|collapse|risk/i.test(line)) ??
    null;
}

export function generateFromFactSet(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode = "default",
  variant = 0,
): GeneratedContent {
  const written =
    kind === "thread"
      ? writeStateThread(facts, mode, variant)
      : kind === "article"
        ? writeStateArticle(facts, mode, variant)
        : writeStatePost(facts, mode, variant);

  const text = lockTokenIdentity(ensureMarketVerdict(ensureLockedMarket(written.text, facts), facts), facts);
  const editorialGate = validateEditorialShape(text, kind);
  const score = scoreContent(text, kind);
  return {
    kind,
    angle: angleForVoice(written.voice),
    text,
    score,
    applied: [
      `Editorial engine: ${EDITORIAL_ENGINE_VERSION}`,
      `Editorial gate: ${editorialGate.pass ? "passed" : editorialGate.violations.join(", ")}`,
      `Market state: ${facts.market.state}`,
      `Rug-pull risk: ${facts.market.rugPullRisk}`,
      `XPulse risk score: ${facts.market.riskScore} (${facts.market.riskBand})`,
      `Copy voice: ${written.voice}`,
      `Fact set locked (${facts.metrics.length} metrics, ${facts.findings.length} findings)`,
      `Mode: ${mode}`,
      `Variant: ${variant}`,
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
  const facts = buildTokenFactSet(intel);
  if (angleId === "story") return generateFromFactSet(facts, kind, "more_story", variant);
  if (angleId === "data") return generateFromFactSet(facts, kind, "more_data", variant);
  return generateFromFactSet(facts, kind, "default", variant);
}

export function regenerateFromFactSet(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode,
  previousVariant: number,
): GeneratedContent {
  const jump = previousVariant + 5 + Math.floor(Math.random() * 47);
  const cycle: RegenMode[] = [
    "default",
    "stronger_hook",
    "more_viral",
    "more_professional",
    "more_human",
    "more_story",
    "different_angle",
    "more_data",
  ];
  const nextMode = mode === "default" ? cycle[jump % cycle.length]! : mode;
  return generateFromFactSet(facts, kind, nextMode, jump);
}
