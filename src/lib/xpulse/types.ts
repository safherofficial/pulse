export type PostType =
  | "tweet"
  | "article"
  | "thread";

export type PostMetrics = {
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  bookmarks: number;
  profileClicks: number;
  linkClicks: number;
  /** Null when X did not report the field. */
  detailExpands: number | null;
  dwellMs: number | null;
};

export type PulsePost = {
  id: string;
  xPostId: string;
  type: PostType;
  text: string;
  metrics: PostMetrics;
  publishedAt: string;
  readings?: number;
};

export type PulseLink =
  | {
      articleId: string;
      threadId: string;
    }
  | null;

export type WritingSignals = {
  hook: number;
  clarity: number;
  curiosity: number;
  specificity: number;
  emotion: number;
  shareability: number;
  readability: number;
  structure: number;
};

export type PublicXMetrics = {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  bookmarks: number | null;
};

export type PublicXPost = {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  author: {
    name: string;
    handle: string;
  };
  metrics: PublicXMetrics;
  signals: WritingSignals;
  source: "fxtwitter" | "syndication";
};

export type CompareGap = {
  signal: keyof WritingSignals;
  label: string;
  viral: number;
  target: number;
  gap: number;
  advice: string;
};

export type MetricDeficit = {
  key: string;
  label: string;
  /** Raw reference value. Rates are 0–1, counts are absolute. */
  viral: number;
  target: number;
  viralDisplay: string;
  targetDisplay: string;
  note: string;
  /** 0–1, how far the post to improve sits behind the reference. */
  shortfall: number;
  unit: "rate" | "count";
};

export type PublicCompareResult = {
  viral: PublicXPost;
  target: PublicXPost;
  gaps: CompareGap[];
  deficits: MetricDeficit[];
};

export type AccessPlan =
  | "none"
  | "trial"
  | "lifetime";

export type PulseModel = {
  mode:
    | "sample"
    | "account";
  creatorName: string;
  handle: string | null;
  posts: PulsePost[];
  /** 7 weekdays (Mon–Sun) × 24 hours UTC, values 0–1. */
  heatmap: number[][];
  heatmapLabel: string;
  link: PulseLink;
  xApiLinked?: boolean;
};

export type BillingConfig = {
  priceSol: number;
  treasury: string;
  mainnetEnabled: boolean;
  devnetUnlocks: boolean;
  usingBuiltinTreasury: boolean;
};

export type WalletStatus = {
  address: string;

  plan: AccessPlan;

  active: boolean;

  isLifetime: boolean;

  trialStartedAt:
    | string
    | null;

  trialExpiresAt:
    | string
    | null;

  trialDaysRemaining:
    | number
    | null;

  cluster:
    | string
    | null;

  paidAt:
    | string
    | null;

  txSignature:
    | string
    | null;
};

export type Me = {
  displayName: string;
  xId: string | null;
  xUsername: string | null;
  xApiLinked: boolean;
  wallet:
    | WalletStatus
    | null;
};

export type Overview =
  | {
      locked: true;
    }
  | {
      locked: false;
      creatorName: string;
      handle: string | null;
      posts: PulsePost[];
      heatmap: number[][];
      heatmapLabel: string;
      link: PulseLink;
      xApiLinked: boolean;
    };

export type ImportInput = {
  xPostId: string;
  type: PostType;
  text: string;
  publishedAt: string;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  bookmarks: number;
  profileClicks: number;
  linkClicks: number;
  detailExpands: number;
  dwellMs: number | null;
};
