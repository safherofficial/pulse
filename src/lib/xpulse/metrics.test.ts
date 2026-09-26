import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregate, compareMetricDeficits, comparePublicPosts, engagementRate, publicMetricsEngagement, writingSignals } from "./metrics.ts";
import { sampleModel } from "./sample.ts";
import type { PublicXPost } from "./types";

const publicPost = (text: string, views: number, likes: number): PublicXPost => ({
  id: Math.random().toString(),
  url: "https://x.com/i/status/123456789",
  text,
  createdAt: "2026-09-20T12:00:00.000Z",
  author: { name: "Test", handle: "test" },
  metrics: { views, likes, replies: 10, reposts: 10, quotes: 5, bookmarks: 5 },
  signals: writingSignals(text),
  source: "fxtwitter",
});

test("engagement rate matches the selected-post formula", () => {
  const rate = engagementRate({
    impressions: 1000,
    likes: 10,
    replies: 5,
    reposts: 5,
    bookmarks: 5,
    profileClicks: 10,
    linkClicks: 15,
    detailExpands: 40,
    dwellMs: null,
  });
  assert.equal(rate, 0.05);
});

test("aggregate remains numerically stable for stored readings", () => {
  const all = aggregate(sampleModel.posts);
  assert.ok((all.detailExpands ?? 0) > 100_000);
  assert.equal(all.dwellMs, 252_000);
});

test("writing signals return bounded values", () => {
  const signals = writingSignals("Nobody tells you this: 3 mistakes can destroy a launch in 7 days. Here is how to avoid them.");
  for (const value of Object.values(signals)) assert.ok(value >= 0 && value <= 100);
});

test("public engagement is null when views are unavailable", () => {
  assert.equal(publicMetricsEngagement({ views: null, likes: 10, replies: 1, reposts: 2, quotes: null, bookmarks: null }), null);
});

test("comparison exposes the largest writing gaps first", () => {
  const viral = publicPost("Nobody is talking about this: 7 numbers explain why this changed everything. Here is the secret and why it matters.", 100000, 10000);
  const target = publicPost("I built a thing. It works and I wanted to share it with everyone.", 100000, 1000);
  const gaps = comparePublicPosts(viral, target);
  assert.ok(gaps.length > 0);
  assert.ok(gaps[0]!.gap >= gaps.at(-1)!.gap);
});

test("metric deficits call out a weaker post and skip matched rates", () => {
  const viral = publicPost("Nobody is talking about this: 7 numbers explain why this changed everything.", 100000, 10000);
  const target = publicPost("I built a thing.", 100000, 1000);
  const deficits = compareMetricDeficits(viral, target);
  assert.ok(deficits.some((item) => item.key === "likes"));
  assert.ok(deficits.some((item) => item.key === "engagement"));
  assert.equal(deficits.some((item) => item.key === "replies"), false);
  assert.ok(deficits[0]!.shortfall >= deficits.at(-1)!.shortfall);
});
