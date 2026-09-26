/**
 * Self-hosted Better Auth for XPulse (server-only).
 *
 * Authentication is wallet-only.
 *
 * The application creates the user/account/session only after a valid Solana
 * wallet signature has been verified by `runLoginWithWallet` in
 * `src/lib/xpulse/data.server.ts`.
 *
 * There are intentionally:
 * - no Google providers
 * - no X/Twitter login providers
 * - no email/password authentication
 * - no external identity/gate session bridge
 * - no OAuth popup
 *
 * X OAuth that exists elsewhere in the application is an API integration used
 * after wallet authentication. It does not authenticate an XPulse user.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

import { ensureDbReady, getPglite } from "../db";
import { pgliteDialect } from "./pglite-dialect";

void ensureDbReady();

const globalAuthRef = globalThis as typeof globalThis & {
  __xpulseAuthPreviewSecret__?: string;
};

function previewAuthSecret(): string {
  globalAuthRef.__xpulseAuthPreviewSecret__ ??= randomBytes(32).toString(
    "hex",
  );

  return globalAuthRef.__xpulseAuthPreviewSecret__;
}

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

const explicitBaseURL = env("BETTER_AUTH_URL");

const vercelHost = env("VERCEL_URL")?.replace(
  /^https?:\/\//,
  "",
);

const vercelOrigin = vercelHost
  ? `https://${vercelHost}`
  : undefined;

/**
 * Optional additional preview hosts.
 *
 * This replaces the old PREVIEW_ALLOWED_HOSTS import that no longer exists.
 * Vercel preview origins are already covered by the wildcard trusted origin
 * below, so this variable is optional.
 *
 * Example:
 * PREVIEW_ALLOWED_HOSTS=preview.example.com,another-preview.example.com
 */
const previewAllowedHosts: string[] = (env("PREVIEW_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const allowedHosts: string[] = [
  ...previewAllowedHosts,
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(vercelHost ? [vercelHost] : []),
];

const baseURL = {
  allowedHosts,
  protocol: "auto" as const,
  fallback:
    explicitBaseURL ??
    vercelOrigin ??
    "http://localhost:8080",
};

const trustedOrigins: string[] = [
  ...(explicitBaseURL
    ? [explicitBaseURL]
    : []),

  ...(vercelOrigin
    ? [vercelOrigin]
    : []),

  /**
   * Vercel deployment and preview origins.
   *
   * These are origins only. They do not register Google, X/Twitter, or any
   * other authentication provider.
   */
  "https://*.vercel.app",
  "*.vercel.app",

  ...previewAllowedHosts,

  ...previewAllowedHosts.flatMap((host) => [
    `https://${host}`,
    `http://${host}`,
  ]),

  ...LOCAL_DEV_ORIGINS,
];

const databaseUrl = env("DATABASE_URL");

const database = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
    })
  : {
      dialect: pgliteDialect(
        () => getPglite(),
      ),
      type: "postgres" as const,
    };

export const SESSION_TOKEN_COOKIE =
  "__Host-grok-auth.session_token";

export const auth = betterAuth({
  baseURL,

  secret:
    env("BETTER_AUTH_SECRET") ??
    previewAuthSecret(),

  database,

  trustedOrigins,

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300,
    },
  },

  advanced: {
    useSecureCookies: false,

    defaultCookieAttributes: {
      secure: true,
      sameSite: "lax",
      path: "/",
    },

    cookies: {
      session_token: {
        name: SESSION_TOKEN_COOKIE,
      },

      session_data: {
        name: "__Host-grok-auth.session_data",
      },

      account_data: {
        name: "__Host-grok-auth.account_data",
      },

      dont_remember: {
        name: "__Host-grok-auth.dont_remember",
      },
    },
  },

  /**
   * Better Auth is only the application session layer.
   *
   * There are no social providers and no bearer identity bridge registered
   * here. The Solana wallet login flow creates the session directly.
   */
  plugins: [
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return (
    getCookie(SESSION_TOKEN_COOKIE) ??
    null
  );
}
