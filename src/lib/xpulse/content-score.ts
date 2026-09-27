/**
 * Multi-dimension content score for X posts / threads / articles.
 * Does not promise impressions. Scores structural + craft potential.
 */

import { writingSignals } from "./metrics.ts";
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
  /\b(in today's rapidly evolving|it's important to note|significant milestone|the future is here|game[- ]?changer|revolutionary|buckle up|delve into|landscape of|leverage synergies|unlock the potential|as an ai|in conclusion)\b/gi;

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

function threadBeats(text: string): string[] {
  const numbered = text
    .split(/\n\s*\n/)
    .map((b) => b.replace(/^\s*\d+\s*[/.)-]\s*/, "").trim())
    .filter(Boolean);
  if (numbered.length >= 3) return numbered;
  return text
    .split(/\n+/)
    .map((b) => b.replace(/^\s*\d+\s*[/.)-]\s*/, "").trim())
    .filter(Boolean);
}

export function scoreContent(text: string, kind: ContentKind = "post"): ContentScoreReport {
  const clean = text.trim();
  const signals = writingSignals(clean);
  const w = words(clean);
  const sents = sentences(clean);
  const hook = firstLine(clean).replace(/^\s*\d+\s*[/.)-]\s*/, "");
  const hookWords = words(hook).length;
  const dims: ScoreDimension[] = [];
  const concrete = (clean.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).length;
  const urls = (clean.match(/https?:\/\/\S+/gi) ?? []).length;
  const numbered = (clean.match(/^\s*\d+\s*[/.)-]/gm) ?? []).length;

  let hookScore = signals.hook;
  if (hookWords >= 4 && hookWords <= 16) hookScore = Math.max(hookScore, 74);
  if (/[?]/.test(hook)) hookScore = Math.min(100, hookScore + 6);
  if (/\b(nobody|most people|stop|why|the hard truth|look|watch)\b/i.test(hook)) {
    hookScore = Math.min(100, hookScore + 4);
  }
  if (/^(hook|context|insight|summary|introduction):/i.test(hook)) hookScore -= 22;
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
    note: signals.clarity >= 70 ? "Sentences stay readable." : "Tighten long lines; one idea per beat.",
  });

  dims.push({
    key: "density",
    label: "Information density",
    score: clamp(
      38 +
        Math.min(32, concrete * 9) +
        Math.min(16, sents.length * 2) +
        Math.min(8, urls * 4) -
        (w.length > 140 && kind === "post" ? 14 : 0),
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
        : "Add a contrast, cost, or unanswered why.",
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

  if (kind === "thread") {
    const beats = threadBeats(clean);
    const long = beats.filter((b) => b.length > 280).length;
    const short = beats.filter((b) => b.length < 40).length;
    const labels = beats.filter((b) => /^(hook|context|insight|summary|implication):/i.test(b)).length;
    const threadScore = clamp(
      38 +
        Math.min(28, beats.length * 5) +
        (numbered >= 3 ? 14 : 0) +
        (beats.length >= 4 && beats.length <= 8 ? 12 : 0) -
        long * 10 -
        short * 6 -
        labels * 12,
    );
    dims.push({
      key: "thread_craft",
      label: "Thread craft",
      score: threadScore,
      note:
        labels > 0
          ? "Drop outline labels (Hook:/Context:). Write real tweets."
          : long > 0
            ? "One or more tweets run past 280 characters."
            : beats.length < 4
              ? "Needs more beats: setup → proof → turn → close."
              : "Numbered beats with a usable length range.",
    });
  }

  const aiHits = (clean.match(AI_SLACK) ?? []).length;
  const humanScore = clamp(92 - aiHits * 18 - (/\b(leverage|synergy|holistic)\b/gi.test(clean) ? 8 : 0));
  dims.push({
    key: "human",
    label: "Human voice",
    score: humanScore,
    note: aiHits > 0 ? "Generic AI phrasing detected — rewrite in concrete language." : "Voice stays direct.",
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
    note: spamScore < 70 ? "Engagement-bait or hashtag overload hurts real attention." : "Avoids obvious bait patterns.",
  });

  const total = clamp(dims.reduce((sum, d) => sum + d.score, 0) / Math.max(1, dims.length));

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
  if (signals.specificity < 60) improvements.push("Replace one vague word with a number, timeframe, or named outcome.");
  if (signals.structure < 60) improvements.push("Break into short beats with blank lines between ideas.");
  if (aiHits > 0) improvements.push("Remove template AI phrases; write the observation you actually mean.");
  if (spamScore < 70) improvements.push("Drop hashtag spam and bait CTAs — invite a real reply instead.");
  if (kind === "thread" && numbered < 3) improvements.push("Number the tweets 1/ 2/ 3/ so the thread is publish-ready.");
  if (kind === "thread" && sents.length < 4) improvements.push("Add progression: setup → tension → evidence → payoff.");
  if (!improvements.length) improvements.push("Polish one quotable line and verify every claim is grounded.");

  return {
    total,
    dimensions: dims,
    working: working.length ? working : ["Core structure is intact"],
    limiting: limiting.length ? limiting : ["No major structural limits detected"],
    improvements,
    signals,
  };
}
