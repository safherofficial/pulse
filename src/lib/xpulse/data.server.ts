import { createHash, randomBytes } from "node:crypto";
import { setResponseHeader } from "@tanstack/react-start/server";
import * as nacl from "tweetnacl";

import { getSessionUser, getSessionWalletAddress } from "@/lib/auth/verify.server";
import { SESSION_TOKEN_COOKIE } from "@/lib/auth/server";
import { getSql } from "@/lib/db";

import {
  compareXUrlsSchema,
  connectWalletSchema,
  importPostSchema,
  linkSchema,
  parseInput,
  postIdSchema,
  verifyPaymentSchema
} from "./contracts";
import {
  BUILTIN_TREASURY,
  PRICE_USD,
  FALLBACK_PRICE_SOL,
  FALLBACK_PRICE_LAMPORTS,
  PRICE_USDC_BASE,
  USDC_MINT_MAINNET,
  USDC_MINT_DEVNET,
} from "./constants";
import {
  asMetrics,
  compareMetricDeficits,
  comparePublicPosts,
  emptyHeatmap,
  inferHeatmap,
  writingSignals
} from "./metrics";
import {
  assessTransfer,
  fromRpcResult
} from "./solana";
import type {
  BillingConfig,
  ImportInput,
  Me,
  Overview,
  PostMetrics,
  PostType,
  PublicCompareResult,
  PublicXPost,
  PulsePost,
  WalletStatus
} from "./types";
import { extractPublicXPostId, PublicXError, resolvePublicXPost } from "./x-public";

export class PulseError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "PulseError";
    this.code = code;
  }
}

type AccessPlan =
  | "none"
  | "trial"
  | "lifetime";

type WalletAccess = {
  address: string;
  plan: AccessPlan;
  active: boolean;
  isLifetime: boolean;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  trialDaysRemaining: number | null;
  cluster: string | null;
  paidAt: string | null;
  txSignature: string | null;
};

type ProfileRow = {
  x_id: string | null;
  x_username: string | null;
  x_access_token: string | null;
  x_refresh_token: string | null;
  x_token_expires_at: unknown;
};

type PostRow = {
  id: string;
  x_post_id: string;
  type: string;
  text: string;
  metrics: unknown;
  published_at: unknown;
};

const buckets = new Map<
  string,
  { n: number; reset: number }
>();

function limit(
  userId: string,
  bucket: string,
  cap: number
) {
  const key = `${userId}:${bucket}`;
  const now = Date.now();
  const row = buckets.get(key);

  if (!row || now > row.reset) {
    buckets.set(key, {
      n: 1,
      reset: now + 60_000
    });
    return;
  }

  if (row.n >= cap) {
    throw new PulseError(
      "Too many requests. Wait a minute and try again.",
      "RATE_LIMITED"
    );
  }

  row.n += 1;
}

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>
) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...extra
    })
  );
}

function iso(
  value: unknown
): string | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(
    String(value)
  );

  return Number.isNaN(
    date.getTime()
  )
    ? String(value)
    : date.toISOString();
}

function fail(error: unknown): never {
  if (error instanceof PulseError) {
    throw error;
  }

  log("error", "unexpected XPulse error", {
    message:
      error instanceof Error
        ? error.message
        : String(error)
  });

  throw new PulseError(
    "Unexpected server error.",
    "INTERNAL_ERROR"
  );
}

function randomHex(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

function shortWallet(address: string) {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function liveSolQuote(): Promise<{ priceSol: number; priceLamports: number; solUsd: number; source: string }> {
  try {
    const { resolveSolUsd } = await import("./public-apis");
    const quote = await resolveSolUsd();
    const priceSol = PRICE_USD / quote.usd;
    const priceLamports = Math.max(1, Math.ceil(priceSol * 1_000_000_000));
    return { priceSol, priceLamports, solUsd: quote.usd, source: quote.source };
  } catch {
    return {
      priceSol: FALLBACK_PRICE_SOL,
      priceLamports: FALLBACK_PRICE_LAMPORTS,
      solUsd: PRICE_USD / FALLBACK_PRICE_SOL,
      source: "fallback",
    };
  }
}

export function billingConfig(): BillingConfig {
  const envTreasury =
    process.env.SOLANA_TREASURY_ADDRESS?.trim() || "";

  return {
    priceUsd: PRICE_USD,
    priceSol: FALLBACK_PRICE_SOL,
    priceLamports: FALLBACK_PRICE_LAMPORTS,
    priceUsdc: PRICE_USD,
    priceUsdcBase: PRICE_USDC_BASE,
    solUsd: PRICE_USD / FALLBACK_PRICE_SOL,
    solUsdSource: "fallback",
    usdcMint: USDC_MINT_MAINNET,
    treasury:
      envTreasury || BUILTIN_TREASURY,
    mainnetEnabled:
      Boolean(envTreasury),
    devnetUnlocks:
      process.env.SOLANA_ALLOW_DEVNET_LIFETIME ===
      "true",
    usingBuiltinTreasury:
      !envTreasury
  };
}

export async function billingConfigLive(): Promise<BillingConfig> {
  const base = billingConfig();
  const quote = await liveSolQuote();
  return {
    ...base,
    priceSol: Number(quote.priceSol.toFixed(6)),
    priceLamports: quote.priceLamports,
    solUsd: quote.solUsd,
    solUsdSource: quote.source,
    usdcMint: USDC_MINT_MAINNET,
  };
}

function treasuryFor(
  cluster:
    | "mainnet-beta"
    | "devnet"
): string {
  const envTreasury =
    process.env.SOLANA_TREASURY_ADDRESS?.trim() || "";

  if (envTreasury) {
    return envTreasury;
  }

  if (cluster === "devnet") {
    return BUILTIN_TREASURY;
  }

  throw new PulseError(
    "Mainnet treasury is not configured for this deployment.",
    "PAYMENT_NOT_CONFIGURED"
  );
}

function rpcUrl(
  cluster:
    | "mainnet-beta"
    | "devnet"
): string {
  if (cluster === "devnet") {
    return (
      process.env.SOLANA_DEVNET_RPC?.trim() ||
      "https://api.devnet.solana.com"
    );
  }

  return (
    process.env.SOLANA_MAINNET_RPC?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

async function ensureProfile(
  userId: string
) {
  const sql = await getSql();

  await sql`
    insert into xpulse_profiles (
      user_id
    )
    values (
      ${userId}
    )
    on conflict (user_id)
    do nothing
  `;
}

async function displayName(
  userId: string
): Promise<string> {
  const sql = await getSql();

  const rows =
    await sql<{ name: string }>`
      select "name"
      from "user"
      where "id" = ${userId}
      limit 1
    `;

  return rows[0]?.name || "Creator";
}

async function profileFor(
  userId: string
): Promise<ProfileRow | null> {
  const sql = await getSql();

  const rows =
    await sql<ProfileRow>`
      select
        x_id,
        x_username,
        x_access_token,
        x_refresh_token,
        x_token_expires_at
      from xpulse_profiles
      where user_id = ${userId}
      limit 1
    `;

  return rows[0] ?? null;
}

async function walletStatus(
  userId: string,
  address: string
): Promise<WalletAccess | null> {
  const sql = await getSql();

  const rows =
    await sql<{
      address: string;
      plan: string | null;
      is_lifetime: boolean;
      trial_started_at: unknown;
      trial_expires_at: unknown;
      paid_at: unknown;
      tx_signature: string | null;
      cluster: string | null;
    }>`
      select
        address,
        plan,
        is_lifetime,
        trial_started_at,
        trial_expires_at,
        paid_at,
        tx_signature,
        cluster
      from xpulse_wallets
      where user_id = ${userId}
        and address = ${address}
      limit 1
    `;

  const row = rows[0];

  if (!row) {
    return null;
  }

  const lifetime =
    Boolean(row.is_lifetime) ||
    row.plan === "lifetime";

  const trialExpires =
    row.trial_expires_at
      ? new Date(
          String(
            row.trial_expires_at
          )
        )
      : null;

  const trialActive =
    !lifetime &&
    row.plan === "trial" &&
    trialExpires !== null &&
    trialExpires.getTime() >
      Date.now();

  const plan: AccessPlan =
    lifetime
      ? "lifetime"
      : row.plan === "trial"
        ? "trial"
        : "none";

  const active =
    lifetime || trialActive;

  const trialDaysRemaining =
    trialActive && trialExpires
      ? Math.max(
          1,
          Math.ceil(
            (trialExpires.getTime() -
              Date.now()) /
              86_400_000
          )
        )
      : null;

  return {
    address: row.address,
    plan,
    active,
    isLifetime: lifetime,
    trialStartedAt: iso(
      row.trial_started_at
    ),
    trialExpiresAt: iso(
      row.trial_expires_at
    ),
    trialDaysRemaining,
    cluster: row.cluster,
    paidAt: iso(row.paid_at),
    txSignature:
      row.tx_signature
  };
}

async function ensureTrialAccess(
  userId: string,
  address: string
) {
  const sql = await getSql();

  await sql`
    update xpulse_wallets
    set
      plan = 'trial',
      trial_started_at = now(),
      trial_expires_at = now() + interval '7 days',
      updated_at = now()
    where user_id = ${userId}
      and address = ${address}
      and is_lifetime = false
      and trial_started_at is null
      and (plan is null or plan = 'none')
  `;
}

async function currentWalletStatus(
  userId: string
) {
  const address =
    await getSessionWalletAddress(
      userId
    );

  if (!address) {
    return null;
  }

  await ensureTrialAccess(userId, address);

  return walletStatus(
    userId,
    address
  );
}

async function userOwnsAddress(
  userId: string,
  address: string
) {
  const sql = await getSql();

  const rows =
    await sql<{
      user_id: string;
      is_lifetime: boolean;
      plan: string | null;
    }>`
      select
        user_id,
        is_lifetime,
        plan
      from xpulse_wallets
      where address = ${address}
      limit 1
    `;

  const row = rows[0];

  if (
    row &&
    row.user_id !== userId
  ) {
    throw new PulseError(
      "That wallet belongs to another XPulse Chamber.",
      "WALLET_OWNED"
    );
  }

  return row ?? null;
}

async function requireOpen(
  userId: string
) {
  const wallet =
    await currentWalletStatus(
      userId
    );

  if (!wallet?.active) {
    throw new PulseError(
      "Active XPulse Pro access is required.",
      "PAYMENT_REQUIRED"
    );
  }

  return wallet;
}

export async function runMe(
  userId: string
): Promise<Me> {
  try {
    limit(userId, "read", 80);
    await ensureProfile(userId);

    const profile =
      await profileFor(userId);
    const wallet =
      await currentWalletStatus(
        userId
      );

    return {
      displayName:
        await displayName(userId),
      xId:
        profile?.x_id ?? null,
      xUsername:
        profile?.x_username ?? null,
      xApiLinked:
        Boolean(
          profile?.x_access_token
        ),
      wallet:
        wallet as unknown as
          WalletStatus | null
    };
  } catch (error) {
    return fail(error);
  }
}

function bindMessage(
  userId: string,
  nonce: string
) {
  return `XPulse bind\n${userId}\n${nonce}`;
}

export async function runIssueNonce(
  userId: string
) {
  try {
    limit(userId, "nonce", 12);
    await ensureProfile(userId);

    const sql = await getSql();
    const nonce = randomHex(16);
    const id = randomHex(16);

    await sql`
      delete from xpulse_nonces
      where user_id = ${userId}
         or expires_at < now()
    `;

    await sql`
      insert into xpulse_nonces (
        id,
        user_id,
        nonce,
        expires_at
      )
      values (
        ${id},
        ${userId},
        ${nonce},
        now() + interval '10 minutes'
      )
    `;

    return {
      ok: true as const,
      message:
        bindMessage(
          userId,
          nonce
        )
    };
  } catch (error) {
    return fail(error);
  }
}

async function verifyWalletSignature(
  message: string,
  signatureB64: string,
  address: string
) {
  const { PublicKey } =
    await import(
      "@solana/web3.js"
    );

  let publicKey: Uint8Array;

  try {
    publicKey =
      new PublicKey(address).toBytes();
  } catch {
    throw new PulseError(
      "That is not a Solana address."
    );
  }

  let signature: Uint8Array;

  try {
    signature = new Uint8Array(
      Buffer.from(
        signatureB64,
        "base64"
      )
    );
  } catch {
    throw new PulseError(
      "The wallet signature could not be read."
    );
  }

  if (signature.length !== 64) {
    throw new PulseError(
      "The wallet signature could not be read."
    );
  }

  const ok =
    nacl.sign.detached.verify(
      new TextEncoder().encode(
        message
      ),
      signature,
      publicKey
    );

  if (!ok) {
    throw new PulseError(
      "The wallet signature does not match this account."
    );
  }
}

export async function runConnectWallet(
  userId: string,
  input: unknown
) {
  try {
    limit(userId, "wallet", 12);

    const parsed = parseInput(
      connectWalletSchema,
      input
    );

    if (!parsed.ok) {
      return parsed;
    }

    const {
      address,
      message,
      signature
    } = parsed.data;

    const parts =
      message.split("\n");

    if (
      parts.length !== 3 ||
      parts[0] !== "XPulse bind" ||
      parts[1] !== userId ||
      !parts[2]
    ) {
      throw new PulseError(
        "That signature was not issued for this account."
      );
    }

    const nonce = parts[2];
    const sql = await getSql();

    const rows =
      await sql<{ nonce: string }>`
        select nonce
        from xpulse_nonces
        where user_id = ${userId}
          and nonce = ${nonce}
          and expires_at > now()
        limit 1
      `;

    if (!rows[0]) {
      throw new PulseError(
        "That signature expired. Connect the wallet again."
      );
    }

    if (
      message !==
      bindMessage(userId, nonce)
    ) {
      throw new PulseError(
        "That signature was not issued for this account."
      );
    }

    await verifyWalletSignature(
      message,
      signature,
      address
    );

    await userOwnsAddress(
      userId,
      address
    );

    await sql`
      delete from xpulse_nonces
      where user_id = ${userId}
        and nonce = ${nonce}
    `;

    await ensureProfile(userId);

    await sql`
      insert into xpulse_wallets (
        address,
        user_id,
        is_lifetime
      )
      values (
        ${address},
        ${userId},
        false
      )
      on conflict (address)
      do nothing
    `;

    const wallet =
      await walletStatus(
        userId,
        address
      );

    log("info", "wallet linked", {
      userId,
      address
    });

    return {
      ok: true as const,
      isLifetime:
        Boolean(
          wallet?.isLifetime
        ),
      message: "Wallet linked."
    };
  } catch (error) {
    return fail(error);
  }
}

async function fetchTransaction(
  cluster:
    | "mainnet-beta"
    | "devnet",
  signature: string
) {
  let last =
    "Solana RPC did not return the transaction.";

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    try {
      const response =
        await fetch(
          rpcUrl(cluster),
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json"
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method:
                "getTransaction",
              params: [
                signature,
                {
                  encoding:
                    "jsonParsed",
                  maxSupportedTransactionVersion:
                    0,
                  commitment:
                    "confirmed"
                }
              ]
            }),
            signal:
              AbortSignal.timeout(
                12_000
              )
          }
        );

      const body =
        (await response.json()) as {
          result?: unknown;
          error?: {
            message?: string;
          };
        };

      if (body.error) {
        last =
          body.error.message ||
          last;
      } else if (
        body.result
      ) {
        return body.result;
      } else {
        last =
          "Transaction not found yet. Wait for confirmation and retry.";
      }
    } catch (error) {
      last =
        error instanceof Error
          ? error.message
          : last;
    }

    await new Promise<void>(
      (resolve) =>
        setTimeout(resolve, 450)
    );
  }

  throw new PulseError(last);
}

export async function runVerifyPayment(
  userId: string,
  input: unknown
) {
  try {
    limit(userId, "verify", 8);

    const parsed = parseInput(
      verifyPaymentSchema,
      input
    );

    if (!parsed.ok) {
      return {
        ...parsed,
        lifetime: false as const
      };
    }

    const {
      address,
      signature,
      cluster
    } = parsed.data;

    const sessionWallet =
      await getSessionWalletAddress(
        userId
      );

    if (!sessionWallet) {
      throw new PulseError(
        "Your wallet session is missing. Sign in again.",
        "SESSION_WALLET_MISSING"
      );
    }

    if (
      sessionWallet !== address
    ) {
      throw new PulseError(
        "The paying wallet must be the wallet signed in to XPulse.",
        "WALLET_MISMATCH"
      );
    }

    const treasury =
      treasuryFor(cluster);
    const sql = await getSql();

    await userOwnsAddress(
      userId,
      address
    );

    const existing =
      await sql<{
        address: string;
        user_id: string;
        is_lifetime: boolean;
      }>`
        select
          address,
          user_id,
          is_lifetime
        from xpulse_wallets
        where tx_signature = ${signature}
        limit 1
      `;

    if (
      existing[0] &&
      existing[0].address !== address
    ) {
      throw new PulseError(
        "That transaction was already used."
      );
    }

    if (
      existing[0]?.address ===
        address &&
      existing[0].is_lifetime &&
      existing[0].user_id ===
        userId
    ) {
      return {
        ok: true as const,
        lifetime: true as const,
        message:
          "This wallet is already unlocked."
      };
    }

    const result =
      await fetchTransaction(
        cluster,
        signature
      );

    const tx =
      fromRpcResult(result);

    if (!tx) {
      throw new PulseError(
        "Could not read that transaction."
      );
    }

    const quote = await liveSolQuote();
    // 3% tolerance for SOL price drift between client quote and server verify
    const minLamports = Math.floor(quote.priceLamports * 0.97);

    const solVerdict =
      assessTransfer(tx, {
        treasury,
        payer: address,
        minLamports,
      });

    let verdict: { ok: true; lamports: number } | { ok: false; reason: string } = solVerdict;
    if (!solVerdict.ok) {
      const { assessUsdcTransfer } = await import("./solana");
      const usdcVerdict = assessUsdcTransfer(result, {
        treasury,
        payer: address,
        mint: cluster === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET,
        minBaseUnits: Math.floor(PRICE_USDC_BASE * 0.99),
      });
      if (usdcVerdict.ok) {
        verdict = { ok: true, lamports: 0 };
      } else {
        verdict = {
          ok: false,
          reason: solVerdict.reason + " Also checked USDC: " + usdcVerdict.reason,
        };
      }
    }

    if (!verdict.ok) {
      throw new PulseError(
        verdict.reason,
        "PAYMENT_INVALID"
      );
    }

    const unlock =
      cluster ===
        "mainnet-beta" ||
      (cluster === "devnet" &&
        process.env
          .SOLANA_ALLOW_DEVNET_LIFETIME ===
          "true");

    await ensureProfile(userId);

    if (!unlock) {
      log(
        "info",
        "devnet payment seen, lifetime withheld",
        {
          userId,
          address,
          signature
        }
      );

      return {
        ok: true as const,
        lifetime: false as const,
        message:
          "Transaction confirmed on devnet. Lifetime is granted for a mainnet payment of $10 (SOL or USDC)."
      };
    }

    await sql`
      insert into xpulse_wallets (
        address,
        user_id,
        is_lifetime,
        plan,
        paid_at,
        tx_signature,
        cluster
      )
      values (
        ${address},
        ${userId},
        true,
        'lifetime',
        now(),
        ${signature},
        ${cluster}
      )
      on conflict (address)
      do update set
        is_lifetime = true,
        plan = 'lifetime',
        paid_at = coalesce(
          xpulse_wallets.paid_at,
          now()
        ),
        tx_signature = coalesce(
          xpulse_wallets.tx_signature,
          excluded.tx_signature
        ),
        cluster = case
          when xpulse_wallets.is_lifetime
            then xpulse_wallets.cluster
          else excluded.cluster
        end,
        updated_at = now()
    `;

    log("info", "lifetime granted", {
      userId,
      address,
      cluster,
      lamports:
        verdict.lamports
    });

    return {
      ok: true as const,
      lifetime: true as const,
      message:
        cluster === "devnet"
          ? "Devnet payment confirmed. This wallet is unlocked."
          : "Payment confirmed. Lifetime access is on."
    };
  } catch (error) {
    log("warn", "payment verify failed", {
      userId,
      message:
        error instanceof Error
          ? error.message
          : "error"
    });

    if (error instanceof PulseError) {
      return {
        ok: false as const,
        lifetime: false as const,
        message: error.message
      };
    }

    return {
      ok: false as const,
      lifetime: false as const,
      message:
        "Unexpected payment verification error."
    };
  }
}

function metricsJson(
  metrics: PostMetrics
) {
  return JSON.stringify(metrics);
}

function toPost(
  row: PostRow,
  readings = 0
): PulsePost {
  const type: PostType =
    row.type === "article" ||
    row.type === "thread"
      ? row.type
      : "tweet";

  return {
    id: row.id,
    xPostId:
      row.x_post_id,
    type,
    text: row.text,
    metrics:
      asMetrics(row.metrics),
    publishedAt:
      iso(row.published_at) ??
      new Date(0).toISOString(),
    readings
  };
}

async function loadPosts(
  userId: string
): Promise<PulsePost[]> {
  const sql = await getSql();

  const rows =
    await sql<PostRow>`
      select
        id,
        x_post_id,
        type,
        text,
        metrics,
        published_at
      from xpulse_posts
      where user_id = ${userId}
      order by
        published_at desc
    `;

  const counts =
    await sql<{
      post_id: string;
      n: number;
    }>`
      select
        post_id,
        count(*)::int as n
      from xpulse_snapshots
      where user_id = ${userId}
      group by post_id
    `;

  const byId =
    new Map(
      counts.map(
        (row) => [
          row.post_id,
          Number(row.n)
        ]
      )
    );

  return rows.map(
    (row) =>
      toPost(
        row,
        byId.get(row.id) ?? 0
      )
  );
}

async function loadHeat(
  userId: string,
  posts: PulsePost[]
) {
  const sql = await getSql();

  const rows =
    await sql<{
      dow: number;
      hour: number;
      intensity: number;
    }>`
      select
        dow,
        hour,
        intensity
      from xpulse_activity
      where user_id = ${userId}
    `;

  if (rows.length === 0) {
    return {
      heatmap:
        posts.length
          ? inferHeatmap(posts)
          : emptyHeatmap(),
      heatmapLabel:
        "Inferred from publish time × opens. X does not provide an hourly follower clock."
    };
  }

  const heatmap =
    emptyHeatmap();

  for (const row of rows) {
    const line =
      heatmap[Number(row.dow)];

    if (!line) continue;

    const value =
      typeof row.intensity ===
      "number"
        ? row.intensity
        : Number(row.intensity);

    line[Number(row.hour)] =
      Number.isFinite(value)
        ? Math.max(
            0,
            Math.min(1, value)
          )
        : 0;
  }

  return {
    heatmap,
    heatmapLabel:
      "Inferred from publish time × opens. X does not provide an hourly follower clock."
  };
}

async function saveHeat(
  userId: string,
  posts: PulsePost[]
) {
  const grid =
    inferHeatmap(posts);
  const sql = await getSql();

  await sql`
    delete from xpulse_activity
    where user_id = ${userId}
  `;

  const values: unknown[] = [];
  const chunks: string[] = [];

  grid.forEach(
    (row, day) => {
      row.forEach(
        (value, hour) => {
          if (value <= 0) return;

          const index =
            values.length;

          chunks.push(
            `($${index + 1}, $${index + 2}, $${index + 3}, $${index + 4})`
          );

          values.push(
            userId,
            day,
            hour,
            value
          );
        }
      );
    }
  );

  if (!chunks.length) return;

  await sql.query(
    `insert into xpulse_activity (user_id, dow, hour, intensity) values ${chunks.join(",")}`,
    values
  );
}

export async function runOverview(
  userId: string
): Promise<Overview> {
  try {
    limit(userId, "read", 80);

    const wallet =
      await currentWalletStatus(
        userId
      );

    if (!wallet?.active) {
      return {
        locked: true
      };
    }

    await ensureProfile(userId);

    const sql = await getSql();

    const [
      posts,
      profile,
      linkRows
    ] = await Promise.all([
      loadPosts(userId),
      sql<ProfileRow>`
        select
          x_id,
          x_username,
          x_access_token,
          x_refresh_token,
          x_token_expires_at
        from xpulse_profiles
        where user_id = ${userId}
        limit 1
      `,
      sql<{
        article_post_id: string;
        thread_post_id: string;
      }>`
        select
          article_post_id,
          thread_post_id
        from xpulse_links
        where user_id = ${userId}
        limit 1
      `
    ]);

    const heat =
      await loadHeat(
        userId,
        posts
      );

    return {
      locked: false,
      creatorName:
        await displayName(userId),
      handle:
        profile[0]
          ?.x_username ??
        null,
      posts,
      heatmap:
        heat.heatmap,
      heatmapLabel:
        heat.heatmapLabel,
      link:
        linkRows[0]
          ? {
              articleId:
                linkRows[0]
                  .article_post_id,
              threadId:
                linkRows[0]
                  .thread_post_id
            }
          : null,
      xApiLinked:
        Boolean(
          profile[0]
            ?.x_access_token
        )
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runHeatmap(
  userId: string
) {
  const overview =
    await runOverview(userId);

  if (overview.locked) {
    return {
      locked: true as const
    };
  }

  return {
    locked: false as const,
    heatmap:
      overview.heatmap,
    label:
      overview.heatmapLabel
  };
}

export async function runPost(
  userId: string,
  input: unknown
) {
  try {
    limit(userId, "read", 80);
    await requireOpen(userId);

    const parsed = parseInput(
      postIdSchema,
      input
    );

    if (!parsed.ok) {
      return parsed;
    }

    const sql = await getSql();

    const rows =
      await sql<PostRow>`
        select
          id,
          x_post_id,
          type,
          text,
          metrics,
          published_at
        from xpulse_posts
        where user_id = ${userId}
          and id = ${parsed.data.id}
        limit 1
      `;

    const row = rows[0];

    if (!row) {
      return {
        ok: false as const,
        message: "Post not found."
      };
    }

    const snaps =
      await sql<{
        captured_at: unknown;
        metrics: unknown;
      }>`
        select
          captured_at,
          metrics
        from xpulse_snapshots
        where user_id = ${userId}
          and post_id = ${row.id}
        order by
          captured_at desc
        limit 24
      `;

    return {
      ok: true as const,
      post: toPost(
        row,
        snaps.length
      ),
      snapshots:
        snaps.map(
          (snap) => ({
            capturedAt:
              iso(
                snap.captured_at
              ) ?? "",
            metrics:
              asMetrics(
                snap.metrics
              )
          })
        )
    };
  } catch (error) {
    return fail(error);
  }
}

async function snapshot(
  userId: string,
  postId: string,
  metrics: PostMetrics
) {
  const sql = await getSql();

  await sql`
    insert into xpulse_snapshots (
      id,
      user_id,
      post_id,
      metrics
    )
    values (
      ${randomHex(16)},
      ${userId},
      ${postId},
      ${metricsJson(metrics)}::jsonb
    )
  `;
}

function metricsFromImport(
  input: ImportInput
): PostMetrics {
  return {
    impressions:
      input.impressions,
    likes: input.likes,
    replies: input.replies,
    reposts: input.reposts,
    bookmarks:
      input.bookmarks,
    profileClicks:
      input.profileClicks,
    linkClicks:
      input.linkClicks,
    detailExpands:
      input.detailExpands,
    dwellMs: input.dwellMs
  };
}

export async function runImport(
  userId: string,
  input: unknown
) {
  try {
    limit(userId, "import", 30);
    await requireOpen(userId);

    const parsed = parseInput(
      importPostSchema,
      input
    );

    if (!parsed.ok) {
      return parsed;
    }

    const metrics =
      metricsFromImport(
        parsed.data
      );

    const sql = await getSql();

    const rows =
      await sql<{ id: string }>`
        insert into xpulse_posts (
          id,
          user_id,
          x_post_id,
          type,
          text,
          metrics,
          published_at
        )
        values (
          ${randomHex(16)},
          ${userId},
          ${parsed.data.xPostId},
          ${parsed.data.type},
          ${parsed.data.text},
          ${metricsJson(metrics)}::jsonb,
          ${new Date(
            parsed.data.publishedAt
          ).toISOString()}
        )
        on conflict (
          user_id,
          x_post_id
        )
        do update set
          type =
            excluded.type,
          text =
            excluded.text,
          metrics =
            excluded.metrics,
          published_at =
            excluded.published_at
        returning id
      `;

    const postId =
      rows[0]?.id;

    if (!postId) {
      throw new PulseError(
        "Could not save the post."
      );
    }

    await snapshot(
      userId,
      postId,
      metrics
    );

    await saveHeat(
      userId,
      await loadPosts(userId)
    );

    return {
      ok: true as const,
      id: postId,
      message: "Reading saved."
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runLink(
  userId: string,
  input: unknown
) {
  try {
    await requireOpen(userId);

    const parsed = parseInput(
      linkSchema,
      input
    );

    if (!parsed.ok) {
      return parsed;
    }

    const sql = await getSql();

    const [
      articleRows,
      threadRows
    ] = await Promise.all([
      sql<PostRow>`
        select
          id,
          x_post_id,
          type,
          text,
          metrics,
          published_at
        from xpulse_posts
        where user_id = ${userId}
          and id = ${parsed.data.articleId}
        limit 1
      `,
      sql<PostRow>`
        select
          id,
          x_post_id,
          type,
          text,
          metrics,
          published_at
        from xpulse_posts
        where user_id = ${userId}
          and id = ${parsed.data.threadId}
        limit 1
      `
    ]);

    const article =
      articleRows[0];
    const thread =
      threadRows[0];

    if (!article) {
      throw new PulseError(
        "Article post not found."
      );
    }

    if (!thread) {
      throw new PulseError(
        "Thread post not found."
      );
    }

    if (
      article.type !== "article"
    ) {
      throw new PulseError(
        "The article side has to be an article."
      );
    }

    if (
      thread.type !== "thread"
    ) {
      throw new PulseError(
        "The thread side has to be a thread."
      );
    }

    await sql`
      delete from xpulse_links
      where user_id = ${userId}
    `;

    await sql`
      insert into xpulse_links (
        id,
        user_id,
        article_post_id,
        thread_post_id
      )
      values (
        ${randomHex(16)},
        ${userId},
        ${article.id},
        ${thread.id}
      )
    `;

    return {
      ok: true as const,
      message:
        "Thread linked to the article."
    };
  } catch (error) {
    return fail(error);
  }
}

function xClient() {
  const clientId =
    process.env.X_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.X_CLIENT_SECRET?.trim() ||
    "";

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret
  };
}

function redirectUri(
  request: Request
) {
  return (
    process.env.X_REDIRECT_URI?.trim() ||
    `${new URL(request.url).origin}/api/x/callback`
  );
}

async function accessToken(
  userId: string
) {
  const profile =
    await profileFor(userId);

  if (!profile?.x_access_token) {
    throw new PulseError(
      "Connect an X account first.",
      "X_NOT_CONNECTED"
    );
  }

  if (
    profile.x_refresh_token &&
    profile.x_token_expires_at &&
    new Date(
      String(
        profile.x_token_expires_at
      )
    ).getTime() <=
      Date.now() + 60_000
  ) {
    const client = xClient();

    if (client) {
      const body =
        new URLSearchParams({
          refresh_token:
            profile.x_refresh_token,
          grant_type:
            "refresh_token",
          client_id:
            client.clientId
        });

      const basic = Buffer.from(
        `${client.clientId}:${client.clientSecret}`
      ).toString("base64");

      const response =
        await fetch(
          "https://api.x.com/2/oauth2/token",
          {
            method: "POST",
            headers: {
              authorization:
                `Basic ${basic}`,
              "content-type":
                "application/x-www-form-urlencoded"
            },
            body
          }
        );

      if (response.ok) {
        const token =
          (await response.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
          };

        if (token.access_token) {
          const sql =
            await getSql();

          await sql`
            update xpulse_profiles
            set
              x_access_token = ${token.access_token},
              x_refresh_token = ${token.refresh_token || profile.x_refresh_token},
              x_token_expires_at = ${token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null},
              updated_at = now()
            where user_id = ${userId}
          `;

          return token.access_token;
        }
      }
    }
  }

  return profile.x_access_token;
}

export async function runBeginX(
  userId: string
) {
  try {
    limit(userId, "x-oauth", 8);

    const client = xClient();

    if (!client) {
      return {
        ok: false as const,
        message:
          "X API credentials are not configured. You can still import posts by id."
      };
    }

    const {
      getRequest
    } = await import(
      "@tanstack/react-start/server"
    );

    const request = getRequest();

    if (!request) {
      throw new PulseError(
        "Missing request."
      );
    }

    const verifier =
      randomBytes(32).toString(
        "base64url"
      );

    const challenge =
      createHash("sha256")
        .update(verifier)
        .digest("base64url");

    const state = randomHex(16);
    const redirect = redirectUri(request);
    const sql = await getSql();

    await sql`
      delete from xpulse_oauth
      where user_id = ${userId}
         or expires_at < now()
    `;

    await sql`
      insert into xpulse_oauth (
        state,
        user_id,
        verifier,
        redirect_uri,
        expires_at
      )
      values (
        ${state},
        ${userId},
        ${verifier},
        ${redirect},
        now() + interval '15 minutes'
      )
    `;

    const params =
      new URLSearchParams({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: redirect,
        scope:
          "tweet.read users.read offline.access",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

    return {
      ok: true as const,
      url:
        `https://twitter.com/i/oauth2/authorize?${params.toString()}`
    };
  } catch (error) {
    return fail(error);
  }
}

async function exchangeXCode(
  code: string,
  verifier: string,
  redirect: string
) {
  const client = xClient();

  if (!client) {
    throw new PulseError(
      "X API credentials are not configured.",
      "X_NOT_CONFIGURED"
    );
  }

  const body =
    new URLSearchParams({
      code,
      grant_type:
        "authorization_code",
      client_id: client.clientId,
      redirect_uri: redirect,
      code_verifier: verifier
    });

  const basic = Buffer.from(
    `${client.clientId}:${client.clientSecret}`
  ).toString("base64");

  const response =
    await fetch(
      "https://api.x.com/2/oauth2/token",
      {
        method: "POST",
        headers: {
          authorization:
            `Basic ${basic}`,
          "content-type":
            "application/x-www-form-urlencoded"
        },
        body
      }
    );

  if (!response.ok) {
    const bodyText =
      await response.text();

    throw new PulseError(
      `X token exchange failed (${response.status}): ${bodyText.slice(0, 160)}`,
      "X_TOKEN_EXCHANGE"
    );
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

export async function handleXCallback(
  request: Request
) {
  const url = new URL(
    request.url
  );

  const back = (
    reason: string
  ) =>
    new Response(null, {
      status: 302,
      headers: {
        location:
          `/onboard?x=error&reason=${encodeURIComponent(reason)}`
      }
    });

  const code =
    url.searchParams.get("code");
  const state =
    url.searchParams.get("state");

  if (!code || !state) {
    return back("missing_code");
  }

  const session =
    await getSessionUser();

  if (!session) {
    return back("session");
  }

  try {
    const sql = await getSql();

    const rows =
      await sql<{
        user_id: string;
        verifier: string;
        redirect_uri: string;
      }>`
        select
          user_id,
          verifier,
          redirect_uri
        from xpulse_oauth
        where state = ${state}
          and expires_at > now()
        limit 1
      `;

    const row = rows[0];

    if (
      !row ||
      row.user_id !== session.id
    ) {
      return back("state");
    }

    await sql`
      delete from xpulse_oauth
      where state = ${state}
    `;

    const token =
      await exchangeXCode(
        code,
        row.verifier,
        row.redirect_uri
      );

    const meResponse =
      await fetch(
        "https://api.x.com/2/users/me?user.fields=id,name,username",
        {
          headers: {
            authorization:
              `Bearer ${token.access_token}`
          },
          cache: "no-store"
        }
      );

    if (!meResponse.ok) {
      return back("x_profile");
    }

    const payload =
      (await meResponse.json()) as {
        data?: {
          id?: string;
          username?: string;
        };
      };

    const x = payload.data;

    if (!x?.id) {
      return back("x_profile");
    }

    await ensureProfile(
      session.id
    );

    await sql`
      update xpulse_profiles
      set
        x_id = ${x.id},
        x_username = ${x.username || null},
        x_access_token = ${token.access_token},
        x_refresh_token = ${token.refresh_token || null},
        x_token_expires_at = ${token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null},
        updated_at = now()
      where user_id = ${session.id}
    `;

    return new Response(null, {
      status: 302,
      headers: {
        location:
          "/onboard?x=linked"
      }
    });
  } catch (error) {
    log("warn", "X callback failed", {
      message:
        error instanceof Error
          ? error.message
          : String(error)
    });

    return back(
      error instanceof PulseError
        ? error.code.toLowerCase()
        : "callback"
    );
  }
}

function metricsFromTweet(
  tweet: any
): PostMetrics {
  const publicMetrics =
    tweet?.public_metrics || {};
  const nonPublic =
    tweet?.non_public_metrics || {};
  const organic =
    tweet?.organic_metrics || {};

  const all = {
    ...publicMetrics,
    ...nonPublic,
    ...organic
  };

  return {
    impressions:
      Number(
        all.impression_count || 0
      ),
    likes:
      Number(
        all.like_count || 0
      ),
    replies:
      Number(
        all.reply_count || 0
      ),
    reposts:
      Number(
        all.retweet_count || 0
      ),
    bookmarks:
      Number(
        all.bookmark_count || 0
      ),
    profileClicks:
      Number(
        all.user_profile_clicks || 0
      ),
    linkClicks:
      Number(
        all.url_link_clicks || 0
      ),
    detailExpands:
      all.detail_expands ===
      undefined
        ? null
        : Number(
            all.detail_expands
          ),
    dwellMs:
      all.dwell_time_ms ===
      undefined
        ? null
        : Number(
            all.dwell_time_ms
          )
  };
}

function tweetText(
  tweet: any
) {
  return String(
    tweet?.text ||
      tweet?.note_tweet?.text ||
      ""
  );
}

function tweetType(
  tweet: any
): PostType {
  const text = tweetText(
    tweet
  );

  if (
    text.includes("\n1/") ||
    /\b1\/\d+/.test(text)
  ) {
    return "thread";
  }

  return "tweet";
}

async function saveXPost(
  userId: string,
  tweet: any
) {
  const metrics =
    metricsFromTweet(tweet);
  const sql = await getSql();
  const xPostId = String(
    tweet?.id || ""
  );

  if (!xPostId) return null;

  const rows =
    await sql<{ id: string }>`
      insert into xpulse_posts (
        id,
        user_id,
        x_post_id,
        type,
        text,
        metrics,
        published_at
      )
      values (
        ${randomHex(16)},
        ${userId},
        ${xPostId},
        ${tweetType(tweet)},
        ${tweetText(tweet)},
        ${metricsJson(metrics)}::jsonb,
        ${new Date(
          String(
            tweet?.created_at
          )
        ).toISOString()}
      )
      on conflict (
        user_id,
        x_post_id
      )
      do update set
        type =
          excluded.type,
        text =
          excluded.text,
        metrics =
          excluded.metrics,
        published_at =
          excluded.published_at
      returning id
    `;

  const id = rows[0]?.id;

  if (id) {
    await snapshot(
      userId,
      id,
      metrics
    );
  }

  return id;
}

export async function runSync(
  userId: string
) {
  try {
    await requireOpen(userId);
    limit(userId, "sync", 4);

    const token =
      await accessToken(userId);

    const meResponse =
      await fetch(
        "https://api.x.com/2/users/me?user.fields=id,name,username",
        {
          headers: {
            authorization:
              `Bearer ${token}`
          },
          cache: "no-store",
          signal:
            AbortSignal.timeout(
              15_000
            )
        }
      );

    if (!meResponse.ok) {
      throw new PulseError(
        `X profile request failed (${meResponse.status}).`,
        "X_PROFILE_FAILED"
      );
    }

    const mePayload =
      (await meResponse.json()) as {
        data?: {
          id?: string;
          name?: string;
          username?: string;
        };
      };

    const me =
      mePayload.data;

    if (!me?.id) {
      throw new PulseError(
        "X profile could not be resolved.",
        "X_PROFILE_FAILED"
      );
    }

    const fullParams =
      new URLSearchParams({
        max_results: "100",
        exclude:
          "retweets,replies",
        "tweet.fields":
          "id,text,created_at,public_metrics,non_public_metrics,organic_metrics,note_tweet,entities"
      });

    let postsResponse =
      await fetch(
        `https://api.x.com/2/users/${encodeURIComponent(me.id)}/tweets?${fullParams.toString()}`,
        {
          headers: {
            authorization:
              `Bearer ${token}`
          },
          cache: "no-store",
          signal:
            AbortSignal.timeout(
              15_000
            )
        }
      );

    if (!postsResponse.ok) {
      const fallbackParams =
        new URLSearchParams({
          max_results: "100",
          exclude:
            "retweets,replies",
          "tweet.fields":
            "id,text,created_at,public_metrics,note_tweet,entities"
        });

      postsResponse =
        await fetch(
          `https://api.x.com/2/users/${encodeURIComponent(me.id)}/tweets?${fallbackParams.toString()}`,
          {
            headers: {
              authorization:
                `Bearer ${token}`
            },
            cache: "no-store",
            signal:
              AbortSignal.timeout(
                15_000
              )
          }
        );
    }

    if (!postsResponse.ok) {
      const body =
        await postsResponse.text();

      throw new PulseError(
        `X posts request failed (${postsResponse.status}): ${body.slice(0, 160)}`,
        "X_POSTS_FAILED"
      );
    }

    const payload =
      (await postsResponse.json()) as {
        data?: any[];
      };

    const tweets =
      Array.isArray(
        payload.data
      )
        ? payload.data
        : [];

    for (const tweet of tweets) {
      await saveXPost(
        userId,
        tweet
      );
    }

    const sql = await getSql();

    await sql`
      update xpulse_profiles
      set
        x_id = ${me.id},
        x_username = ${me.username || null},
        updated_at = now()
      where user_id = ${userId}
    `;

    const posts =
      await loadPosts(userId);

    await saveHeat(
      userId,
      posts
    );

    return {
      ok: true as const,
      imported:
        tweets.length,
      posts,
      heatmap:
        inferHeatmap(posts),
      x: {
        id: me.id,
        username:
          me.username || null,
        name:
          me.name || null
      }
    };
  } catch (error) {
    return fail(error);
  }
}

const TWEET_URL_PATTERN =
  /(?:twitter\.com|x\.com)\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{5,20})/i;

function extractTweetId(
  link: string
): string | null {
  const trimmed = link.trim();

  const match =
    trimmed.match(
      TWEET_URL_PATTERN
    );

  if (match?.[1]) {
    return match[1];
  }

  if (
    /^\d{5,20}$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

async function fetchTweetById(
  token: string,
  id: string
) {
  const params =
    new URLSearchParams({
      "tweet.fields":
        "id,text,created_at,public_metrics,non_public_metrics,organic_metrics,note_tweet,entities,author_id,conversation_id"
    });

  const response =
    await fetch(
      `https://api.x.com/2/tweets/${encodeURIComponent(id)}?${params.toString()}`,
      {
        headers: {
          authorization:
            `Bearer ${token}`
        },
        cache: "no-store",
        signal:
          AbortSignal.timeout(
            15_000
          )
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new PulseError(
      `X post request failed (${response.status}): ${body.slice(0, 160)}`,
      "X_POST_FAILED"
    );
  }

  const payload =
    (await response.json()) as {
      data?: any;
    };

  if (!payload.data?.id) {
    throw new PulseError(
      "Could not read that X post. It may be deleted, protected, or unavailable.",
      "X_POST_NOT_FOUND"
    );
  }

  return payload.data;
}

function publicPostToMetrics(post: PublicXPost): PostMetrics {
  return {
    impressions: post.metrics.views ?? 0,
    likes: post.metrics.likes ?? 0,
    replies: post.metrics.replies ?? 0,
    reposts: post.metrics.reposts ?? 0,
    bookmarks: post.metrics.bookmarks ?? 0,
    profileClicks: 0,
    linkClicks: 0,
    detailExpands: null,
    dwellMs: null,
  };
}

async function savePublicXPost(userId: string, post: PublicXPost) {
  const metrics = publicPostToMetrics(post);
  const sql = await getSql();
  const type = /\b1\/\d+/.test(post.text) ? "thread" : "tweet";
  const rows = await sql<{ id: string }>`
    insert into xpulse_posts (
      id, user_id, x_post_id, type, text, metrics, published_at
    )
    values (
      ${randomHex(16)},
      ${userId},
      ${post.id},
      ${type},
      ${post.text},
      ${metricsJson(metrics)}::jsonb,
      ${new Date(post.createdAt).toISOString()}
    )
    on conflict (user_id, x_post_id)
    do update set
      type = excluded.type,
      text = excluded.text,
      metrics = excluded.metrics,
      published_at = excluded.published_at
    returning id
  `;
  const id = rows[0]?.id;
  if (id) await snapshot(userId, id, metrics);
  return id;
}

async function fetchPublicXPost(input: string): Promise<PublicXPost> {
  try {
    const raw = await resolvePublicXPost(input);
    const handle = raw.authorUsername?.replace(/^@/, "") ?? "";
    const text = raw.text.trim() || "(no public text)";
    return {
      id: raw.id,
      url: handle ? `https://x.com/${handle}/status/${raw.id}` : `https://x.com/i/status/${raw.id}`,
      text,
      createdAt: raw.createdAt,
      author: {
        name: raw.authorName ?? (handle || "Unknown"),
        handle,
      },
      metrics: {
        views: raw.views,
        likes: raw.likes,
        replies: raw.replies,
        reposts: raw.reposts,
        quotes: raw.quotes,
        bookmarks: raw.bookmarks,
      },
      signals: writingSignals(text),
      source: raw.provider,
    };
  } catch (error) {
    if (error instanceof PublicXError) {
      throw new PulseError(error.message, error.code);
    }
    throw error;
  }
}

export async function runCompareXUrls(input: unknown): Promise<PublicCompareResult> {
  try {
    const parsed = parseInput(compareXUrlsSchema, input);
    if (!parsed.ok) throw new PulseError(parsed.message);

    const viralId = extractPublicXPostId(parsed.data.viralUrl);
    const targetId = extractPublicXPostId(parsed.data.targetUrl);
    if (viralId && targetId && viralId === targetId) {
      throw new PulseError("Use two different posts. The reference and the post to improve are the same link.");
    }

    const [viral, target] = await Promise.all([
      fetchPublicXPost(parsed.data.viralUrl),
      fetchPublicXPost(parsed.data.targetUrl),
    ]);

    if (viral.id === target.id) {
      throw new PulseError("Use two different posts. The reference and the post to improve are the same link.");
    }

    return {
      viral,
      target,
      gaps: comparePublicPosts(viral, target),
      deficits: compareMetricDeficits(viral, target),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runImportFromXUrl(userId: string, input: unknown) {
  try {
    limit(userId, "link-import", 20);
    await requireOpen(userId);
    const raw = typeof input === "string" ? input : String((input as { url?: unknown })?.url ?? "");
    const link = raw.trim();
    if (!link) throw new PulseError("Paste a link to an X post, thread, or article.");

    const publicPost = await fetchPublicXPost(link);
    const profile = await profileFor(userId);
    const owned = Boolean(profile?.x_username && profile.x_username.toLowerCase() === publicPost.author.handle.toLowerCase());
    const postId = await savePublicXPost(userId, publicPost);
    if (!postId) throw new PulseError("Could not save that post.");

    await saveHeat(userId, await loadPosts(userId));
    log("info", "public X post imported", { userId, tweetId: publicPost.id, owned, source: publicPost.source });

    return {
      ok: true as const,
      id: postId,
      owned,
      scope: "public" as const,
      message: `Post imported from public X data (${publicPost.source}). No X login or X API was used.`,
    };
  } catch (error) {
    return fail(error);
  }
}

function loginMessage(
  nonce: string
) {
  return `XPulse login\n${nonce}`;
}

export async function runIssueLoginNonce() {
  try {
    const sql = await getSql();
    const nonce = randomHex(24);

    await sql`
      delete from xpulse_nonces
      where user_id = 'siws'
         or expires_at < now()
    `;

    await sql`
      insert into xpulse_nonces (
        id,
        user_id,
        nonce,
        expires_at
      )
      values (
        ${randomHex(16)},
        'siws',
        ${nonce},
        now() + interval '10 minutes'
      )
    `;

    return {
      ok: true as const,
      message:
        loginMessage(nonce)
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runLoginWithWallet(
  input: unknown
) {
  try {
    limit(
      "siws",
      "login-wallet",
      20
    );

    const data =
      input as {
        address?: string;
        message?: string;
        signature?: string;
      };

    const address = String(
      data?.address ?? ""
    ).trim();
    const message = String(
      data?.message ?? ""
    );
    const signature = String(
      data?.signature ?? ""
    );

    if (
      !address ||
      !message ||
      !signature
    ) {
      throw new PulseError(
        "Missing wallet login data."
      );
    }

    const parts =
      message.split("\n");

    if (
      parts.length !== 2 ||
      parts[0] !==
        "XPulse login" ||
      !parts[1]
    ) {
      throw new PulseError(
        "Invalid login message."
      );
    }

    const nonce = parts[1];
    const sql = await getSql();

    const nonceRows =
      await sql<{ nonce: string }>`
        select nonce
        from xpulse_nonces
        where user_id = 'siws'
          and nonce = ${nonce}
          and expires_at > now()
        limit 1
      `;

    if (!nonceRows[0]) {
      throw new PulseError(
        "Login request expired."
      );
    }

    await verifyWalletSignature(
      message,
      signature,
      address
    );

    await sql`
      delete from xpulse_nonces
      where user_id = 'siws'
        and nonce = ${nonce}
    `;

    const existingWallet =
      await sql<{
        user_id: string;
      }>`
        select user_id
        from xpulse_wallets
        where address = ${address}
        limit 1
      `;

    let userId =
      existingWallet[0]
        ?.user_id;

    if (!userId) {
      userId = randomHex(18);

      await sql`
        insert into "user" (
          id,
          name,
          email,
          "emailVerified",
          "createdAt",
          "updatedAt"
        )
        values (
          ${userId},
          ${shortWallet(address)},
          ${`${address.toLowerCase()}@wallet.xpulse.invalid`},
          true,
          now(),
          now()
        )
      `;
    }

    const accountRows =
      await sql<{ user_id: string }>`
        select "userId" as user_id
        from account
        where "providerId" = 'solana'
          and "accountId" = ${address}
        limit 1
      `;

    if (accountRows[0] && accountRows[0].user_id !== userId) {
      throw new PulseError(
        "That Solana wallet is already linked to another XPulse account.",
        "WALLET_OWNED"
      );
    }

    if (!accountRows[0]) {
      await sql`
        insert into account (
          id,
          "accountId",
          "providerId",
          "userId",
          "createdAt",
          "updatedAt"
        )
        values (
          ${randomHex(16)},
          ${address},
          'solana',
          ${userId},
          now(),
          now()
        )
      `;
    }

    await ensureProfile(
      userId
    );

    await sql`
      insert into xpulse_wallets (
        address,
        user_id,
        is_lifetime
      )
      values (
        ${address},
        ${userId},
        false
      )
      on conflict (address)
      do nothing
    `;

    await ensureTrialAccess(userId, address);

    await sql`
      delete from session
      where "userId" = ${userId}
    `;

    const token =
      randomBytes(32).toString(
        "base64url"
      );
    const sessionId =
      randomHex(16);

    await sql`
      insert into session (
        id,
        "expiresAt",
        token,
        "createdAt",
        "updatedAt",
        "userId",
        "walletAddress"
      )
      values (
        ${sessionId},
        now() + interval '30 days',
        ${token},
        now(),
        now(),
        ${userId},
        ${address}
      )
    `;

    setResponseHeader(
      "Set-Cookie",
      `${SESSION_TOKEN_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
    );

    return {
      ok: true as const,
      userId,
      address,
      message:
        "Signed in with Solana wallet."
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runStartTrial(
  userId: string
) {
  try {
    limit(userId, "trial", 4);

    const address =
      await getSessionWalletAddress(
        userId
      );

    if (!address) {
      throw new PulseError(
        "Your wallet session is missing. Sign in again.",
        "SESSION_WALLET_MISSING"
      );
    }

    const sql = await getSql();

    const rows =
      await sql<{
        plan: string | null;
        is_lifetime: boolean;
        trial_started_at: unknown;
        trial_expires_at: unknown;
      }>`
        select
          plan,
          is_lifetime,
          trial_started_at,
          trial_expires_at
        from xpulse_wallets
        where user_id = ${userId}
          and address = ${address}
        limit 1
      `;

    const row = rows[0];

    if (!row) {
      throw new PulseError(
        "The signed wallet is not registered.",
        "WALLET_NOT_REGISTERED"
      );
    }

    if (
      row.is_lifetime ||
      row.plan === "lifetime"
    ) {
      return {
        ok: true as const,
        plan:
          "lifetime" as const,
        active: true,
        trialExpiresAt: null,
        message:
          "This wallet already has Pro Lifetime."
      };
    }

    if (row.trial_started_at) {
      const expires =
        row.trial_expires_at
          ? new Date(
              String(
                row.trial_expires_at
              )
            )
          : null;

      if (
        expires &&
        expires.getTime() >
          Date.now()
      ) {
        return {
          ok: true as const,
          plan:
            "trial" as const,
          active: true,
          trialExpiresAt:
            expires.toISOString(),
          message:
            "Your 7-day Pro trial is already active."
        };
      }

      return {
        ok: false as const,
        plan:
          "none" as const,
        active: false,
        trialExpiresAt:
          iso(row.trial_expires_at),
        message:
          "The 7-day Pro trial for this wallet has already been used."
      };
    }

    const updated =
      await sql<{
        trial_expires_at: unknown;
      }>`
        update xpulse_wallets
        set
          plan = 'trial',
          trial_started_at = now(),
          trial_expires_at =
            now() + interval '7 days',
          updated_at = now()
        where user_id = ${userId}
          and address = ${address}
          and is_lifetime = false
          and trial_started_at is null
        returning trial_expires_at
      `;

    if (!updated[0]) {
      throw new PulseError(
        "The trial could not be started. Try again.",
        "TRIAL_START_FAILED"
      );
    }

    const expires =
      iso(
        updated[0]
          .trial_expires_at
      );

    log(
      "info",
      "wallet trial started",
      {
        userId,
        address,
        trialExpiresAt:
          expires
      }
    );

    return {
      ok: true as const,
      plan:
        "trial" as const,
      active: true,
      trialExpiresAt:
        expires,
      message:
        "7-day Pro trial activated. Full Chamber access is now unlocked."
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runDeletePosts(userId: string, input: unknown) {
  try {
    await requireOpen(userId);
    const ids = Array.isArray((input as { ids?: unknown })?.ids)
      ? ((input as { ids: unknown[] }).ids.filter((id) => typeof id === "string") as string[])
      : [];
    if (!ids.length) {
      throw new PulseError("Select at least one item to delete.");
    }
    const sql = await getSql();
    await sql`
      delete from xpulse_links
      where user_id = ${userId}
        and (
          article_post_id = any(${ids}::text[])
          or thread_post_id = any(${ids}::text[])
        )
    `;
    await sql`
      delete from xpulse_posts
      where user_id = ${userId}
        and id = any(${ids}::text[])
    `;
    return { ok: true as const, deleted: ids.length, message: "Selected items removed." };
  } catch (error) {
    return fail(error);
  }
}

export async function runClearPosts(userId: string) {
  try {
    await requireOpen(userId);
    const sql = await getSql();
    await sql`delete from xpulse_links where user_id = ${userId}`;
    await sql`delete from xpulse_posts where user_id = ${userId}`;
    return { ok: true as const, message: "History cleared." };
  } catch (error) {
    return fail(error);
  }
}
