import {
  useEffect,
  useState,
} from "react";

export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  isDevFallback: false;
};

export type CurrentUserState = {
  user: AppUser | null;
  isPending: boolean;
};

type SessionResponse = {
  session:
    | {
        id: string;
        userId: string;
        expiresAt: string;
        createdAt: string;
        updatedAt: string;
      }
    | null;

  user:
    | {
        id: string;
        name: string | null;
        email: string | null;
        emailVerified: boolean;
        image: string | null;
      }
    | null;
};

export function useCurrentUserState(): CurrentUserState {
  const [user, setUser] =
    useState<AppUser | null>(
      null,
    );

  const [isPending, setIsPending] =
    useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response =
          await fetch(
            "/api/auth/get-session",
            {
              method: "GET",
              credentials:
                "include",
              cache: "no-store",
              headers: {
                "cache-control":
                  "no-cache",
              },
            },
          );

        if (!response.ok) {
          if (active) {
            setUser(null);
          }

          return;
        }

        const data =
          (await response.json()) as SessionResponse;

        if (!active) {
          return;
        }

        if (
          !data.session ||
          !data.user
        ) {
          setUser(null);
          return;
        }

        setUser({
          id: data.user.id,

          displayName:
            data.user.name ??
            "Wallet",

          primaryEmail:
            data.user.email,

          profileImageUrl:
            data.user.image,

          isDevFallback:
            false,
        });
      } catch {
        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setIsPending(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return {
    user,
    isPending,
  };
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState()
    .user;
}
