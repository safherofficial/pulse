/**
 * Content angles + generation helpers for posts / threads / articles.
 * Token posts are written as professional bull copy from a locked fact set.
 * Regeneration changes voice and structure — never invents market facts.
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
      ...facts.slice(0, 4).map((f) => `• ${f}`),
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
    story: findings[0] ?? null,
    risks: analysis.risks.slice(0, 6),
    dexPaid,
    boosts: market.boostActive,
    xPatterns: [],
    xNote: null,
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

function parseChange(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

type Tape = {
  name: string;
  symbol: string;
  ticker: string;
  chain: string;
  ca: string;
  price: string | null;
  ch1h: string | null;
  ch6h: string | null;
  ch24h: string | null;
  ch24n: number | null;
  liq: string | null;
  vol: string | null;
  mcap: string | null;
  fdv: string | null;
  trades: string | null;
  dex: string | null;
  bullish: boolean;
  red: boolean;
  hot: boolean;
};

function readTape(facts: TokenFactSet): Tape {
  const ch24h = metric(facts, "change_24h");
  const ch24n = parseChange(ch24h);
  return {
    name: facts.identity.name,
    symbol: facts.identity.symbol,
    ticker: `$${facts.identity.symbol}`,
    chain: facts.identity.chain,
    ca: facts.identity.address,
    price: metric(facts, "price"),
    ch1h: metric(facts, "change_1h"),
    ch6h: metric(facts, "change_6h"),
    ch24h,
    ch24n,
    liq: metric(facts, "liquidity"),
    vol: metric(facts, "volume_24h"),
    mcap: metric(facts, "market_cap"),
    fdv: metric(facts, "fdv"),
    trades: metric(facts, "trades_24h"),
    dex: metric(facts, "dex"),
    bullish: ch24n != null && ch24n >= 5,
    red: ch24n != null && ch24n <= -5,
    hot: ch24n != null && Math.abs(ch24n) >= 15,
  };
}

function signed(change: string | null): string | null {
  if (!change) return null;
  return change.startsWith("+") || change.startsWith("-") ? change : `+${change}`;
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

function moveLine(t: Tape): string | null {
  if (!t.ch24h) return null;
  const s = signed(t.ch24h)!;
  if (t.bullish) return `${t.ticker} is printing ${s} on the 24h.`;
  if (t.red) return `${t.ticker} just reset ${s} on the 24h — the tape is live.`;
  return `${t.ticker} holds ${s} over 24h. Tight range. Cleaner than it looks.`;
}

function flowLine(t: Tape): string | null {
  const bits: string[] = [];
  if (t.vol) bits.push(`${t.vol} traded in 24h`);
  if (t.liq) bits.push(`${t.liq} sitting in the pool`);
  if (t.trades) bits.push(t.trades);
  if (!bits.length) return null;
  if (bits.length === 1) return `Flow check: ${bits[0]}.`;
  return `Flow check: ${bits[0]}, ${bits.slice(1).join(", ")}.`;
}

function structureLine(t: Tape): string | null {
  const bits: string[] = [];
  if (t.price) bits.push(`spot ${t.price}`);
  if (t.mcap) bits.push(`mcap ${t.mcap}`);
  if (t.liq) bits.push(`liq ${t.liq}`);
  if (t.fdv && t.fdv !== t.mcap) bits.push(`fdv ${t.fdv}`);
  if (!bits.length) return null;
  return bits.join(" · ");
}

function whyNow(rng: Rng, t: Tape, facts: TokenFactSet): string {
  if (t.hot && t.bullish) {
    return pick(rng, [
      "That is not a quiet candle. Attention is already here.",
      "When the 24h stretches like this, timelines start compounding.",
      "The market is pricing a new range in public.",
    ]);
  }
  if (t.hot && t.red) {
    return pick(rng, [
      "Violent prints cut both ways. This is where serious readers look twice.",
      "A hard 24h is not the end of a story. It is a new page.",
      "Dislocation is when the next bid or the next exit gets decided.",
    ]);
  }
  if (t.vol && t.liq) {
    return pick(rng, [
      "Volume against that liquidity is the actual headline.",
      "Price is the poster. Flow is the plot.",
      "Ignore the slogan. Watch how much size the pool is absorbing.",
    ]);
  }
  if (facts.findings[0]) return facts.findings[0];
  return pick(rng, [
    "The setup is on the screen. The rest is positioning.",
    "This is a market structure note — not a myth.",
  ]);
}

function hook(rng: Rng, voice: Voice, t: Tape, facts: TokenFactSet): string {
  const move = t.ch24h ? signed(t.ch24h) : null;
  const nameHit = `${t.name} (${t.ticker})`;
  switch (voice) {
    case "rally":
      if (t.bullish && move) {
        return pick(rng, [
          `${t.ticker} just tagged ${move} in 24h. The room is awake.`,
          `Stop scrolling past ${t.ticker}. ${move} on the day, and the tape is still working.`,
          `${nameHit} is not whispering. ${move} in 24 hours.`,
        ]);
      }
      return pick(rng, [
        `${t.ticker} is on the desk. ${t.chain} is the venue.`,
        `If you cover ${t.chain} flow, ${t.ticker} belongs in the next look.`,
        `${nameHit} — this is the name people will ask you about.`,
      ]);
    case "street":
      return pick(rng, [
        move ? `${t.ticker} ${move} / 24h. That's the post.` : `${t.ticker} is in play on ${t.chain}.`,
        t.vol ? `${t.ticker} ran ${t.vol} volume today. Not a ghost candle.` : `${t.ticker}. Live market. Live tape.`,
        `${t.ticker} doesn't need a novel. It needs a look.`,
      ]);
    case "tape":
      return pick(rng, [
        [t.ticker, move, t.price ? `@ ${t.price}` : null, t.vol ? `vol ${t.vol}` : null]
          .filter(Boolean)
          .join(" · "),
        `${t.ticker} tape: ${[move, t.liq ? `liq ${t.liq}` : null, t.vol ? `vol ${t.vol}` : null].filter(Boolean).join(" · ")}`,
      ]);
    case "whisper":
      return pick(rng, [
        `Most people will notice ${t.ticker} late. The print is already on the board.`,
        `Quiet note on ${t.ticker} — then you can go back to the timeline.`,
        `You don't need a thread. You need one honest look at ${t.ticker}.`,
      ]);
    case "story":
      return pick(rng, [
        `${t.name} showed up on ${t.chain} with a market that is actually moving.`,
        `Every cycle has a name that starts as a ticker and becomes a conversation. Today the ticker is ${t.ticker}.`,
        `Here is the ${t.ticker} story as the market wrote it — not as a slogan.`,
      ]);
    case "brief":
      return pick(rng, [
        `Market brief: ${nameHit} on ${t.chain}.`,
        `${t.ticker} — what the available market data supports right now.`,
        `Desk note on ${t.name}. Facts only, written so a stranger can follow.`,
      ]);
    case "board":
      return pick(rng, [
        `${t.ticker} for the board: structure first, narrative second.`,
        `Investment-committee tone, crypto venue: ${nameHit}.`,
        `${t.name} in one page. No mythology.`,
      ]);
    case "operator":
      return pick(rng, [
        `${t.ticker} market structure — ${t.chain}.`,
        `Operator read on ${t.ticker}. Numbers first.`,
        `${t.ticker} internals from the pair, not from the replies.`,
      ]);
    case "thesis":
      return pick(rng, [
        `A clean way to read ${t.ticker} without the carnival.`,
        `Thesis, not a chant: ${nameHit}.`,
        `What ${t.ticker} is doing on-chain in the last 24 hours.`,
      ]);
    default:
      return pick(rng, [
        move ? `${t.ticker} prints ${move} over 24h${t.price ? ` at ${t.price}` : ""}.` : `${nameHit} — live on ${t.chain}.`,
        t.vol && move ? `${t.ticker}: ${move} with ${t.vol} through the book.` : `${nameHit} is on the tape.`,
        facts.story ?? `${t.ticker} is the name. ${t.chain} is the market.`,
      ]);
  }
}

function body(rng: Rng, voice: Voice, t: Tape, facts: TokenFactSet): string[] {
  const lines: string[] = [];
  const move = moveLine(t);
  const flow = flowLine(t);
  const structure = structureLine(t);
  const why = whyNow(rng, t, facts);
  const finding = pick(rng, facts.findings.length ? facts.findings : [why]);
  const risk = facts.risks[0]
    ? pick(rng, [
        `Risk on the sheet: ${facts.risks[0]}`,
        `Keep this visible: ${facts.risks[0]}`,
        `The honest caveat — ${facts.risks[0]}`,
      ])
    : null;

  if (voice === "tape" || voice === "operator") {
    if (structure) lines.push(structure);
    if (t.ch1h) lines.push(`1h ${signed(t.ch1h)} · 6h ${signed(t.ch6h) ?? "n/a"} · 24h ${signed(t.ch24h) ?? "n/a"}`);
    if (flow) lines.push(flow);
    if (t.dex) lines.push(`Venue: ${t.dex} on ${t.chain}.`);
    if (facts.dexPaid === "paid") lines.push("Dex listing is marked paid.");
    if (facts.boosts) lines.push(`Active boosts on the pair: ${facts.boosts}.`);
    if (finding && finding !== structure) lines.push(finding);
    if (risk) lines.push(risk);
    return lines;
  }

  if (voice === "rally" || voice === "street") {
    if (move) lines.push(move);
    lines.push(
      pick(rng, [
        t.liq && t.vol
          ? `That move is sitting on ${t.liq} liquidity with ${t.vol} through the day. That is a market, not a caption.`
          : `The name is ${t.name}. The chain is ${t.chain}. The contract is below.`,
        t.mcap
          ? `Market cap ${t.mcap}${t.liq ? `, pool ${t.liq}` : ""}. This is the frame — not a promise.`
          : why,
      ]),
    );
    if (t.trades) lines.push(`Order flow: ${t.trades}. That's people, not a render.`);
    else if (flow) lines.push(flow);
    lines.push(why);
    if (risk) lines.push(risk);
    return lines;
  }

  if (voice === "story" || voice === "whisper") {
    lines.push(
      pick(rng, [
        `Start with the name: ${t.name}. Then look at what the pair actually did.`,
        `${t.ticker} is not a vibe. It is a book with a last price${t.price ? ` of ${t.price}` : ""}.`,
      ]),
    );
    if (move) lines.push(move);
    if (flow) lines.push(flow);
    lines.push(why);
    if (finding && finding !== why) lines.push(finding);
    if (risk) lines.push(risk);
    return lines;
  }

  if (voice === "board" || voice === "brief" || voice === "thesis") {
    lines.push(
      pick(rng, [
        `${t.name} trades on ${t.chain}${t.dex ? ` via ${t.dex}` : ""}.`,
        `Venue: ${t.chain}${t.dex ? ` / ${t.dex}` : ""}. Identity is the contract, not the ticker art.`,
      ]),
    );
    if (structure) lines.push(`Structure: ${structure}.`);
    if (move) lines.push(move);
    if (flow) lines.push(flow);
    lines.push(why);
    if (risk) lines.push(risk);
    return lines;
  }

  if (move) lines.push(move);
  if (structure) lines.push(structure);
  if (flow) lines.push(flow);
  lines.push(why);
  if (finding && finding !== why) lines.push(finding);
  if (risk) lines.push(risk);
  return lines;
}

function close(rng: Rng, voice: Voice, t: Tape): string {
  if (voice === "rally" || voice === "street") {
    return pick(rng, [
      `If you write about ${t.chain}, this is the CA worth keeping.`,
      `Save the contract. Argue after you look.`,
      `The chart is public. The contract is below.`,
    ]);
  }
  if (voice === "whisper") {
    return pick(rng, [
      "That's the note. No parade.",
      "Leaving this here for the people who actually read.",
    ]);
  }
  if (voice === "board" || voice === "brief") {
    return pick(rng, [
      "Positioning is optional. Reading the pair is not.",
      "File it. Recheck the tape before you act.",
    ]);
  }
  return pick(rng, [
    "Read it once. Then read the pair.",
    "The work is the market data — not the caption.",
    `${t.ticker} on ${t.chain}. Contract below.`,
  ]);
}

function polish(text: string): string {
  return text
    .replace(/\b(about to explode|guaranteed|100x|to the moon|ape in|can't miss|risk-free)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function writeBullPost(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(variant * 9973 + 13 + hashStr(facts.identity.address + facts.builtAt));
  const voice = pick(rng, voicesFor(mode));
  const t = readTape(facts);
  const parts = [
    hook(rng, voice, t, facts),
    ...body(rng, voice, t, facts).filter(Boolean),
    close(rng, voice, t),
    caLine(rng, t),
    disclaimer(rng, t),
  ];
  let text = parts.filter(Boolean).join("\n\n");
  if (mode === "more_concise") {
    text = [hook(rng, "tape", t, facts), structureLine(t), caLine(rng, t), disclaimer(rng, t)]
      .filter(Boolean)
      .join("\n\n");
  }
  return { text: polish(text), voice };
}

function writeBullThread(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(variant * 4999 + 101 + hashStr(facts.identity.symbol));
  const voice = pick(rng, voicesFor(mode));
  const t = readTape(facts);
  const beats = [
    hook(rng, voice, t, facts),
    moveLine(t) ?? `${t.name} is live on ${t.chain}.`,
    flowLine(t) ?? structureLine(t) ?? `${t.ticker} — structure still forming.`,
    whyNow(rng, t, facts),
    facts.findings[1] ?? facts.findings[0] ?? `${t.ticker} only gets a second look if the pair still looks like this tomorrow.`,
    facts.risks[0] ? `Risk flag, kept in the thread: ${facts.risks[0]}` : `No extra claims. If a number is missing, it stayed missing.`,
    `${caLine(rng, t)}\n\n${disclaimer(rng, t)}`,
  ].filter(Boolean);
  const text = beats.map((b, i) => `${i + 1}/ ${b.replace(/^\d+\/\s*/, "")}`).join("\n\n");
  return { text: polish(text), voice };
}

function writeBullArticle(facts: TokenFactSet, mode: RegenMode, variant: number): { text: string; voice: Voice } {
  const rng = mulberry32(variant * 3343 + 7 + hashStr(facts.identity.name));
  const voice = pick(rng, voicesFor(mode === "default" ? "more_professional" : mode));
  const t = readTape(facts);
  const title = pick(rng, [
    `${t.ticker} on ${t.chain}: a market note, not a myth`,
    `How to read ${t.name} from the pair up`,
    `${t.ticker} — structure, flow, and the honest caveat`,
  ]);
  const text = [
    title,
    "",
    hook(rng, voice, t, facts),
    "",
    "The setup",
    `${t.name} (${t.ticker}) trades on ${t.chain}${t.dex ? ` through ${t.dex}` : ""}. Identity is the contract, not the avatar.`,
    "",
    "What the pair shows",
    [structureLine(t), moveLine(t), flowLine(t)].filter(Boolean).join("\n"),
    "",
    "How to read it",
    whyNow(rng, t, facts),
    ...facts.findings.slice(0, 4).map((f) => `• ${f}`),
    "",
    "Risks that stay on the page",
    ...(facts.risks.length ? facts.risks.map((r) => `• ${r}`) : ["• No additional risk flags were returned with this snapshot."]),
    "",
    "Contract",
    t.ca,
    "",
    disclaimer(rng, t),
  ].join("\n");
  return { text: polish(text), voice };
}

export function generateFromFactSet(
  facts: TokenFactSet,
  kind: ContentKind,
  mode: RegenMode = "default",
  variant = 0,
): GeneratedContent {
  const written =
    kind === "thread"
      ? writeBullThread(facts, mode, variant)
      : kind === "article"
        ? writeBullArticle(facts, mode, variant)
        : writeBullPost(facts, mode, variant);

  const score = scoreContent(written.text, kind);
  return {
    kind,
    angle: angleForVoice(written.voice),
    text: written.text,
    score,
    applied: [
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
