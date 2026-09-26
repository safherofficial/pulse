import type { PulseModel, PulsePost } from "./types";

function heat(): number[][] {
  const bases = [0.42, 0.78, 0.95, 0.88, 0.7, 0.38, 0.58];
  return bases.map((base, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const afternoon = Math.exp(-((hour - 16) ** 2) / 16);
      const morning = Math.exp(-((hour - 9) ** 2) / 12) * (day < 5 ? 0.55 : 0.15);
      const late = day >= 5 ? Math.exp(-((hour - 20) ** 2) / 14) * 0.65 : 0;
      const value = base * (0.12 + afternoon + morning + late);
      return Math.max(0, Math.min(1, Number(value.toFixed(3))));
    }),
  );
}

const thread: PulsePost = {
  id: "sample-thread",
  xPostId: "1849921000000000001",
  type: "thread",
  text: "Launching Keel. A field notebook that stays out of the way until the sentence is finished. The thread travels. The article is where people stay.",
  publishedAt: "2026-09-16T15:05:00.000Z",
  metrics: {
    impressions: 1_840_220,
    likes: 41_200,
    replies: 1_860,
    reposts: 9_440,
    bookmarks: 12_080,
    profileClicks: 18_430,
    linkClicks: 3_220,
    detailExpands: 62_400,
    dwellMs: null,
  },
};

const article: PulsePost = {
  id: "sample-article",
  xPostId: "1849921000000000002",
  type: "article",
  text: "The quiet math of attention. Why a launch thread can travel farther than the essay it exists to open, and how to read the difference.",
  publishedAt: "2026-09-16T15:12:00.000Z",
  metrics: {
    impressions: 410_550,
    likes: 6_400,
    replies: 410,
    reposts: 1_500,
    bookmarks: 7_200,
    profileClicks: 9_800,
    linkClicks: 4_100,
    detailExpands: 128_900,
    dwellMs: 252_000,
  },
};

const teaser: PulsePost = {
  id: "sample-teaser",
  xPostId: "1849921000000000003",
  type: "tweet",
  text: "Tomorrow I ship the notes I kept while building Keel. Not a growth thread. A reading.",
  publishedAt: "2026-09-15T09:10:00.000Z",
  metrics: {
    impressions: 186_400,
    likes: 2_140,
    replies: 96,
    reposts: 310,
    bookmarks: 880,
    profileClicks: 1_240,
    linkClicks: 40,
    detailExpands: 9_600,
    dwellMs: null,
  },
};

const follow: PulsePost = {
  id: "sample-follow",
  xPostId: "1849921000000000004",
  type: "tweet",
  text: "Two days later the thread is still traveling. The article is where people actually stay.",
  publishedAt: "2026-09-18T18:40:00.000Z",
  metrics: {
    impressions: 240_110,
    likes: 3_020,
    replies: 180,
    reposts: 640,
    bookmarks: 1_540,
    profileClicks: 2_110,
    linkClicks: 760,
    detailExpands: 18_450,
    dwellMs: null,
  },
};

export const sampleModel: PulseModel = {
  mode: "sample",
  creatorName: "Nico Hale",
  handle: "nicohale",
  posts: [thread, article, follow, teaser],
  heatmap: heat(),
  heatmapLabel: "Sample follower activity · weekday × hour, UTC",
  link: { articleId: article.id, threadId: thread.id },
};
