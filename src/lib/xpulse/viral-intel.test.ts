import assert from "node:assert/strict";
import { test } from "node:test";
import { isTokenMention } from "./viral-intel.ts";

test("token mention filter rejects shared words and keeps tickers", () => {
  assert.equal(isTokenMention("Flyers send Bonk to the Phantoms", "BONK", "Bonk"), false);
  assert.equal(isTokenMention("BONK vs SHIB market cap", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Bonk Coin price target", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("watching $BONK today", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("Convert 1 BONK (BONK) to CHF", "BONK", "Bonk"), true);
  assert.equal(isTokenMention("BONKUSDT breaks the range", "BONK", "Bonk"), true);
});
