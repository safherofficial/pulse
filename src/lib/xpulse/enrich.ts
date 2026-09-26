import { analyzeViralWriting, type ViralWritingAnalysis } from "./viral";
import { writingSignals } from "./metrics";
import {
  checkLanguageTool,
  expandVagueVocabulary,
  fetchVxTwitterStatus,
  type LanguageToolMatch,
} from "./public-apis";
import { rewritePost, suggestEdits, type EditSuggestion, type RewriteResult } from "./rewrite";
import {
  getTrendSnapshot,
  trendAlignmentScore,
  trendRewriteHints,
  type TrendSnapshot,
} from "./trends";
import type { PostMetrics, WritingSignals } from "./types";
import { extractPublicXPostId, resolvePublicXPost } from "./x-public";

export type EnrichedAnalysis = {
  text: string;
  writingSignals: WritingSignals;
  viral: ViralWritingAnalysis;
  suggestions: EditSuggestion[];
  languageTool: LanguageToolMatch[];
  vocabulary: Record<string, string[]>;
  publicReach: {
    provider: string[];
    views: number | null;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    bookmarks: number;
  } | null;
  trends: TrendSnapshot | null;
  trendAlignment: number;
  sources: string[];
};

export type EnrichedRewrite = RewriteResult & {
  languageToolApplied: number;
  vocabularySwaps: string[];
  viral: ViralWritingAnalysis;
  trends: TrendSnapshot | null;
  trendAlignment: number;
  sources: string[];
};

function emptyMetrics(views: number | null = null): PostMetrics & { quotes?: number; reachBasis?: string } {
  return {
    impressions: views ?? 0,
    likes: 0,
    replies: 0,
    reposts: 0,
    bookmarks: 0,
    profileClicks: 0,
    linkClicks: 0,
    detailExpands: null,
    dwellMs: null,
    quotes: 0,
    reachBasis: views != null ? "views" : undefined,
  };
}

/**
 * Full public enrichment: viral engine + LanguageTool + Datamuse + optional X mirrors.
 */
export async function enrichPostAnalysis(input: {
  text: string;
  metrics?: PostMetrics & { quotes?: number };
  xPostId?: string | null;
}): Promise<EnrichedAnalysis> {
  const text = input.text.trim();
  const sources: string[] = ["xpulse-viral", "xpulse-signals"];
  const id = input.xPostId?.trim() || extractPublicXPostId(text) || null;

  const [languageTool, vocabulary, vx, fx] = await Promise.all([
    checkLanguageTool(text).then((rows) => {
      if (rows.length) sources.push("languagetool.org");
      return rows;
    }),
    expandVagueVocabulary(text).then((map) => {
      if (Object.keys(map).length) sources.push("datamuse.com");
      return map;
    }),
    id
      ? fetchVxTwitterStatus(id).then((row) => {
          if (row) sources.push("api.vxtwitter.com");
          return row;
        })
      : Promise.resolve(null),
    id
      ? resolvePublicXPost(id)
          .then((row) => {
            sources.push(`x-public:${row.provider}`);
            return row;
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  let metrics: PostMetrics & { quotes?: number; reachBasis?: string } =
    input.metrics ?? emptyMetrics();

  if (vx || fx) {
    const views = vx?.views ?? fx?.views ?? null;
    metrics = {
      impressions: views ?? metrics.impressions,
      likes: Math.max(metrics.likes, vx?.likes ?? 0, fx?.likes ?? 0),
      replies: Math.max(metrics.replies, vx?.replies ?? 0, fx?.replies ?? 0),
      reposts: Math.max(metrics.reposts, vx?.retweets ?? 0, fx?.reposts ?? 0),
      bookmarks: Math.max(metrics.bookmarks, vx?.bookmarks ?? 0, fx?.bookmarks ?? 0),
      profileClicks: metrics.profileClicks,
      linkClicks: metrics.linkClicks,
      detailExpands: metrics.detailExpands,
      dwellMs: metrics.dwellMs,
      quotes: Math.max(metrics.quotes ?? 0, vx?.quotes ?? 0, fx?.quotes ?? 0),
      reachBasis: views != null ? "views" : metrics.reachBasis,
    };
  }

  const viral = analyzeViralWriting(text, metrics);
  const signals = writingSignals(text);
  const suggestions = suggestEdits(text);

  let trends: TrendSnapshot | null = null;
  let trendAlignment = 0;
  try {
    trends = await getTrendSnapshot();
    trendAlignment = trendAlignmentScore(text, trends);
    if (trends.sources.length) sources.push(...trends.sources.map((s) => `trends:${s}`));
  } catch {
    trends = null;
  }

  const publicReach =
    vx || fx
      ? {
          provider: sources.filter((s) => s.startsWith("x-public") || s.includes("vxtwitter")),
          views: metrics.impressions > 0 ? metrics.impressions : null,
          likes: metrics.likes,
          replies: metrics.replies,
          reposts: metrics.reposts,
          quotes: metrics.quotes ?? 0,
          bookmarks: metrics.bookmarks,
        }
      : null;

  return {
    text,
    writingSignals: signals,
    viral,
    suggestions,
    languageTool,
    vocabulary,
    publicReach,
    trends,
    trendAlignment,
    sources: [...new Set(sources)],
  };
}

function applyLanguageToolFixes(text: string, matches: LanguageToolMatch[]): {
  text: string;
  applied: number;
} {
  // Apply high-confidence single replacements from the end so offsets stay valid
  const usable = matches
    .filter((m) => m.replacements[0] && m.length > 0)
    .filter((m) => {
      const cat = m.category.toLowerCase();
      const rule = m.ruleId.toLowerCase();
      // Prefer grammar/typos; skip pure style nits that change voice too aggressively
      return (
        cat.includes("grammar") ||
        cat.includes("typo") ||
        cat.includes("misspelling") ||
        rule.includes("typo") ||
        rule.includes("morphology") ||
        rule.includes("agreement")
      );
    })
    .sort((a, b) => b.offset - a.offset)
    .slice(0, 12);

  let out = text;
  let applied = 0;
  for (const match of usable) {
    const before = out.slice(match.offset, match.offset + match.length);
    const next = match.replacements[0]!;
    if (!before || before === next) continue;
    out = out.slice(0, match.offset) + next + out.slice(match.offset + match.length);
    applied += 1;
  }
  return { text: out, applied };
}

function applyVocabularySwaps(text: string, vocabulary: Record<string, string[]>): {
  text: string;
  swaps: string[];
} {
  let out = text;
  const swaps: string[] = [];
  for (const [word, alts] of Object.entries(vocabulary)) {
    const pick = alts.find((a) => a.length > 2 && a.length < 18);
    if (!pick) continue;
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (!re.test(out)) continue;
    // Only swap the first occurrence to avoid robotic repetition
    out = out.replace(re, (matched) => {
      const replacement =
        matched[0] === matched[0]!.toUpperCase()
          ? pick.charAt(0).toUpperCase() + pick.slice(1)
          : pick;
      swaps.push(`${matched} → ${replacement}`);
      return replacement;
    });
  }
  return { text: out, swaps };
}

/**
 * Rewrite pipeline: LanguageTool → Datamuse vocabulary → local viral rewrite.
 */
export async function enrichAndRewrite(text: string, variant = 0): Promise<EnrichedRewrite> {
  const sources: string[] = ["xpulse-rewrite"];
  const [matches, vocabulary, trends] = await Promise.all([
    checkLanguageTool(text).then((rows) => {
      if (rows.length) sources.push("languagetool.org");
      return rows;
    }),
    expandVagueVocabulary(text).then((map) => {
      if (Object.keys(map).length) sources.push("datamuse.com");
      return map;
    }),
    getTrendSnapshot().then((snap) => {
      if (snap.sources.length) sources.push(...snap.sources.map((s) => `trends:${s}`));
      return snap;
    }).catch(() => null),
  ]);

  let working = text.trim();
  const lt = applyLanguageToolFixes(working, matches);
  working = lt.text;
  const vocab = applyVocabularySwaps(working, vocabulary);
  working = vocab.text;

  // Bump variant after public-API polish so each click explores a new high-score frame
  const local = rewritePost(working, Math.max(0, Math.floor(variant)));
  const viral = analyzeViralWriting(local.text, emptyMetrics());
  const trendAlignment = trends ? trendAlignmentScore(local.text, trends) : 0;
  const hints = trends ? trendRewriteHints(trends) : [];

  return {
    ...local,
    applied: [
      ...local.applied,
      ...(lt.applied ? [`LanguageTool fixed ${lt.applied} grammar/typo issue(s)`] : []),
      ...vocab.swaps.map((s) => `Lexicon: ${s}`),
      ...hints.map((h) => `Trend: ${h}`),
    ],
    languageToolApplied: lt.applied,
    vocabularySwaps: vocab.swaps,
    viral,
    trends,
    trendAlignment,
    sources: [...new Set(sources)],
  };
}
