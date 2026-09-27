import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMarketCapCompact, formatTokenPrice } from "./format.ts";
import { buildTokenFactSet, generateFromFactSet } from "./content-create.ts";
import type { TokenIntel } from "./token-intel.ts";

test("market cap uses compact mc notation", () => {
  assert.equal(formatMarketCapCompact(850), "$850 mc");
  assert.equal(formatMarketCapCompact(1_000), "$1k mc");
  assert.equal(formatMarketCapCompact(12_500), "$12.5k mc");
  assert.equal(formatMarketCapCompact(250_000), "$250k mc");
  assert.equal(formatMarketCapCompact(1_000_000), "$1M mc");
  assert.equal(formatMarketCapCompact(1_400_000), "$1.4M mc");
  assert.equal(formatMarketCapCompact(25_000_000), "$25M mc");
  assert.equal(formatMarketCapCompact(1_200_000_000), "$1.2B mc");
  assert.equal(formatMarketCapCompact(null), null);
  assert.equal(formatMarketCapCompact(Number.NaN), null);
});

test("token price stays readable at small magnitudes", () => {
  assert.equal(formatTokenPrice(1.42), "$1.42");
  assert.equal(formatTokenPrice(0.084), "$0.084");
  assert.equal(formatTokenPrice(0.0042), "$0.0042");
  assert.equal(formatTokenPrice(0.000014), "$0.000014");
  assert.equal(formatTokenPrice(null), null);
});

function intel(marketCap: number | null, priceUsd: number | null): TokenIntel {
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
    },
    market: {
      priceUsd,
      priceChange24h: 4.2,
      priceChange6h: null,
      priceChange1h: null,
      volume24h: 80_000,
      volume6h: null,
      volume1h: null,
      liquidityUsd: 40_000,
      fdv: marketCap,
      marketCap,
      pairAddress: null,
      pairUrl: null,
      dexId: "raydium",
      buys24h: 12,
      sells24h: 9,
      paidListing: null,
      paidListingDetail: null,
      dexPaid: null,
      boostActive: null,
      viralScore: null,
      viralReasons: [],
      updatedAt: "2026-09-27T00:00:00.000Z",
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

test("generated copy keeps the locked price and market cap across variants", () => {
  const facts = buildTokenFactSet(intel(1_400_000, 0.0042));
  assert.equal(facts.metrics.find((m) => m.key === "price")?.value, "$0.0042");
  assert.equal(facts.metrics.find((m) => m.key === "market_cap")?.value, "$1.4M mc");

  const a = generateFromFactSet(facts, "post", "default", 1);
  const b = generateFromFactSet(facts, "thread", "more_story", 19);
  const c = generateFromFactSet(facts, "article", "more_data", 8);
  for (const piece of [a, b, c]) {
    assert.match(piece.text, /\$0\.0042/);
    assert.match(piece.text, /\$1\.4M mc/);
  }
});

test("missing market cap is not invented in generated copy", () => {
  const facts = buildTokenFactSet(intel(null, 1.42));
  assert.equal(facts.metrics.find((m) => m.key === "market_cap"), undefined);
  assert.equal(facts.metrics.find((m) => m.key === "price")?.value, "$1.42");
  const post = generateFromFactSet(facts, "post", "default", 3);
  assert.match(post.text, /\$1\.42/);
  assert.doesNotMatch(post.text, /\$\d[\d.]*[kMBT]?\s*mc\b/);
});
