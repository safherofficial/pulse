/**
 * Fixed evaluation texts for the score loop.
 * These are not viral observations and are never stored as learned samples.
 * scoreContent is the only score. Deltas are computed from it.
 */

import type { ContentFormat } from "./types.ts";

export type BenchmarkCase = {
  id: string;
  kind: ContentFormat;
  text: string;
  /** When true, a rewrite that drops the downside wording fails closed. */
  negative: boolean;
};

export const BENCHMARKS: BenchmarkCase[] = [
  {
    id: "weak-post",
    kind: "post",
    negative: false,
    text: "In today's rapidly evolving landscape it is important to note that the market is doing things and there might be some potential for people who are interested in this general situation without any specific number or named outcome at all today.",
  },
  {
    id: "strong-post",
    kind: "post",
    negative: false,
    text: "Why is the tape flat?\n\nLiquidity is $180K. The 24h move is -1.2%, not a breakout.\n\nRead the pool before the story.",
  },
  {
    id: "buried-question",
    kind: "post",
    negative: false,
    text: "There is a longer opening that walks around the point before it lands anywhere useful for the reader who already knows the pool.\n\nWhy is the tape flat if liquidity is $180K?\n\nThe 24h change is -1.2%.",
  },
  {
    id: "bearish-post",
    kind: "post",
    negative: true,
    text: "EX is down 32.0% over 24h. Activity and structure are weakening.\n\nLiquidity is $70K. Volume is light. This is not a promotional read.",
  },
  {
    id: "severe-article",
    kind: "article",
    negative: true,
    text: "EX is down 96.0% over 24h. The market has deteriorated severely. This is not a bullish setup.\n\nLiquidity is $4.0K. Sells dominate the tape.\n\nAvailable data shows multiple signals consistent with a possible rug pull. That is an inference, not proof that funds were taken.",
  },
  {
    id: "thread-beats",
    kind: "thread",
    negative: true,
    text: "The pool is thin.\n\nSells are leading the 24h tape.\n\nThe 24h change is -32.0%.\n\nRead that before any story.",
  },
];

export const PROMO_RE =
  /\b(exciting opportunity|great potential|could explode|high potential|to the moon|still early|room is awake|strong opportunity)\b/i;

export function concreteTokens(text: string): string[] {
  return text.match(/\$?\d+(?:[.,]\d+)?%?/g)?.filter((token) => token.length >= 2) ?? [];
}

export function preservesAuthorFacts(before: string, after: string): boolean {
  for (const token of concreteTokens(before)) {
    if (!after.includes(token)) return false;
  }
  if (/down\s+\d/.test(before) && !/down\s+\d/.test(after)) return false;
  if (/weakening/i.test(before) && !/weakening/i.test(after)) return false;
  if (/possible rug pull/i.test(before) && !/possible rug pull/i.test(after)) return false;
  if (/not proof/i.test(before) && !/not proof/i.test(after)) return false;
  if (/not a bullish setup/i.test(before) && !/not a bullish setup/i.test(after)) return false;
  if (!PROMO_RE.test(before) && PROMO_RE.test(after)) return false;
  return true;
}
