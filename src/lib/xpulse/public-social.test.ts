import assert from "node:assert/strict";
import { test } from "node:test";
import { accountId, normalizeHandle, PUBLIC_SOCIAL_SEED } from "./public-social.ts";

test("handles are unique and normalized", () => {
  const keys = PUBLIC_SOCIAL_SEED.map((row) => accountId(row));
  assert.equal(new Set(keys).size, keys.length);
  for (const row of PUBLIC_SOCIAL_SEED) {
    assert.equal(row.handle, normalizeHandle(row.handle));
    assert.equal(row.verificationStatus, "official");
    assert.match(row.profileUrl, /^https:\/\/x\.com\/[a-z0-9_]+$/);
  }
  assert.equal(normalizeHandle("@Solana"), "solana");
});
