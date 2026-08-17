"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { AppShell } from "@/components/app-shell";
import { SyncProvider } from "@/components/sync-provider";
import {
  getRememberedLocalIdentity,
  rememberLocalIdentity,
} from "@/lib/local-db";
import { createClient } from "@/lib/supabase/client";

interface ClientIdentity {
  userId: string;
  email: string;
}

const SESSION_RESOLUTION_TIMEOUT_MS = 1_200;

const LOCAL_E2E_IDENTITY: ClientIdentity = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "e2e@local.test",
};

export function ClientAppBoundary({
  children,
  localOnly,
}: {
  children: React.ReactNode;
  localOnly: boolean;
}) {
  const [identity, setIdentity] = useState<ClientIdentity | null>(() =>
    localOnly ? LOCAL_E2E_IDENTITY : null,
  );

  useEffect(() => {
    let cancelled = false;
    let liveSessionResolved = false;
    const supabase = localOnly ? null : createClient();

    async function remember(identityToRemember: ClientIdentity) {
      try {
        await rememberLocalIdentity(identityToRemember);
      } catch {
        // IndexedDB may be unavailable in a restricted browser context. A
        // valid live session must still be allowed to open the application.
      }
    }

    async function restoreRememberedIdentity() {
      try {
        const remembered = await getRememberedLocalIdentity();
        if (remembered && !cancelled) {
          setIdentity(remembered);
          return true;
        }
      } catch {
        // Continue to the login/offline fallback below.
      }
      return false;
    }

    function applySessionIdentity(user: Pick<User, "id" | "email">) {
      liveSessionResolved = true;
      const currentIdentity = {
        userId: user.id,
        email: user.email ?? "个人管理库",
      };
      if (!cancelled) setIdentity(currentIdentity);
      void remember(currentIdentity);
    }

    function redirectToLogin() {
      if (cancelled) return;
      setIdentity(null);
      const nextPath = `${window.location.pathname}${window.location.search}`;
      window.location.replace(
        `/auth/login?next=${encodeURIComponent(nextPath)}`,
      );
    }

    async function resolveIdentity() {
      if (localOnly) {
        await remember(LOCAL_E2E_IDENTITY);
        return;
      }
      if (!supabase) return;

      // Do not wait for a token refresh that cannot succeed while offline.
      // The remembered identity only selects this device's IndexedDB partition;
      // cloud access remains protected independently by Supabase RLS.
      if (!navigator.onLine) {
        if (await restoreRememberedIdentity()) return;
        if (!cancelled) window.location.replace("/offline");
        return;
      }

      try {
        const sessionRequest = supabase.auth.getSession();
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const sessionResult = await Promise.race([
          sessionRequest,
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("SESSION_RESOLUTION_TIMEOUT")),
              SESSION_RESOLUTION_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        });
        const {
          data: { session },
        } = sessionResult;

        if (session?.user.id) {
          applySessionIdentity(session.user);
          return;
        }
      } catch {
        // Keep the shell locked; the login page performs the safe retry path.
      }

      // An online error must never unlock a possibly stale user's local
      // partition. The login page can retry a valid live session safely.
      if (!liveSessionResolved) redirectToLogin();
    }

    void resolveIdentity();
    const authSubscription = supabase?.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (cancelled) return;
        if (session?.user.id) {
          applySessionIdentity(session.user);
          return;
        }
        if (event === "INITIAL_SESSION") return;
        if (event === "SIGNED_OUT") {
          setIdentity(null);
          if (navigator.onLine) redirectToLogin();
          else window.location.replace("/offline");
        }
      },
    ).data.subscription;
    return () => {
      cancelled = true;
      authSubscription?.unsubscribe();
    };
  }, [localOnly]);

  if (!identity) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-[var(--paper)] px-6 text-sm text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        正在打开守中日课…
      </div>
    );
  }

  return (
    <SyncProvider
      key={identity.userId}
      userId={identity.userId}
      localOnly={localOnly}
    >
      <AppShell email={identity.email}>{children}</AppShell>
    </SyncProvider>
  );
}
