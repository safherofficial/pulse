import assert from "node:assert/strict";
import { test } from "node:test";
import { isTokenMention, type ViralPost } from "./viral-intel.ts";
import { rankXPosts } from "./viral-collect.ts";

test("token mention filter rejects shared words and keeps tickers", () => {
  assert.equal(isTokenMention("Flyers send Bonk to the Phantoms", "BONK", "Bonk"), false);
  assert.equal(isTokenMention("BONK vs SHIB market cap", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Bonk Coin price target", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("watching $BONK today", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Convert 1 BONK (BONK) to CHF", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("BONKUSDT breaks the range", "BONK", "Bonk"), true);
});

test("X ranking returns only X posts and labels strong posts as trending", () => {
  const posts: ViralPost[] = [
    {
      platform: "x",
      author: "@alpha",
      text: "Large X signal",
      url: "https://x.com/alpha/status/1",
      likes: 250000,
      views: 2_000_000,
      replies: 18000,
      createdAt: new Date().toISOString(),
      score: null,
      signal: "relevant",
    },
    {
      platform: "x",
      author: "@beta",
      text: "Relevant X post",
      url: "https://x.com/beta/status/2",
      likes: 15,
      views: 200,
      replies: 1,
      createdAt: new Date(Date.now() - 72 * 3600_000).toISOString(),
      score: null,
      signal: "relevant",
    },
  ];

  const ranked = rankXPosts(posts);
  assert.equal(ranked[0]?.platform, "x");
  assert.equal(ranked[0]?.signal, "trending");
  assert.equal(ranked[1]?.signal, "relevant");
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
});
