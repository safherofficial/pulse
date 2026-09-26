import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPublicXPostId } from "./x-public.ts";

test("accepts X and Twitter status URLs and strips suffixes", () => {
  const id = "123456789012345678";
  assert.equal(
    extractPublicXPostId(`https://x.com/example/status/${id}?s=20`),
    id,
  );
  assert.equal(
    extractPublicXPostId(`https://twitter.com/example/statuses/${id}/photo/1`),
    id,
  );
  assert.equal(extractPublicXPostId(id), id);
});

test("rejects non-X URLs", () => {
  assert.equal(extractPublicXPostId("https://example.com/status/123456"), null);
  assert.equal(extractPublicXPostId("https://x.com/example/post/123456"), null);
});
