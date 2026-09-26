import { createMiddleware } from "@tanstack/react-start";

/**
 * Server-function auth middleware.
 *
 * Authentication is cookie-based and wallet-backed. No bearer token or
 * external identity is accepted. `requireUserId()` performs the authoritative
 * session + Solana-account + XPulse-wallet checks on the server.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { requireUserId } = await import("./verify.server");

    assertSameSiteRequest();

    const userId = await requireUserId();
    return next({ context: { userId } });
  },
);
