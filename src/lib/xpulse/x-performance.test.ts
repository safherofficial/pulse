import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveContentPerformance } from "./x-performance.ts";
import type { PostMetrics } from "./types.ts";

const metrics = (impressions: number, likes: number, replies = 0, reposts = 0, bookmarks = 0): PostMetrics => ({
  impressions,
  likes,
  replies,
  reposts,
  bookmarks,
  profileClicks: 0,
  linkClicks: 0,
  detailExpands: null,
  dwellMs: null,
});

test("derives real account-specific performance patterns without LLM scoring", () => {
  const posts = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    type: "tweet",
    text: i < 4 ? `12% moved this week — the setup is changing.\\n\\nWhat are you watching?` : "A longer generic market update with several words and no concrete opening signal.",
    metrics: i < 4 ? metrics(10_000, 300, 40, 30, 20) : metrics(10_000, 40, 5, 2, 1),
    publishedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
  }));

  const guidance = deriveContentPerformance(posts);

  assert.equal(guidance.sampleCount, 8);
  assert.equal(guidance.measuredCount, 8);
  assert.ok(guidance.baseline.medianEngagementRate);
  assert.ok(guidance.patterns.some((pattern) => pattern.signal === "numeric_hook"));
  assert.ok(guidance.topPosts.length > 0);
});
