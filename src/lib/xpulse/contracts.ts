import { z } from "zod";

export const clusterSchema = z.enum(["mainnet-beta", "devnet"]);

export const postTypeSchema = z.enum(["tweet", "article", "thread"]);

const address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "That is not a Solana address");

export const connectWalletSchema = z.object({
  address,
  message: z.string().min(10).max(240),
  signature: z.string().min(20).max(200),
});

export const verifyPaymentSchema = z.object({
  address,
  signature: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,100}$/, "That is not a transaction signature"),
  cluster: clusterSchema,
});

const count = z.number().int().nonnegative().max(2_000_000_000);

export const importPostSchema = z.object({
  xPostId: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/, "Use a post id or a status URL"),
  type: postTypeSchema,
  text: z.string().trim().min(1).max(2000),
  publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
  impressions: count,
  likes: count,
  replies: count,
  reposts: count,
  bookmarks: count,
  profileClicks: count,
  linkClicks: count,
  detailExpands: count,
  dwellMs: z.number().int().nonnegative().max(86_400_000).nullable(),
});

export const linkSchema = z
  .object({
    articleId: z.string().min(1).max(80),
    threadId: z.string().min(1).max(80),
  })
  .refine((value) => value.articleId !== value.threadId, "Pick two different posts");

export const compareXUrlsSchema = z.object({
  viralUrl: z.string().trim().min(10).max(500),
  targetUrl: z.string().trim().min(10).max(500),
});

export const postIdSchema = z.object({
  id: z.string().min(1).max(80),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; message: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { ok: true, data: parsed.data };
}
