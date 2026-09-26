import { createFileRoute } from "@tanstack/react-router";
import {
  getWalletSession,
  revokeCurrentSession,
} from "@/lib/auth/verify.server";

/**
 * XPulse auth endpoint.
 *
 * There is exactly one authentication method:
 * Solana wallet signature.
 *
 * Better Auth is no longer responsible for resolving or destroying the
 * application session here. The application owns the wallet session directly.
 */
async function handle(
  request: Request,
): Promise<Response> {
  const pathname =
    new URL(request.url).pathname;

  const action =
    pathname
      .replace(/^\/api\/auth\//, "")
      .split("/")[0] ?? "";

  if (action === "get-session") {
    const session =
      await getWalletSession();

    return Response.json(
      session
        ? {
            session: session.session,
            user: session.user,
          }
        : {
            session: null,
            user: null,
          },
    );
  }

  if (action === "sign-out") {
    await revokeCurrentSession();

    return Response.json({
      success: true,
    });
  }

  return new Response(
    "Not found",
    {
      status: 404,
    },
  );
}

export const Route =
  createFileRoute(
    "/api/auth/$",
  )({
    server: {
      handlers: {
        GET: ({ request }) =>
          handle(request),

        POST: ({ request }) =>
          handle(request),
      },
    },
  });
