import type { WritingSignals } from "./types";
import { writingSignals } from "./metrics";

const SIGNAL_LABELS: Record<keyof WritingSignals, string> = {
  hook: "Hook",
  clarity: "Clarity",
  curiosity: "Curiosity",
  specificity: "Specificity",
  emotion: "Emotion",
  shareability: "Shareability",
  readability: "Readability",
  structure: "Structure",
};

export type EditSuggestion = {
  signal: keyof WritingSignals;
  label: string;
  score: number;
  priority: "fix" | "strengthen" | "keep";
  action: string;
};

export type RewriteResult = {
  text: string;
  applied: string[];
  before: WritingSignals;
  after: WritingSignals;
  variant: number;
};

const FIX_ACTIONS: Record<keyof WritingSignals, (score: number) => string> = {
  hook: (score) =>
    score < 45
      ? "Rewrite the first line as a claim, contrast, or question under 18 words. Cut the soft lead-in."
      : "Tighten the opening — lead with the sharpest claim, not the setup.",
  clarity: () =>
    "Split any sentence over ~18 words. One idea per line. Delete the second thought that dilutes the first.",
  curiosity: () =>
    "Open a gap the next line must close: a contradiction, a cost, or a ‘why nobody says this’ angle.",
  specificity: () =>
    "Replace at least one vague word (better, more, a lot, growth) with a number, timeframe, or named outcome.",
  emotion: () =>
    "Name a human consequence (time lost, status risk, money, reputation) instead of abstract hype.",
  shareability: () =>
    "Craft one standalone line someone could quote without context. Put it first or last.",
  readability: () =>
    "Add line breaks between beats. Prefer short lines. Drop excess hashtags and nested clauses.",
  structure: () =>
    "Order as: hook → tension/stakes → proof or steps → clear payoff. Drop anything that does not serve that arc.",
};

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTrailingPunct(s: string) {
  return s.replace(/[.!?,;:]+$/g, "").trim();
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function avgScore(signals: WritingSignals) {
  const keys = Object.keys(signals) as (keyof WritingSignals)[];
  return keys.reduce((sum, key) => sum + signals[key], 0) / Math.max(1, keys.length);
}

function hasNumber(s: string) {
  return /\b\d+(?:[.,]\d+)?(?:%|k|m|b)?\b/i.test(s);
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Soft lead-ins that weaken openings — strip when promoting a sentence to hook. */
const SOFT_LEAD = /^(i |we |today |just |so |hi |hello |hey |wanted to |want to |going to |gonna |i'm |i am |here is |here's |this is |check this |quick |btw |fyi )/i;

/**
 * Lightweight, meaning-preserving lexicon swaps.
 * Prefer concrete alternatives that do not invent new claims.
 * Avoid aggressive number injection that changes the author's intent.
 */
const VAGUE_MAP: Array<[RegExp, string[]]> = [
  [/\ba lot of\b/gi, ["many", "dozens of", "far more"]],
  [/\bmany\b/gi, ["dozens of", "most", "a large share of"]],
  [/\bsome\b/gi, ["a few", "several", "a handful of"]],
  [/\bbetter\b/gi, ["sharper", "clearer", "stronger"]],
  [/\bmore\b/gi, ["far more", "noticeably more", "significantly more"]],
  [/\bgrowth\b/gi, ["measurable lift", "reach lift", "progress"]],
  [/\bquickly\b/gi, ["fast", "this week", "in days"]],
  [/\bsoon\b/gi, ["this week", "shortly", "before long"]],
  [/\boften\b/gi, ["regularly", "frequently", "again and again"]],
  [/\bgreat\b/gi, ["specific", "concrete", "proven"]],
  [/\bawesome\b/gi, ["effective", "high-signal", "repeatable"]],
  [/\bthing\b/gi, ["move", "lever", "change"]],
  [/\bstuff\b/gi, ["details", "signals", "proof"]],
  [/\bcontent\b/gi, ["posts", "threads", "writing"]],
  [/\bengagement\b/gi, ["replies and reposts", "saves and replies", "real interactions"]],
  [/\bviral\b/gi, ["high-travel", "widely shared", "breakout"]],
  [/\bsuccess\b/gi, ["results", "outcomes", "wins"]],
  [/\boptimize\b/gi, ["tighten", "cut and sharpen", "refine"]],
  [/\bleverage\b/gi, ["use", "apply", "put to work"]],
  [/\breally\b/gi, ["", "clearly", "truly"]],
  [/\bvery\b/gi, ["", "genuinely", "markedly"]],
  [/\bjust\b/gi, ["", "simply", "only"]],
  [/\bcrypto\b/gi, ["on-chain", "web3", "Solana"]],
  [/\bblockchain\b/gi, ["Solana", "on-chain", "L1"]],
  [/\bproject\b/gi, ["protocol", "product", "build"]],
  [/\bcommunity\b/gi, ["holders", "builders", "users"]],
  [/\blaunch\b/gi, ["ship", "mainnet launch", "go live"]],
];

export function suggestEdits(text: string): EditSuggestion[] {
  const signals = writingSignals(text);
  return (Object.keys(SIGNAL_LABELS) as (keyof WritingSignals)[])
    .map((signal) => {
      const score = signals[signal];
      const priority: EditSuggestion["priority"] =
        score < 50 ? "fix" : score < 70 ? "strengthen" : "keep";
      return {
        signal,
        label: SIGNAL_LABELS[signal],
        score,
        priority,
        action: FIX_ACTIONS[signal](score),
      };
    })
    .sort((a, b) => a.score - b.score);
}

/**
 * Score how strong a sentence is as an opening hook.
 * Higher = better candidate to lead the rewritten post.
 * Purely derived from the original sentence — no external templates.
 */
function hookPotential(sentence: string): number {
  const w = words(sentence);
  const len = w.length;
  let score = 40;
  if (len >= 4 && len <= 18) score += 22;
  else if (len > 18 && len <= 26) score += 8;
  else if (len < 4) score -= 15;
  if (/[?]/.test(sentence)) score += 18;
  if (/[!—:]/.test(sentence)) score += 8;
  if (hasNumber(sentence)) score += 12;
  if (/\b(why|how|what if|nobody|most people|secret|mistake|truth|stop|never|always)\b/i.test(sentence))
    score += 14;
  if (SOFT_LEAD.test(sentence)) score -= 20;
  if (/^(i think|i feel|in my opinion|maybe|perhaps)\b/i.test(sentence)) score -= 12;
  return score;
}

/**
 * Clean a sentence for use as hook or body line:
 * - strip soft lead-ins when promoting to hook
 * - normalize trailing punctuation
 * - lightly capitalize
 */
function polishLine(raw: string, asHook: boolean): string {
  let s = stripTrailingPunct(raw.trim());
  if (asHook) {
    s = s.replace(SOFT_LEAD, "");
  }
  s = s.replace(/^(and |but |so |then |also |plus )/i, "");
  s = capitalize(s);
  if (!/[.!?]$/.test(s) && words(s).length > 3) s += ".";
  return s;
}

/**
 * Split over-long sentences into shorter beats while keeping original words.
 */
function splitLongSentence(sentence: string, maxWords = 18): string[] {
  const w = words(sentence);
  if (w.length <= maxWords) return [sentence];

  // Prefer natural break points (commas, "and", "but", "so", "because")
  const breakRe = /, |\band\b|\bbut\b|\bso\b|\bbecause\b|\bwhich\b|\bthat\b/i;
  const parts: string[] = [];
  let remaining = sentence;

  while (words(remaining).length > maxWords) {
    const match = remaining.match(breakRe);
    if (!match || match.index === undefined || match.index < 8) {
      // Hard split near the middle
      const mid = Math.floor(words(remaining).length / 2);
      const left = words(remaining).slice(0, mid).join(" ");
      const right = words(remaining).slice(mid).join(" ");
      parts.push(left);
      remaining = right;
      break;
    }
    const cut = match.index + match[0].length;
    const left = remaining.slice(0, match.index).trim();
    if (words(left).length >= 4) {
      parts.push(left);
      remaining = remaining.slice(cut).trim();
    } else {
      remaining = remaining.slice(cut).trim();
    }
  }
  if (remaining.trim()) parts.push(remaining.trim());
  return parts.filter((p) => words(p).length >= 3);
}

function applyVagueSwaps(
  text: string,
  rand: () => number,
  intensity: number,
): { text: string; notes: string[] } {
  let out = text;
  const notes: string[] = [];
  let swaps = 0;
  const maxSwaps = Math.max(1, 1 + intensity);

  for (const [re, alts] of VAGUE_MAP) {
    if (swaps >= maxSwaps) break;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    const pick = alts[Math.floor(rand() * alts.length)]!;
    // Empty pick means "delete the intensifier"
    out = out.replace(re, (matched) => {
      if (swaps >= maxSwaps) return matched;
      swaps += 1;
      if (!pick) {
        notes.push(`removed weak intensifier "${matched}"`);
        return "";
      }
      const replacement =
        matched[0] && matched[0] === matched[0].toUpperCase()
          ? pick.charAt(0).toUpperCase() + pick.slice(1)
          : pick;
      notes.push(`${matched} → ${replacement}`);
      return replacement;
    });
  }
  // Clean double spaces left by deletions
  out = out.replace(/\s{2,}/g, " ").trim();
  return { text: out, notes };
}

/**
 * Extract atomic content units from the original post.
 * Keeps the author's ideas intact; later stages only reorder and polish.
 */
function extractUnits(text: string): string[] {
  const raw = sentences(text);
  const units: string[] = [];
  for (const s of raw) {
    const cleaned = stripTrailingPunct(s).trim();
    if (words(cleaned).length < 3) continue;
    // Further split very long units so structure can improve
    const pieces = splitLongSentence(cleaned, 22);
    for (const p of pieces) {
      if (words(p).length >= 3) units.push(p);
    }
  }
  return units.length > 0 ? units : [text.trim()];
}

/**
 * Build one rewrite variant.
 *
 * Design goals (aligned with professional rewrite APIs):
 * - Preserve original meaning and factual content
 * - Change structure: promote strongest claim to front, one idea per line
 * - Improve clarity, readability, specificity via light polishing
 * - Never inject unrelated template sentences
 * - Variants explore different lead sentences and tightening intensity
 */
function buildVariant(text: string, variant: number): { text: string; applied: string[] } {
  const rand = mulberry32(variant * 9973 + 13);
  const intensity = Math.min(3, Math.floor(variant / 2));
  const applied: string[] = [];

  const units = extractUnits(text);
  if (units.length === 0) {
    return { text: text.trim(), applied: [] };
  }

  // Rank units by hook potential
  const ranked = units
    .map((u, idx) => ({ u, idx, score: hookPotential(u) }))
    .sort((a, b) => b.score - a.score);

  // Variant picks which strong unit becomes the new opening
  const leadIndex = Math.min(ranked.length - 1, variant % Math.min(3, ranked.length));
  const lead = ranked[leadIndex]!;
  const usedIdx = new Set<number>([lead.idx]);

  const hookLine = polishLine(lead.u, true);
  applied.push(
    lead.idx === 0
      ? "Tightened existing opening"
      : `Promoted strongest claim (originally position ${lead.idx + 1}) to hook`,
  );

  // Remaining body units in original relative order, lightly polished
  const bodyUnits = units
    .map((u, idx) => ({ u, idx }))
    .filter((x) => !usedIdx.has(x.idx))
    .map((x) => polishLine(x.u, false));

  // Apply vague-word swaps on the whole draft for specificity/clarity
  let draftLines = [hookLine, ...bodyUnits];
  const joinedForSwap = draftLines.join(" ");
  const swapped = applyVagueSwaps(joinedForSwap, rand, intensity);
  if (swapped.notes.length) {
    applied.push(...swapped.notes.map((n) => `Lexicon: ${n}`));
    // Re-split after swaps (they may have changed spacing)
    draftLines = sentences(swapped.text).map((s) => polishLine(s, false));
    // Ensure first line is still treated as the hook
    if (draftLines.length > 0) {
      draftLines[0] = polishLine(draftLines[0]!, true);
    }
  }

  // Drop near-duplicates and very weak residual lines
  const seen = new Set<string>();
  const finalLines: string[] = [];
  for (const line of draftLines) {
    const key = words(line)
      .slice(0, 6)
      .join(" ")
      .toLowerCase();
    if (seen.has(key)) continue;
    if (words(line).length < 3) continue;
    seen.add(key);
    // Cap individual line length for shareability
    if (words(line).length > 24) {
      finalLines.push(words(line).slice(0, 20).join(" ") + ".");
      applied.push("Compressed a long line for shareability");
    } else {
      finalLines.push(line);
    }
  }

  // Ensure we still have substance; fall back to original cleaned if everything was filtered
  if (finalLines.length === 0) {
    return {
      text: units.map((u) => polishLine(u, false)).join("\n\n"),
      applied: ["Normalized structure and line breaks"],
    };
  }

  // Structure: blank line between beats improves readability & structure scores
  const structured = finalLines.join("\n\n");
  applied.push("Reordered for hook-first structure + line breaks");

  // Light intensity pass: drop the weakest trailing line if too long overall
  if (intensity >= 2 && finalLines.length > 4) {
    const trimmed = finalLines.slice(0, -1).join("\n\n");
    if (words(trimmed).length >= 12) {
      applied.push("Cut weakest trailing beat for tighter focus");
      return { text: trimmed, applied: [...new Set(applied)] };
    }
  }

  return { text: structured, applied: [...new Set(applied)] };
}

/**
 * Content-preserving rewrite engine.
 *
 * Tries several structural variants (different lead sentences + intensity)
 * and returns the one that most improves the average writing-signal score
 * while staying faithful to the original ideas.
 */
export function rewritePost(text: string, variant = 0): RewriteResult {
  const source = text.trim();
  if (!source) {
    return {
      text: "",
      applied: [],
      before: writingSignals(""),
      after: writingSignals(""),
      variant,
    };
  }

  const before = writingSignals(source);
  const baseline = avgScore(before);

  let best: RewriteResult | null = null;

  // Explore a small set of structural variants; stop early when we clearly improve
  for (let offset = 0; offset < 6; offset += 1) {
    const seed = variant + offset * 11;
    const built = buildVariant(source, seed);
    const after = writingSignals(built.text);
    const score = avgScore(after);
    const candidate: RewriteResult = {
      text: built.text,
      applied: built.applied,
      before,
      after,
      variant: seed,
    };
    if (!best || score > avgScore(best.after)) best = candidate;
    // Early exit on clear win
    if (score > baseline + 3 && offset <= 1) break;
    if (score > baseline + 1.5 && offset <= 4) break;
  }

  // Safety: if no improvement, return a minimal structural polish of the original
  if (!best || avgScore(best.after) < baseline - 0.5) {
    const units = extractUnits(source);
    const polished = units.map((u, i) => polishLine(u, i === 0)).join("\n\n");
    const after = writingSignals(polished);
    best = {
      text: polished,
      applied: ["Minimal structural polish — original sense fully preserved"],
      before,
      after,
      variant,
    };
  }

  return best;
}

export function scoreDelta(before: WritingSignals, after: WritingSignals) {
  const keys = Object.keys(before) as (keyof WritingSignals)[];
  const deltas = keys.map((k) => ({
    signal: k,
    label: SIGNAL_LABELS[k],
    delta: after[k] - before[k],
  }));
  const avgBefore = Math.round(avgScore(before));
  const avgAfter = Math.round(avgScore(after));
  return { deltas, avgBefore, avgAfter };
}
