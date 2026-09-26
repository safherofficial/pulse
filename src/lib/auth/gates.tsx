import { useState, type ReactNode } from "react";
import { Link, Navigate } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { signOut } from "./client";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

export const SIGN_IN_PATH = "/login";

export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({
    isPending,
    hasUser: user !== null,
  });

  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;

  return <>{fallback ?? <SignInButtons />}</>;
}

export function SignInButtons() {
  return (
    <Link
      to="/login"
      className={buttonVariants()}
    >
      Sign in with wallet
    </Link>
  );
}

export function UserButton() {
  const user = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const label = user.displayName ?? "Wallet";

  return (
    <div className="flex items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-8 place-items-center rounded-sm border border-line bg-surface font-mono text-xs text-accent">
          {label.charAt(0).toUpperCase()}
        </span>
      )}

      <span className="max-w-28 truncate text-sm font-medium">{label}</span>

      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOut().catch(() => setSigningOut(false));
        }}
        className="inline-flex h-11 cursor-pointer items-center text-sm text-muted underline-offset-4 hover:text-fg hover:underline disabled:cursor-wait disabled:no-underline"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
