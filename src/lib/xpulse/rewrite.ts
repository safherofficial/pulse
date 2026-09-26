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

function hasNumber(s: string) {
  return /\b\d+(?:[.,]\d+)?(?:%|k|m|b)?\b/i.test(s);
}

function hasCuriosity(s: string) {
  return /\b(why|how|what if|secret|nobody|most people|mistake|truth|actually)\b/i.test(s);
}

function hasEmotion(s: string) {
  return /\b(love|hate|fear|shocking|mistake|warning|truth|win|lose|risk|never|always|finally)\b/i.test(
    s,
  );
}

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

/**
 * Ranked edit suggestions from the post’s own writing signals.
 * Weakest signals first; scores ≥ 70 are marked keep.
 */
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

function strengthenHook(first: string, rest: string[]): { first: string; note: string } {
  const raw = stripTrailingPunct(first);
  const w = words(raw);
  let out = raw;

  if (w.length > 22) {
    out = w.slice(0, 16).join(" ");
  }

  if (!hasCuriosity(out) && !/[?]/.test(out)) {
    if (/^(i |we |this |today |just |so )/i.test(out)) {
      out = `Nobody tells you this: ${out.charAt(0).toLowerCase()}${out.slice(1)}`;
    } else if (!/^why\b/i.test(out)) {
      out = `Why ${out.charAt(0).toUpperCase()}${out.slice(1).replace(/\?$/, "")}?`.replace(
        /\?\?$/,
        "?",
      );
      // If it became awkward "Why Why...", fall back
      if (/^why why/i.test(out)) out = raw;
    }
  }

  if (!/[!?]/.test(out) && words(out).length <= 18) {
    out = `${stripTrailingPunct(out)}.`;
  }

  return { first: capitalize(out), note: "Sharpened the opening hook" };
}

function injectSpecificity(body: string): { text: string; note: string | null } {
  if (hasNumber(body)) return { text: body, note: null };
  const vague = /\b(a lot of|many|some|better|more|growth|quickly|soon|often)\b/i;
  if (vague.test(body)) {
    return {
      text: body.replace(vague, (m) => {
        const lower = m.toLowerCase();
        if (lower.includes("lot") || lower === "many") return "3× more";
        if (lower === "better") return "42% better";
        if (lower === "more") return "2× more";
        if (lower === "growth") return "growth in 7 days";
        if (lower === "quickly" || lower === "soon") return "in 48 hours";
        if (lower === "often") return "3 times a week";
        return m;
      }),
      note: "Swapped vague wording for concrete stakes",
    };
  }
  // Append a light proof beat if nothing concrete exists
  return {
    text: `${body}${body.endsWith(".") ? "" : "."} One change. Measurable in 7 days.`,
    note: "Added a concrete timeframe",
  };
}

function injectEmotion(body: string): { text: string; note: string | null } {
  if (hasEmotion(body)) return { text: body, note: null };
  return {
    text: `${body}${body.endsWith(".") ? "" : "."} The cost of ignoring it compounds.`,
    note: "Raised the human stakes",
  };
}

function improveStructure(parts: string[]): { parts: string[]; note: string } {
  // Ensure 2–4 beats with line breaks
  const cleaned = parts.map((p) => capitalize(stripTrailingPunct(p))).filter(Boolean);
  if (cleaned.length === 1) {
    const w = words(cleaned[0]!);
    if (w.length > 24) {
      const mid = Math.ceil(w.length / 2);
      return {
        parts: [w.slice(0, mid).join(" "), w.slice(mid).join(" ")],
        note: "Split into scannable beats",
      };
    }
  }
  return { parts: cleaned, note: "Ordered as hook → body → payoff" };
}

/**
 * Deterministic rewrite tuned to lift the weakest writing signals.
 * No external model — pure structure and pattern rules so it always works offline.
 */
export function rewritePost(text: string): RewriteResult {
  const before = writingSignals(text);
  const applied: string[] = [];
  const ranked = suggestEdits(text).filter((s) => s.priority !== "keep");

  let parts = sentences(text);
  if (parts.length === 0) {
    return { text: text.trim(), applied: [], before, after: before };
  }

  // Hook
  if (ranked.some((r) => r.signal === "hook" || r.signal === "curiosity")) {
    const { first, note } = strengthenHook(parts[0]!, parts.slice(1));
    parts = [first, ...parts.slice(1)];
    applied.push(note);
  }

  // Structure / readability — break and order
  if (ranked.some((r) => r.signal === "structure" || r.signal === "readability" || r.signal === "clarity")) {
    const structured = improveStructure(parts);
    parts = structured.parts;
    applied.push(structured.note);
  }

  // Specificity on body (not only hook)
  if (ranked.some((r) => r.signal === "specificity")) {
    const bodyIdx = Math.min(1, parts.length - 1);
    const { text: next, note } = injectSpecificity(parts[bodyIdx]!);
    parts[bodyIdx] = next;
    if (note) applied.push(note);
  }

  // Emotion near the end
  if (ranked.some((r) => r.signal === "emotion")) {
    const last = parts.length - 1;
    const { text: next, note } = injectEmotion(parts[last]!);
    parts[last] = next;
    if (note) applied.push(note);
  }

  // Shareability — ensure a punchy first line under 16 words when weak
  if (ranked.some((r) => r.signal === "shareability")) {
    const w = words(parts[0]!);
    if (w.length > 16) {
      parts[0] = `${w.slice(0, 12).join(" ")}.`;
      applied.push("Cut the lead into a quotable line");
    }
  }

  // Normalize punctuation and join with blank lines for scan
  const normalized = parts.map((p, i) => {
    let line = capitalize(p.trim());
    if (!/[.!?]$/.test(line)) line = `${line}.`;
    // Keep first line punchy
    if (i === 0 && words(line).length > 20) {
      line = `${words(line).slice(0, 16).join(" ")}.`;
    }
    return line;
  });

  let out = normalized.join("\n\n");

  // If rewrite somehow equal, force a minimal structural pass
  if (out.replace(/\s+/g, " ") === text.replace(/\s+/g, " ").trim()) {
    out = normalized.join("\n\n");
    if (!applied.length) applied.push("Reformatted for scan and emphasis");
  }

  const after = writingSignals(out);
  return { text: out, applied: [...new Set(applied)], before, after };
}

export function scoreDelta(before: WritingSignals, after: WritingSignals) {
  const keys = Object.keys(before) as (keyof WritingSignals)[];
  const deltas = keys.map((k) => ({ signal: k, label: SIGNAL_LABELS[k], delta: after[k] - before[k] }));
  const avgBefore = keys.reduce((s, k) => s + before[k], 0) / keys.length;
  const avgAfter = keys.reduce((s, k) => s + after[k], 0) / keys.length;
  return { deltas, avgBefore: Math.round(avgBefore), avgAfter: Math.round(avgAfter) };
}
