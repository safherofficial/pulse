import { createAuthClient } from "better-auth/react";
import { runSignOut } from "../../../scripts/sign-out-plan.mjs";

export const authClient = createAuthClient({
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();

      if (token) {
        ctx.headers.set(
          "Authorization",
          `Bearer ${token}`,
        );
      }

      return ctx;
    },
  },
});

const BEARER_KEY = "grok-auth.bearer-token";

export function getBearerToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(
      BEARER_KEY,
    );
  } catch {
    return null;
  }
}

function setBearerToken(
  token: string | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (token) {
      window.sessionStorage.setItem(
        BEARER_KEY,
        token,
      );
    } else {
      window.sessionStorage.removeItem(
        BEARER_KEY,
      );
    }
  } catch {
    /* storage unavailable */
  }
}

function inLivePreview(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(
      ".grok-sandbox.com",
    )
  );
}

/**
 * Compatibility entry point for old callers.
 *
 * There is no provider selector anymore.
 * Regardless of any legacy argument, sign-in always goes to the
 * one and only application authentication surface: Solana wallet login.
 */
export async function signIn(
  _providerId?: string,
  _opts: {
    callbackURL?: string;
    errorCallbackURL?: string;
  } = {},
): Promise<void> {
  if (typeof window !== "undefined") {
    window.location.assign("/login");
  }
}

export async function signOut(
  redirectTo = "/",
): Promise<void> {
  await runSignOut({
    livePreview: inLivePreview(),
    hasBearer: Boolean(getBearerToken()),

    requestSignOut: async () => {
      const { error } =
        await authClient.signOut();

      if (error) {
        throw new Error(
          error.message ??
            "Sign-out failed",
        );
      }
    },

    clearToken: () =>
      setBearerToken(null),

    redirect: () => {
      window.location.href =
        redirectTo;
    },
  });
}
