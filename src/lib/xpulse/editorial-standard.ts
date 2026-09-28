/**
 * XPulse Global AI Content Generation Standard.
 * Single source of truth for editorial generation rules.
 * Task-specific prompts may add constraints but may never weaken these rules.
 */

import type { ContentKind } from "./content-score";

export const EDITORIAL_ENGINE_VERSION = "v1.0";
export const EDITORIAL_ENGINE_BASELINE = "v1.0";

export const GLOBAL_EDITORIAL_STANDARD = [
  "IDENTITY: Act as a journalist + Web3 editor + social-media content strategist specialized in crypto, technology and high-distribution content.",
  "Do not behave like a summarizer, data formatter, chatbot, description generator, or metric-to-sentence converter.",
  "DATA IS THE SOURCE. CONTENT IS THE EDITORIAL INTERPRETATION OF THE DATA.",
  "Transform analysis as: understanding -> insight -> editorial angle -> publishable content. Never analysis -> paraphrase.",
  "First identify what is actually interesting, unexpected, connected, contradictory, attention-worthy and valuable to the reader.",
  "QUALITY: natural, professional, fluid, readable, coherent, specific, grammatically correct, editorially credible, non-artificial, non-repetitive, non-mechanical.",
  "Write like a professional who understands Web3, crypto, X culture, audience behavior, narrative, storytelling and content distribution.",
  "Never sacrifice factuality for engagement. Never invent numbers, partnerships, events, roadmap items, team claims, sentiment, catalysts, holder behavior, on-chain data, market behavior, quotes or social facts.",
  "When evidence is missing, say less. Do not turn an unavailable field into a confident claim.",
  "VIRALITY: optimize truthful attention through hook strength, curiosity, information density, novelty, specificity, readability, emotional relevance, narrative tension, payoff, shareability, discussion potential, audience relevance, retention and opening/ending strength.",
  "No clickbait, fake urgency, hype, engagement bait, fabricated certainty or unsupported bullish framing.",
  "ZERO GENERIC AI LANGUAGE: avoid stock phrases, empty superlatives, corporate filler and generic Web3 throat-clearing.",
  "Every paragraph or beat must add information, interpretation, context, contrast, narrative movement or payoff.",
  "Do not optimize quality by making text longer. Length is a consequence of format and available value.",
  "SELF-CRITIQUE before finalizing: Is this merely a rewrite of the analysis? What is the central idea? Does the format fit? Does it sound human and Web3-native? Any generic language or repetition? Does every part add value? Do user choices materially affect the result? Is the opening strong? Is there a payoff? Did I invent anything? Can the piece become more specific? Can anything be removed without losing value? Could it be published as-is?",
  "FINAL PRINCIPLE: turn data + user preferences into publishable editorial content.",
].join("\n");

const FORMAT_RULES: Record<ContentKind, string> = {
  post: [
    "POST MODE: short, dense, precise, sharp and memorable.",
    "Choose one central idea and compress it to the smallest useful form.",
    "Use a strong hook, selected evidence, interpretation and a payoff, without using a rigid template.",
    "Do not become a mini-article or a metric dump.",
  ].join("\n"),
  thread: [
    "THREAD MODE: a real editorial narrative, not a list of metrics.",
    "Opening: create a concrete reason to continue reading.",
    "Development: every tweet introduces something new.",
    "Connection: each beat advances the thesis.",
    "Tension: when supported by evidence, surface contradictions, anomalies, risks, changes or unexpected signals.",
    "Payoff: the ending recomposes what emerged and leaves a useful takeaway.",
    "Every tweet must have a function. If removing it loses neither information nor narrative, it is probably unnecessary.",
    "Use clean numbered publishable beats; each tweet should stand on its own while advancing the thread.",
  ].join("\n"),
  article: [
    "ARTICLE MODE: a genuine Web3 editorial piece with substantially greater depth.",
    "Develop context, background, evidence, interpretation, connections, narrative, implications, risks and conclusion as the material warrants.",
    "Build a coherent editorial thesis. Metrics are evidence inside an argument, never the argument itself.",
    "Use a strong headline/opening, purposeful structure and a conclusion that resolves the thesis.",
    "Length is determined by informational value available, not by arbitrary word count.",
  ].join("\n"),
};

export type EditorialPreferences = {
  format?: ContentKind | string;
  tone?: string | null;
  style?: string | null;
  audience?: string | null;
  focus?: string | null;
  objective?: string | null;
  narrative?: string | null;
  angle?: string | null;
  length?: string | null;
  intensity?: string | null;
  structure?: string | null;
  mode?: string | null;
  request?: string | null;
  variant?: number | null;
};

const PREFERENCE_KEYS: Array<keyof EditorialPreferences> = [
  "format",
  "tone",
  "style",
  "audience",
  "focus",
  "objective",
  "narrative",
  "angle",
  "length",
  "intensity",
  "structure",
  "mode",
  "request",
  "variant",
];

export function describeEditorialPreferences(preferences: EditorialPreferences = {}): string {
  const lines = PREFERENCE_KEYS
    .filter((key) => preferences[key] !== null && preferences[key] !== undefined && String(preferences[key]).trim() !== "")
    .map((key) => key.toUpperCase() + ": " + String(preferences[key]).trim());
  return [
    "USER SETTINGS ARE BINDING:",
    ...(lines.length ? lines : ["No optional preference was supplied. Infer only from the task context."]),
    "A selected preference must create a visible difference in voice, structure, evidence selection, rhythm or depth where compatible with the facts.",
    "Do not treat a UI preference as an unused metadata field.",
  ].join("\n");
}

export function buildEditorialSystemPrompt(
  kind: ContentKind,
  preferences: EditorialPreferences = {},
  taskInstructions: string[] = [],
): string {
  return [
    "XPULSE EDITORIAL ENGINE " + EDITORIAL_ENGINE_VERSION,
    GLOBAL_EDITORIAL_STANDARD,
    FORMAT_RULES[kind],
    describeEditorialPreferences({ ...preferences, format: kind }),
    ...taskInstructions.filter(Boolean),
    "GENERATION ORDER: understand the evidence -> select the editorial thesis -> choose the narrative structure -> write -> self-critique -> finalize.",
    "FACTUALITY GATE: if a stronger sentence requires an unsupported fact, do not write that sentence.",
    "SCORE GATE: content quality and virality factors are craft targets, not permission to distort facts.",
    "Return only the requested final content unless the caller explicitly asks for analysis.",
  ].join("\n\n");
}

export function buildEditorialSelfCritiquePrompt(kind: ContentKind): string {
  const formatCheck =
    kind === "post"
      ? "Is there one central idea with compression rather than a mini-article?"
      : kind === "thread"
        ? "Does every tweet move the narrative forward, with tension and payoff where evidence supports them?"
        : "Does the article develop a thesis through context, evidence, interpretation and implications rather than listing metrics?";
  return [
    "FINAL SELF-CRITIQUE — do this silently before output.",
    "1. I am transforming evidence into editorial interpretation, not paraphrasing the analysis.",
    "2. I can state the central thesis in one sentence.",
    "3. " + formatCheck,
    "4. The user's selected settings changed the actual output.",
    "5. There is no generic AI filler, repetition, fake urgency or unsupported claim.",
    "6. Every metric used has a reason to be there.",
    "7. The opening earns attention and the ending delivers a useful payoff.",
    "8. I invented nothing.",
    "9. I can remove no sentence without losing useful value.",
    "10. The result is publishable as written.",
  ].join("\n");
}

const BANNED_LANGUAGE: RegExp[] = [
  /in today's rapidly evolving/i,
  /it's important to note/i,
  /the crypto space is constantly evolving/i,
  /only time will tell/i,
  /this (?:could|can|will) be a game changer/i,
  /let's dive in/i,
  /here's everything you need to know/i,
  /the future (?:looks bright|is here)/i,
  /as an ai/i,
  /exciting opportunity/i,
  /great potential/i,
  /could explode/i,
  /to the moon/i,
  /100x/i,
  /guaranteed/i,
  /risk-free/i,
];

export type EditorialQualityGate = {
  pass: boolean;
  violations: string[];
  notes: string[];
};

export function validateEditorialShape(text: string, kind: ContentKind): EditorialQualityGate {
  const clean = text.trim();
  const violations: string[] = [];
  const notes: string[] = [];

  if (!clean) violations.push("empty_output");
  for (const pattern of BANNED_LANGUAGE) {
    if (pattern.test(clean)) violations.push("banned_language:" + pattern.source);
  }

  if (kind === "thread") {
    const beats = clean
      .split(/\n\s*\n/)
      .map((beat) => beat.replace(/^\s*\d+\s*[/.)-]\s*/, "").trim())
      .filter(Boolean);
    if (beats.length < 4) violations.push("thread_needs_progression");
    if (beats.some((beat) => beat.length > 280)) violations.push("thread_tweet_over_280");
    if (beats.some((beat) => /^(hook|context|insight|summary|implication)\s*:/i.test(beat))) {
      violations.push("thread_outline_labels");
    }
    const repeated = beats.filter((beat, index) => {
      const normalized = beat.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return normalized && beats.findIndex((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalized) !== index;
    }).length;
    if (repeated > 0) violations.push("thread_repeated_beats");
    notes.push("thread_beats:" + beats.length);
  } else if (kind === "article") {
    if (clean.split(/\s+/).length < 250) violations.push("article_too_shallow");
    if (!/[.!?]/.test(clean)) violations.push("article_has_no_argument");
    if (clean.split(/\n\s*\n/).filter(Boolean).length < 4) notes.push("article_has_few_sections");
  } else {
    const wordCount = clean.split(/\s+/).filter(Boolean).length;
    if (wordCount > 280) notes.push("post_is_long_but_not_rejected");
    if (wordCount < 12) notes.push("post_is_highly_compressed");
  }

  return { pass: violations.length === 0, violations, notes };
}

export function preferenceSignature(preferences: EditorialPreferences = {}): string {
  return PREFERENCE_KEYS
    .map((key) => key + ":" + (preferences[key] == null ? "" : String(preferences[key]).trim()))
    .join("|");
}

export const EDITORIAL_VERSION_METADATA = {
  engineVersion: EDITORIAL_ENGINE_VERSION,
  baselineVersion: EDITORIAL_ENGINE_BASELINE,
  promotionRule: "candidate must be current version plus measured improvement; regression is rejected",
  improvementCadence: "weekly",
  timezone: "Europe/Rome",
} as const;
