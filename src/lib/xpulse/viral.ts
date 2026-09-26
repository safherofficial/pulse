import type { PostMetrics } from "./types";

export type ViralSignal = {
  key:
    | "hook"
    | "clarity"
    | "curiosity"
    | "specificity"
    | "emotion"
    | "shareability"
    | "readability"
    | "structure";
  label: string;
  score: number;
  reason: string;
};

export type ViralWritingAnalysis = {
  version: 1;
  score: number;
  signals: ViralSignal[];
  metrics: {
    likeRate: number | null;
    replyRate: number | null;
    repostRate: number | null;
    quoteRate: number | null;
    bookmarkRate: number | null;
    profileClickRate: number | null;
    linkClickRate: number | null;
    engagementRate: number | null;
    amplificationRate: number | null;
    conversationRate: number | null;
  };
  detected: string[];
  caveats: string[];
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(value)));

const ratio = (value: number, denominator: number): number | null =>
  denominator > 0 && Number.isFinite(value) ? value / denominator : null;

const pct = (value: number | null) =>
  value == null ? null : Number((value * 100).toFixed(3));

const words = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;

const sentences = (text: string) =>
  text
    .split(/[.!?]+(?:\s|$)/u)
    .map((part) => part.trim())
    .filter(Boolean);

const firstSentence = (text: string) =>
  sentences(text)[0] ?? text.trim();

const hasNumber = (text: string) => /\b\d+(?:[.,]\d+)?%?\b/u.test(text);
const hasQuestion = (text: string) => /[?]/u.test(text);
const hasContrast = (text: string) =>
  /\b(but|however|instead|until|yet|actually|except|while)\b/iu.test(text);
const hasOpenLoop = (text: string) =>
  /\b(here'?s|why|how|what if|the reason|nobody|no one|secret|mistake|learned|found out|turns out)\b/iu.test(
    text,
  );
const hasDirectAddress = (text: string) =>
  /\b(you|your|you're|you've|we|our|us)\b/iu.test(text);
const hasActionLanguage = (text: string) =>
  /\b(try|use|build|make|avoid|save|learn|watch|read|follow|reply|share|comment|start|stop)\b/iu.test(
    text,
  );
const hasEmotionalLanguage = (text: string) =>
  /\b(love|hate|fear|surprise|shocking|crazy|wild|brilliant|terrible|beautiful|pain|win|lose|fail|success|excited|angry|wrong|right|secret|mistake)\b/iu.test(
    text,
  );

function rateFor(
  value: number,
  metrics: PostMetrics,
): number | null {
  return ratio(value, metrics.impressions);
}

function scoreHook(text: string): [number, string] {
  const hook = firstSentence(text);
  const count = words(hook);
  if (!hook) return [0, "No opening sentence was available."];

  let score = 48;
  if (count >= 4 && count <= 16) score += 16;
  else if (count <= 24) score += 8;
  if (hasQuestion(hook)) score += 10;
  if (hasNumber(hook)) score += 8;
  if (hasContrast(hook)) score += 8;
  if (hasOpenLoop(hook)) score += 10;
  if (/^[A-Z0-9$€£]/u.test(hook)) score += 2;

  return [
    clamp(score),
    count <= 16
      ? "The opening is compact enough to create a fast first read."
      : "The opening is relatively long; a tighter first line may create more interruption.",
  ];
}

function scoreClarity(text: string): [number, string] {
  const count = words(text);
  const avg = sentences(text).length
    ? count / sentences(text).length
    : count;
  const punctuation = (text.match(/[,:;()[\]—-]/gu) ?? []).length;
  let score = 86;
  if (avg > 24) score -= 18;
  else if (avg > 18) score -= 8;
  if (punctuation > Math.max(8, count / 3)) score -= 8;
  if (count < 8) score -= 10;

  return [
    clamp(score),
    avg <= 18
      ? "Short sentence structure keeps the main claim easy to parse."
      : "Longer sentence structure increases cognitive load.",
  ];
}

function scoreCuriosity(text: string): [number, string] {
  let score = 38;
  if (hasQuestion(text)) score += 15;
  if (hasOpenLoop(text)) score += 25;
  if (hasContrast(text)) score += 12;
  if (/\.\.\./u.test(text)) score += 6;
  if (/\b(before|after|then|finally)\b/iu.test(text)) score += 5;

  return [
    clamp(score),
    score >= 65
      ? "The copy contains an identifiable information gap or open loop."
      : "The copy makes its point relatively directly, with limited open-loop tension.",
  ];
}

function scoreSpecificity(text: string): [number, string] {
  let score = 42;
  if (hasNumber(text)) score += 25;
  if (/\b[A-Z][a-z]{2,}\b/u.test(text)) score += 8;
  if (/\b(today|tomorrow|yesterday|hours?|days?|weeks?|months?)\b/iu.test(text)) score += 8;
  if (/\b\d+(?:\.\d+)?\s*(?:k|m|b)\b/iu.test(text)) score += 10;

  return [
    clamp(score),
    hasNumber(text)
      ? "Concrete numbers or quantities make the claim easier to verify and remember."
      : "The copy contains few concrete quantities; adding a precise fact can improve specificity.",
  ];
}

function scoreEmotion(text: string): [number, string] {
  let score = 34;
  if (hasEmotionalLanguage(text)) score += 28;
  if (/[!]/u.test(text)) score += 8;
  if (/\b(imagine|feel|believe|hope|fear|love|hate)\b/iu.test(text)) score += 15;

  return [
    clamp(score),
    score >= 60
      ? "The wording contains an explicit emotional or high-arousal cue."
      : "The copy is comparatively neutral in emotional language.",
  ];
}

function scoreShareability(text: string): [number, string] {
  const count = words(text);
  let score = 50;
  if (count >= 10 && count <= 70) score += 14;
  if (hasNumber(text)) score += 8;
  if (hasActionLanguage(text)) score += 8;
  if (hasDirectAddress(text)) score += 6;
  if ((text.match(/#/gu) ?? []).length > 3) score -= 12;
  if ((text.match(/https?:\/\//gu) ?? []).length > 2) score -= 8;

  return [
    clamp(score),
    score >= 65
      ? "The post contains compact, transferable information that can stand alone when shared."
      : "The post is more dependent on context or personal voice than on a compact shareable claim.",
  ];
}

function scoreReadability(text: string): [number, string] {
  const count = words(text);
  const sentenceCount = Math.max(1, sentences(text).length);
  const avgWords = count / sentenceCount;
  const lineCount = text.split(/\n+/u).filter(Boolean).length;
  let score = 88;
  if (avgWords > 22) score -= 16;
  else if (avgWords > 17) score -= 8;
  if (lineCount === 1 && count > 40) score -= 10;
  if (lineCount >= 2 && count >= 20) score += 5;
  if (count > 120) score -= 8;

  return [
    clamp(score),
    lineCount > 1
      ? "Whitespace or line breaks provide visual scanning points."
      : "The post is a single block; line breaks may improve scanning on mobile.",
  ];
}

function scoreStructure(text: string): [number, string] {
  let score = 46;
  const lineCount = text.split(/\n+/u).filter(Boolean).length;
  const hasList = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/u.test(text);
  if (lineCount >= 2) score += 15;
  if (hasList) score += 15;
  if (hasQuestion(firstSentence(text))) score += 8;
  if (hasActionLanguage(text)) score += 6;
  if (sentences(text).length >= 3) score += 5;

  return [
    clamp(score),
    hasList || lineCount >= 2
      ? "The post has visible structural cues that separate ideas."
      : "The post is structurally simple; a stronger hook/body/payoff separation may help.",
  ];
}

export function analyzeViralWriting(
  text: string,
  metrics: ReachMetrics,
): ViralWritingAnalysis {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const signalInputs: Array<[ViralSignal["key"], string, (text: string) => [number, string]]> = [
    ["hook", "Hook", scoreHook],
    ["clarity", "Clarity", scoreClarity],
    ["curiosity", "Curiosity", scoreCuriosity],
    ["specificity", "Specificity", scoreSpecificity],
    ["emotion", "Emotion", scoreEmotion],
    ["shareability", "Shareability", scoreShareability],
    ["readability", "Readability", scoreReadability],
    ["structure", "Structure", scoreStructure],
  ];

  const signals = signalInputs.map(([key, label, scorer]) => {
    const [score, reason] = scorer(normalized);
    return { key, label, score, reason };
  });

  const score =
    clamp(
      signals.reduce((sum, signal) => sum + signal.score, 0) /
        Math.max(1, signals.length),
    );

  const engagement = engagementRateSafe(metrics);
  const amplification = ratio(metrics.reposts + (metrics.quotes ?? 0), metrics.impressions);
  const conversation = ratio(metrics.replies, metrics.impressions);

  const detected: string[] = [];
  if (hasQuestion(normalized)) detected.push("question hook");
  if (hasNumber(normalized)) detected.push("concrete numbers");
  if (hasOpenLoop(normalized)) detected.push("open loop");
  if (hasContrast(normalized)) detected.push("contrast");
  if (hasActionLanguage(normalized)) detected.push("action language");
  if (hasDirectAddress(normalized)) detected.push("direct reader address");
  if (/\b(?:thread|1\/\d+)\b/iu.test(normalized)) detected.push("thread framing");
  if ((normalized.match(/#/gu) ?? []).length > 0) detected.push("hashtags");
  if ((normalized.match(/https?:\/\//gu) ?? []).length > 0) detected.push("external link");

  const caveats: string[] = [
    "XPulse signal scores describe writing patterns; they are not a measurement of X's ranking algorithm.",
  ];

  if (metrics.impressions <= 0) {
    caveats.push("No public reach denominator was available, so engagement-rate metrics are unavailable.");
  } else if (metrics.reachBasis === "views") {
    caveats.push("Public view count is used as the denominator; views are not the same thing as X's private impressions metric.");
  }

  return {
    version: 1,
    score,
    signals,
    metrics: {
      likeRate: pct(rateFor(metrics.likes, metrics)),
      replyRate: pct(rateFor(metrics.replies, metrics)),
      repostRate: pct(rateFor(metrics.reposts, metrics)),
      quoteRate: pct(rateFor(metrics.quotes ?? 0, metrics)),
      bookmarkRate: pct(rateFor(metrics.bookmarks, metrics)),
      profileClickRate: pct(rateFor(metrics.profileClicks, metrics)),
      linkClickRate: pct(rateFor(metrics.linkClicks, metrics)),
      engagementRate: pct(engagement),
      amplificationRate: pct(amplification),
      conversationRate: pct(conversation),
    },
    detected,
    caveats,
  };
}

type ReachMetrics = PostMetrics & {
  quotes?: number;
  reachBasis?: string;
};

function engagementRateSafe(metrics: ReachMetrics): number | null {
  return ratio(
    metrics.likes +
      metrics.replies +
      metrics.reposts +
      (metrics.quotes ?? 0) +
      metrics.bookmarks +
      metrics.profileClicks +
      metrics.linkClicks,
    metrics.impressions,
  );
}
