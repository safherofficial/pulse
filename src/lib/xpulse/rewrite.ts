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

const HOOK_FRAMES = [
  (core: string) => `Nobody tells you this: ${core}`,
  (core: string) => `Stop scrolling. ${capitalize(core)}`,
  (core: string) => `Why does this keep happening? ${capitalize(core)}`,
  (core: string) => `The hard truth: ${core}`,
  (core: string) => `Most people miss this. ${capitalize(core)}`,
  (core: string) => `3 minutes. One change. ${capitalize(core)}`,
  (core: string) => `I learned this the expensive way: ${core}`,
  (core: string) => `If you publish on X, read this. ${capitalize(core)}`,
];

const STAKES = [
  "The cost of ignoring it compounds every week.",
  "You lose reach you will not get back.",
  "One weak hook wastes the whole post.",
  "Your best idea dies in the first line.",
  "Readers decide in under a second.",
];

const PROOF_BEATS = [
  "One concrete change. Measurable in 7 days.",
  "Track opens, not vanity views.",
  "Ship the tighter version today.",
  "Rewrite the first line before you rewrite the rest.",
  "Cut 30%. Keep the claim that travels alone.",
];

const VAGUE_MAP: Array<[RegExp, string[]]> = [
  [/\ba lot of\b/gi, ["3× more", "dozens of", "far more"]],
  [/\bmany\b/gi, ["dozens of", "hundreds of", "most"]],
  [/\bsome\b/gi, ["a few", "2–3", "several"]],
  [/\bbetter\b/gi, ["42% stronger", "sharper", "clearer"]],
  [/\bmore\b/gi, ["2× more", "far more", "noticeably more"]],
  [/\bgrowth\b/gi, ["growth in 7 days", "measurable lift", "reach lift"]],
  [/\bquickly\b/gi, ["in 48 hours", "this week", "in 3 days"]],
  [/\bsoon\b/gi, ["in 48 hours", "this week", "by Friday"]],
  [/\boften\b/gi, ["3 times a week", "daily", "twice a week"]],
  [/\bgreat\b/gi, ["specific", "concrete", "proven"]],
  [/\bawesome\b/gi, ["effective", "high-signal", "repeatable"]],
  [/\bthing\b/gi, ["move", "lever", "change"]],
  [/\bstuff\b/gi, ["details", "signals", "proof"]],
  [/\bcontent\b/gi, ["posts", "threads", "writing"]],
  [/\bengagement\b/gi, ["replies + reposts", "saves and replies", "real interactions"]],
  [/\bviral\b/gi, ["high-travel", "widely shared", "breakout"]],
  [/\bsuccess\b/gi, ["results", "outcomes", "wins"]],
  [/\boptimize\b/gi, ["tighten", "cut and sharpen", "refine"]],
  [/\bleverage\b/gi, ["use", "apply", "put to work"]],
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

function coreClaim(text: string, rand: () => number): string {
  const parts = sentences(text);
  const first = stripTrailingPunct(parts[0] ?? text);
  let core = first
    .replace(/^(i |we |today |just |so |hi |hello |hey )/i, "")
    .replace(/^(wanted to |want to |going to |gonna )/i, "");
  const w = words(core);
  if (w.length > 16) core = w.slice(0, 14).join(" ");
  if (w.length < 4 && parts[1]) {
    core = stripTrailingPunct(parts[1]).split(/\s+/).slice(0, 14).join(" ");
  }
  if (!core) core = "your first line decides if anyone stays";
  if (rand() > 0.55 && words(core).length > 8) {
    core = words(core).slice(0, 8 + Math.floor(rand() * 4)).join(" ");
  }
  return core.charAt(0).toLowerCase() + core.slice(1);
}

function applyVagueSwaps(text: string, rand: () => number, intensity: number): { text: string; notes: string[] } {
  let out = text;
  const notes: string[] = [];
  let swaps = 0;
  for (const [re, alts] of VAGUE_MAP) {
    if (swaps >= 2 + intensity) break;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    const pick = alts[Math.floor(rand() * alts.length)]!;
    out = out.replace(re, (matched) => {
      if (swaps >= 2 + intensity) return matched;
      swaps += 1;
      const replacement =
        matched[0] && matched[0] === matched[0].toUpperCase()
          ? pick.charAt(0).toUpperCase() + pick.slice(1)
          : pick;
      notes.push(`${matched} → ${replacement}`);
      return replacement;
    });
  }
  return { text: out, notes };
}

function buildVariant(text: string, variant: number): { text: string; applied: string[] } {
  const rand = mulberry32(variant * 9973 + 13);
  const intensity = Math.min(4, Math.floor(variant / 2));
  const applied: string[] = [];
  const claim = coreClaim(text, rand);

  const hookFn = HOOK_FRAMES[(variant + Math.floor(rand() * 3)) % HOOK_FRAMES.length]!;
  let hook = stripTrailingPunct(hookFn(claim));
  if (words(hook).length > 20) hook = words(hook).slice(0, 18).join(" ");
  if (!/[!?.]$/.test(hook)) hook += ".";
  applied.push(`Hook frame #${(variant % HOOK_FRAMES.length) + 1}`);

  const originalParts = sentences(text).slice(1);
  let bodyParts = originalParts
    .map((p) => capitalize(stripTrailingPunct(p)))
    .filter((p) => words(p).length >= 4)
    .slice(0, 2 + (intensity > 2 ? 1 : 0));

  if (bodyParts.length === 0) {
    bodyParts = [
      "Opens and dwell beat vanity impressions every time.",
      "Write for the person who almost scrolled past.",
    ];
  }

  if (!hasNumber(hook + " " + bodyParts.join(" "))) {
    const nums = ["7 days", "48 hours", "1 line", "3 beats", "30%"];
    const n = nums[Math.floor(rand() * nums.length)]!;
    bodyParts[0] = `${bodyParts[0]!.replace(/\.$/, "")} — start with ${n}.`;
    applied.push(`Added concrete marker (${n})`);
  }

  const joinedBody = bodyParts.join(" ");
  const swapped = applyVagueSwaps(joinedBody, rand, intensity);
  bodyParts = sentences(swapped.text);
  applied.push(...swapped.notes.map((n) => `Lexicon: ${n}`));

  const stake = STAKES[(variant + Math.floor(rand() * STAKES.length)) % STAKES.length]!;
  const proof = PROOF_BEATS[(variant * 3 + Math.floor(rand() * PROOF_BEATS.length)) % PROOF_BEATS.length]!;

  const lines = [capitalize(hook)];
  for (const part of bodyParts) {
    let line = capitalize(stripTrailingPunct(part));
    if (words(line).length > 22) line = words(line).slice(0, 18).join(" ");
    if (!/[.!?]$/.test(line)) line += ".";
    lines.push(line);
  }
  lines.push(stake);
  applied.push("Raised stakes");
  if (intensity >= 1 || rand() > 0.35) {
    lines.push(proof);
    applied.push("Closed with a concrete next step");
  }

  if (intensity >= 2 && words(lines[0]!).length > 14) {
    lines[0] = `${words(lines[0]!).slice(0, 12).join(" ")}.`;
    applied.push("Compressed lead for shareability");
  }

  return { text: lines.join("\n\n"), applied: [...new Set(applied)] };
}

export function rewritePost(text: string, variant = 0): RewriteResult {
  const source = text.trim();
  const before = writingSignals(source);
  const baseline = avgScore(before);

  let best: RewriteResult | null = null;

  for (let offset = 0; offset < 8; offset += 1) {
    const seed = variant + offset * 17;
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
    if (score > baseline + 2 && offset === 0) break;
    if (score > baseline + 0.75 && offset <= 3) break;
  }

  if (best && avgScore(best.after) <= baseline) {
    const claim = coreClaim(source, mulberry32(variant + 99));
    const forced = [
      `Nobody tells you this: ${claim}.`,
      "Opens and dwell beat vanity impressions.",
      "Rewrite the first line before anything else.",
      STAKES[variant % STAKES.length]!,
      PROOF_BEATS[variant % PROOF_BEATS.length]!,
    ].join("\n\n");
    const after = writingSignals(forced);
    if (avgScore(after) >= avgScore(best.after)) {
      best = {
        text: forced,
        applied: ["Forced high-signal structure", "Hook + stakes + next step"],
        before,
        after,
        variant,
      };
    }
  }

  return (
    best ?? {
      text: source,
      applied: [],
      before,
      after: before,
      variant,
    }
  );
}

export function scoreDelta(before: WritingSignals, after: WritingSignals) {
  const keys = Object.keys(before) as (keyof WritingSignals)[];
  const deltas = keys.map((k) => ({ signal: k, label: SIGNAL_LABELS[k], delta: after[k] - before[k] }));
  const avgBefore = Math.round(avgScore(before));
  const avgAfter = Math.round(avgScore(after));
  return { deltas, avgBefore, avgAfter };
}
