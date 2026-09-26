import { getSql } from "../db";
import {
  readSessionToken,
} from "./server";

export const authConfigured = true;

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type WalletSessionUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
};

export type WalletSession = {
  session: {
    id: string;
    userId: string;
    walletAddress: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
  };
  user: WalletSessionUser;
};

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(
    String(value),
  ).toISOString();
}

/**
 * Resolve the authoritative XPulse application session.
 *
 * Authentication is wallet-only.
 *
 * session
 *   -> user
 *   -> session.walletAddress
 *   -> Solana account
 *   -> xpulse_wallets
 */
export async function getWalletSession(): Promise<
  WalletSession | null
> {
  const token =
    readSessionToken();

  if (!token) {
    return null;
  }

  const sql =
    await getSql();

  const rows =
    await sql<{
      session_id: string;
      wallet_address: string | null;
      expires_at: unknown;
      created_at: unknown;
      updated_at: unknown;
      user_id: string;
      email: string | null;
      name: string | null;
      image: string | null;
      email_verified: boolean;
    }>`
      select
        s.id as session_id,
        s."walletAddress" as wallet_address,
        s."expiresAt" as expires_at,
        s."createdAt" as created_at,
        s."updatedAt" as updated_at,
        u.id as user_id,
        u.email,
        u.name,
        u.image,
        u."emailVerified" as email_verified
      from session s
      inner join "user" u
        on u.id = s."userId"
      inner join account a
        on a."userId" = u.id
       and a."providerId" = ${"solana"}
       and a."accountId" = s."walletAddress"
      inner join xpulse_wallets w
        on w.user_id = u.id
       and w.address = s."walletAddress"
      where s.token = ${token}
        and s."expiresAt" > now()
      limit 1
    `;

  const row =
    rows[0];

  if (
    !row ||
    !row.wallet_address
  ) {
    return null;
  }

  return {
    session: {
      id: row.session_id,
      userId: row.user_id,
      walletAddress:
        row.wallet_address,
      expiresAt:
        iso(row.expires_at),
      createdAt:
        iso(row.created_at),
      updatedAt:
        iso(row.updated_at),
    },

    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      image: row.image,
      emailVerified:
        Boolean(
          row.email_verified,
        ),
    },
  };
}

export async function getSessionUser(): Promise<
  WalletSessionUser | null
> {
  const session =
    await getWalletSession();

  return session?.user ?? null;
}

export async function getSessionWalletAddress(
  userId?: string,
): Promise<string | null> {
  const session =
    await getWalletSession();

  if (!session) {
    return null;
  }

  if (
    userId &&
    session.user.id !==
      userId
  ) {
    return null;
  }

  return session.session
    .walletAddress;
}

export async function revokeCurrentSession(): Promise<void> {
  const token =
    readSessionToken();

  if (!token) {
    return;
  }

  const sql =
    await getSql();

  await sql`
    delete from session
    where token = ${token}
  `;
}

export async function requireUserId(): Promise<string> {
  const session =
    await getWalletSession();

  if (!session) {
    throw new UnauthorizedError();
  }

  return session.user.id;
}
