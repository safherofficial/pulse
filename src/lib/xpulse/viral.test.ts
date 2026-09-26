import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeViralWriting } from "./viral.ts";

test("viral writing analysis is deterministic and bounded", () => {
  const result = analyzeViralWriting(
    "Nobody tells you this: 3 changes doubled our saves.\nHere is what we changed.",
    {
      impressions: 10_000,
      likes: 500,
      replies: 80,
      reposts: 120,
      quotes: 25,
      bookmarks: 300,
      profileClicks: 90,
      linkClicks: 40,
      detailExpands: null,
      dwellMs: null,
      reachBasis: "views",
    },
  );

  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.metrics.engagementRate, 11.55);
  assert.equal(result.metrics.quoteRate, 0.25);
  assert.ok(result.detected.includes("open loop"));
  assert.ok(result.detected.includes("concrete numbers"));
  assert.ok(result.caveats.some((item) => /public view count/i.test(item)));
});

test("missing reach never creates a fake rate", () => {
  const result = analyzeViralWriting("A short post.", {
    impressions: 0,
    likes: 10,
    replies: 2,
    reposts: 3,
    bookmarks: 1,
    profileClicks: 0,
    linkClicks: 0,
    detailExpands: null,
    dwellMs: null,
  });

  assert.equal(result.metrics.engagementRate, null);
  assert.equal(result.metrics.repostRate, null);
});
