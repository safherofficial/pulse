/**
 * Normalize and read a draft without inventing fields.
 * Language is a stopword guess, not a translation.
 */

export type DraftLanguage = "en" | "it" | "es" | "fr" | "und";

export type DraftIntent = "market_caution" | "market_positive" | "educational" | "question" | "commentary";

export type DraftFormat = "post" | "thread" | "article" | "note" | "headline";

const IT = new Set("che non una per con della questo sono anche più come quando perché degli".split(" "));
const EN = new Set("the and to of a is for with that this from your".split(" "));
const ES = new Set("que los las una por con como para está este".split(" "));
const FR = new Set("les des une que pour dans avec est cette".split(" "));

export function normalizeDraft(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

export function detectLanguage(text: string): DraftLanguage {
  const list = words(text);
  const score = (set: Set<string>) => list.filter((word) => set.has(word)).length;
  const ranks: Array<[DraftLanguage, number]> = [
    ["it", score(IT)],
    ["en", score(EN)],
    ["es", score(ES)],
    ["fr", score(FR)],
  ];
  ranks.sort((a, b) => b[1] - a[1]);
  if ((ranks[0]?.[1] ?? 0) < 2) return "und";
  if (ranks[0]![1] === ranks[1]?.[1]) return "und";
  return ranks[0]![0];
}

export function detectFormat(text: string, preferred?: DraftFormat | null): DraftFormat {
  if (preferred === "post" || preferred === "thread" || preferred === "article") return preferred;
  if (/^\s*\d+\s*\//m.test(text)) return "thread";
  const count = words(text).length;
  if (count > 0 && count <= 12 && !text.includes("\n")) return "headline";
  if (count >= 140 || /\n#{1,3}\s+\S/.test(text)) return "article";
  if (count < 8) return "note";
  return "post";
}

export function detectIntent(text: string): DraftIntent {
  if (/down\s+\d|rug|severe|liquidity is (very )?low|weakening|not a bullish/i.test(text)) return "market_caution";
  if (/\bup\s+\d|\bbullish\b|breakout/i.test(text) && !/not a bullish/i.test(text)) return "market_positive";
  if (/\b(how to|here's how|ecco come|passo)\b/i.test(text)) return "educational";
  if (text.includes("?")) return "question";
  return "commentary";
}

export function extractEntities(text: string): {
  tickers: string[];
  mentions: string[];
  urls: string[];
  addresses: string[];
} {
  return {
    tickers: unique(text.match(/\$[A-Za-z][A-Za-z0-9]{1,12}/g) ?? []),
    mentions: unique(text.match(/@[A-Za-z0-9_]{2,30}/g) ?? []),
    urls: unique(text.match(/https?:\/\/\S+/gi) ?? []),
    addresses: unique(
      text.match(/\b(?:0x[a-fA-F0-9]{8,}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g) ?? [],
    ),
  };
}

export function extractStatements(text: string): { facts: string[]; claims: string[] } {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 12);
  const facts = sentences.filter((sentence) => /\d/.test(sentence) || /https?:\/\//i.test(sentence));
  const claims = sentences.filter((sentence) =>
    /\b(guaranteed|partnership|raised|confirmed rug|will 100x|investors?|backed by)\b/i.test(sentence),
  );
  return { facts, claims };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
