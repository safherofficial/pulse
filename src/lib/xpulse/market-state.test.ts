import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTokenState, type MarketStateInput } from "./market-state.ts";
import { buildTokenFactSet, generateFromFactSet, type RegenMode } from "./content-create.ts";
import type { TokenIntel } from "./token-intel.ts";

function input(partial: Partial<MarketStateInput>): MarketStateInput {
  return {
    name: "Example",
    symbol: "EX",
    chain: "solana",
    priceUsd: 0.0042,
    marketCap: 1_400_000,
    liquidityUsd: 250_000,
    priceChange1h: 0,
    priceChange6h: 0,
    priceChange24h: 0,
    volume24h: 80_000,
    buys24h: 120,
    sells24h: 110,
    website: "https://example.com",
    twitter: "https://x.com/example",
    mentionsAvailability: "empty",
    mentionTexts: [],
    ...partial,
  };
}

test("healthy growth with deep liquidity reads positive or bullish", () => {
  const moderate = analyzeTokenState(
    input({ priceChange24h: 14, liquidityUsd: 400_000, volume24h: 180_000, buys24h: 300, sells24h: 180 }),
  );
  assert.equal(moderate.state, "POSITIVE");
  assert.equal(moderate.rugPullRisk, "low");
  assert.doesNotMatch(moderate.headline, /rug pull/i);

  const strong = analyzeTokenState(
    input({ priceChange24h: 28, liquidityUsd: 500_000, volume24h: 220_000, buys24h: 400, sells24h: 210 }),
  );
  assert.equal(strong.state, "BULLISH");
  assert.ok(strong.riskScore <= 40);
});

test("stable price and normal liquidity stay neutral", () => {
  const read = analyzeTokenState(
    input({ priceChange24h: -1.2, liquidityUsd: 180_000, volume24h: 60_000, buys24h: 90, sells24h: 95 }),
  );
  assert.equal(read.state, "NEUTRAL");
  assert.equal(read.rugPullRisk, "low");
});

test("a significant decline with weakening activity is bearish, not a rug call", () => {
  const read = analyzeTokenState(
    input({
      priceChange24h: -32,
      liquidityUsd: 70_000,
      volume24h: 9_000,
      buys24h: 30,
      sells24h: 48,
      website: "https://example.com",
      twitter: "https://x.com/example",
    }),
  );
  assert.equal(read.state, "BEARISH");
  assert.equal(read.rugPullRisk, "low");
  assert.equal(read.rugLine, null);
});

test("a 90% drop is severe risk and does not allege a confirmed rug", () => {
  const read = analyzeTokenState(
    input({
      priceChange24h: -90,
      liquidityUsd: 180_000,
      volume24h: 40_000,
      buys24h: 40,
      sells24h: 55,
    }),
  );
  assert.equal(read.state, "SEVERE_RISK");
  assert.equal(read.rugPullRisk, "unconfirmed");
  assert.match(read.rugLine ?? "", /does not prove a rug pull/i);
  assert.doesNotMatch(`${read.headline} ${read.rugLine}`, /was rugged|stole the funds/i);
});

test("a 97% drop with a still-healthy book stays a severe collapse, not a rug allegation", () => {
  const read = analyzeTokenState(
    input({
      priceChange24h: -97,
      liquidityUsd: 220_000,
      volume24h: 30_000,
      buys24h: 20,
      sells24h: 24,
    }),
  );
  assert.ok(read.state === "COLLAPSED" || read.state === "SEVERE_RISK");
  assert.equal(read.rugPullRisk, "unconfirmed");
  assert.match(read.rugLine ?? "", /does not prove a rug pull/i);
});

test("extreme collapse plus stacked red flags is a possible rug, not a proven one", () => {
  const read = analyzeTokenState(
    input({
      priceChange24h: -96,
      priceUsd: 0.000014,
      marketCap: 1_400_000,
      liquidityUsd: 4_000,
      volume24h: 90_000,
      buys24h: 20,
      sells24h: 180,
      website: null,
      twitter: null,
      mentionsAvailability: "empty",
    }),
  );
  assert.ok(read.state === "COLLAPSED" || read.state === "SEVERE_RISK");
  assert.ok(read.rugPullRisk === "high" || read.rugPullRisk === "critical");
  assert.ok(read.riskScore >= 81);
  assert.match(read.rugLine ?? "", /possible rug pull/i);
  assert.match(read.rugLine ?? "", /not proof/i);
  assert.doesNotMatch(read.conclusions.join(" "), /definitely|stole the funds|was rugged/i);
});

function token(partial: Partial<TokenIntel["market"]>, identity?: Partial<TokenIntel["identity"]>): TokenIntel {
  return {
    identity: {
      address: "So11111111111111111111111111111111111111112",
      name: "Example",
      symbol: "EX",
      decimals: 9,
      logoUrl: null,
      chain: "solana",
      website: null,
      twitter: null,
      telegram: null,
      ...identity,
    },
    market: {
      priceUsd: 0.000014,
      priceChange24h: -96,
      priceChange6h: -40,
      priceChange1h: -12,
      volume24h: 90_000,
      volume6h: null,
      volume1h: null,
      liquidityUsd: 4_000,
      fdv: 1_400_000,
      marketCap: 1_400_000,
      pairAddress: null,
      pairUrl: null,
      dexId: "raydium",
      buys24h: 20,
      sells24h: 180,
      paidListing: null,
      paidListingDetail: null,
      dexPaid: null,
      boostActive: null,
      viralScore: null,
      viralReasons: [],
      updatedAt: "2026-09-27T00:00:00.000Z",
      ...partial,
    },
    chart: [],
    analysis: {
      snapshot: "Pair is live.",
      marketStructure: "Single pool.",
      liquidity: "Liquidity is reported.",
      activity: "Flow is modest.",
      narrative: "No extra narrative.",
      risks: ["Thin book."],
    },
    mentions: {
      totalFound: 0,
      items: [],
      note: "No verified public X mentions found for this token right now.",
      updatedAt: "2026-09-27T00:00:00.000Z",
      availability: "empty",
    },
    freshness: "2026-09-27T00:00:00.000Z",
  };
}

test("style changes wording and preserves the severe conclusion", () => {
  const facts = buildTokenFactSet(token({}));
  assert.ok(facts.market.state === "COLLAPSED" || facts.market.state === "SEVERE_RISK");
  const modes: RegenMode[] = ["default", "stronger_hook", "more_viral", "more_professional", "more_human"];
  const texts = modes.map((mode) => generateFromFactSet(facts, "post", mode, 4).text);
  for (const text of texts) {
    assert.match(text, /down 96\.0%/);
    assert.match(text, /possible rug pull/i);
    assert.match(text, /liquidity/i);
    assert.match(text, /sell/i);
    assert.match(text, /\$1\.4M mc/);
    assert.doesNotMatch(text, /exciting opportunity|great potential|could explode|high potential|to the moon|room is awake/i);
  }
  assert.ok(new Set(texts).size >= 3);

  const thread = generateFromFactSet(facts, "thread", "more_viral", 2).text;
  const article = generateFromFactSet(facts, "article", "more_professional", 2).text;
  for (const text of [thread, article]) {
    assert.match(text, /down 96\.0%/);
    assert.match(text, /possible rug pull/i);
    assert.doesNotMatch(text, /exciting opportunity|to the moon|could explode/i);
  }

  const again = generateFromFactSet(facts, "post", "more_story", 11).text;
  assert.match(again, /down 96\.0%/);
  assert.match(again, /possible rug pull/i);
});
