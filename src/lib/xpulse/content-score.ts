/**
 * Multi-dimension content score for X posts / threads / articles.
 * Does not promise impressions. Scores potential based on structural signals.
 */

import { writingSignals } from "./metrics";
import type { WritingSignals } from "./types";

export type ContentKind = "post" | "thread" | "article";

export type ScoreDimension = {
  key: string;
  label: string;
  score: number;
  note: string;
};

export type ContentScoreReport = {
  total: number;
  dimensions: ScoreDimension[];
  working: string[];
  limiting: string[];
  improvements: string[];
  signals: WritingSignals;
};

const AI_SLACK =
  /\b(in today's rapidly evolving|it's important to note|significant milestone|the future is here|game[- ]?changer|revolutionary|buckle up|delve into|landscape of|leverage synergies|unlock the potential)\b/gi;

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstLine(text: string) {
  return text.split(/\n+/)[0]?.trim() ?? text.trim();
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreContent(text: string, kind: ContentKind = "post"): ContentScoreReport {
  const clean = text.trim();
  const signals = writingSignals(clean);
  const w = words(clean);
  const sents = sentences(clean);
  const hook = firstLine(clean);
  const hookWords = words(hook).length;
  const dims: ScoreDimension[] = [];

  // Hook / stop-scroll
  let hookScore = signals.hook;
  if (hookWords >= 4 && hookWords <= 16) hookScore = Math.max(hookScore, 72);
  if (/[?]/.test(hook)) hookScore = Math.min(100, hookScore + 6);
  if (/\b(nobody|most people|stop|why|the hard truth|secret)\b/i.test(hook)) {
    hookScore = Math.min(100, hookScore + 4);
  }
  dims.push({
    key: "hook",
    label: "Hook strength",
    score: clamp(hookScore),
    note:
      hookWords > 22
        ? "Opening is long — readers decide in under a second."
        : hookWords < 4
          ? "Opening is thin."
          : "Opening length is in a workable range.",
  });

  dims.push({
    key: "clarity",
    label: "Clarity",
    score: clamp(signals.clarity),
    note:
      signals.clarity >= 70
        ? "Sentences stay readable."
        : "Tighten long lines; one idea per beat.",
  });

  dims.push({
    key: "density",
    label: "Information density",
    score: clamp(
      40 +
        Math.min(30, (clean.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).length * 10) +
        Math.min(20, sents.length * 3) -
        (w.length > 120 && kind === "post" ? 15 : 0),
    ),
    note: "Concrete numbers and distinct beats raise density without fluff.",
  });

  dims.push({
    key: "curiosity",
    label: "Curiosity",
    score: clamp(signals.curiosity),
    note:
      signals.curiosity >= 65
        ? "Opens a gap the next line can close."
        : "Add a contrast, cost, or unanswered ‘why’.",
  });

  dims.push({
    key: "emotion",
    label: "Emotional resonance",
    score: clamp(signals.emotion),
    note: "Human stakes beat abstract hype.",
  });

  dims.push({
    key: "shareability",
    label: "Share / quote potential",
    score: clamp(signals.shareability),
    note:
      signals.shareability >= 70
        ? "Has a line that can travel alone."
        : "Craft one standalone quotable line.",
  });

  dims.push({
    key: "structure",
    label: "Structure",
    score: clamp(signals.structure),
    note:
      kind === "thread"
        ? "Threads need clear progression and payoff."
        : "Hook → tension → proof → payoff still applies.",
  });

  dims.push({
    key: "readability",
    label: "Readability",
    score: clamp(signals.readability),
    note: "Short lines and breaks help on mobile.",
  });

  const aiHits = (clean.match(AI_SLACK) ?? []).length;
  const humanScore = clamp(92 - aiHits * 18 - (/\b(leverage|synergy|holistic)\b/gi.test(clean) ? 8 : 0));
  dims.push({
    key: "human",
    label: "Human voice",
    score: humanScore,
    note:
      aiHits > 0
        ? "Generic AI phrasing detected — rewrite in concrete language."
        : "Voice stays direct.",
  });

  const hashtagCount = (clean.match(/(^|\s)#\w+/g) ?? []).length;
  const spamScore = clamp(
    90 -
      hashtagCount * 12 -
      (/\b(like and rt|drop a like|comment yes)\b/i.test(clean) ? 25 : 0) -
      (/(!!!|\?\?\?)/.test(clean) ? 8 : 0),
  );
  dims.push({
    key: "anti_spam",
    label: "Anti-spam / credibility",
    score: spamScore,
    note:
      spamScore < 70
        ? "Engagement-bait or hashtag overload hurts real attention."
        : "Avoids obvious bait patterns.",
  });

  const total = clamp(
    dims.reduce((sum, d) => sum + d.score, 0) / Math.max(1, dims.length),
  );

  const working = dims
    .filter((d) => d.score >= 72)
    .map((d) => d.label)
    .slice(0, 5);
  const limiting = dims
    .filter((d) => d.score < 65)
    .sort((a, b) => a.score - b.score)
    .map((d) => `${d.label}: ${d.note}`)
    .slice(0, 5);

  const improvements: string[] = [];
  if (hookWords > 20) improvements.push("Cut the opening to under 16 words — lead with the claim.");
  if (signals.specificity < 60)
    improvements.push("Replace one vague word with a number, timeframe, or named outcome.");
  if (signals.structure < 60) improvements.push("Break into short beats with blank lines between ideas.");
  if (aiHits > 0) improvements.push("Remove template AI phrases; write the observation you actually mean.");
  if (spamScore < 70) improvements.push("Drop hashtag spam and bait CTAs — invite a real reply instead.");
  if (kind === "thread" && sents.length < 4)
    improvements.push("Add progression: setup → tension → evidence → payoff.");
  if (!improvements.length)
    improvements.push("Polish one quotable line and verify every claim is grounded.");

  return {
    total,
    dimensions: dims,
    working: working.length ? working : ["Core structure is intact"],
    limiting: limiting.length ? limiting : ["No major structural limits detected"],
    improvements,
    signals,
  };
}
