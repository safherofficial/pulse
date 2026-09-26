import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTokenMention,
  parseCompactCount,
  parseYoutubeAgeHours,
  rollupAttention,
  type PlatformMention,
} from "./viral-intel.ts";

test("token mention filter rejects shared words and keeps tickers", () => {
  assert.equal(isTokenMention("Flyers send Bonk to the Phantoms", "BONK", "Bonk"), false);
  assert.equal(isTokenMention("BONK vs SHIB market cap", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Bonk Coin price target", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("watching $BONK today", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Convert 1 BONK (BONK) to CHF", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("BONKUSDT breaks the range", "BONK", "Bonk"), true);
});

test("youtube age stays inside a real 24h window", () => {
  assert.equal(parseYoutubeAgeHours("8 hours ago"), 8);
  assert.equal(parseYoutubeAgeHours("Streamed 19 hours ago"), 19);
  assert.equal(parseYoutubeAgeHours("22 minutes ago"), 22 / 60);
  assert.equal(parseYoutubeAgeHours("1 day ago"), 24);
  assert.ok((parseYoutubeAgeHours("1 day ago") ?? 0) >= 24);
  assert.equal(parseYoutubeAgeHours(null), null);
  assert.equal(parseCompactCount("1,837 views"), 1837);
  assert.equal(parseCompactCount("1.2K views"), 1200);
});

test("unavailable platforms are not counted as zero", () => {
  const platforms: PlatformMention[] = [
    {
      platform: "x",
      label: "X",
      mentions24h: null,
      reliability: "unavailable",
      note: null,
    },
    {
      platform: "youtube",
      label: "YouTube",
      mentions24h: 4,
      reliability: "partial",
      note: null,
    },
  ];
  const rolled = rollupAttention(platforms, 2);
  assert.equal(rolled.totalMentions24h, 4);
  assert.equal(rolled.totalReliability, "partial");
  assert.equal(rolled.activity, "low");
});
