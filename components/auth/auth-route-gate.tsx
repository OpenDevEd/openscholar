"use client";

import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { isPublicPath } from "@/lib/auth/public-routes";

export function AuthRouteGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { phase, retryUserSync } = useAuthReadiness();

  if (isPublicPath(pathname) || phase === "authenticated") {
    return <>{children}</>;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      {phase === "anonymous" ? (
        <AuthStatePanel
          key="auth-gate-anonymous"
          variant="sign_in_required"
          description="Sign in to access this page."
          primaryHref="/auth/signin"
          primaryLabel="Sign In"
          secondaryHref="/"
          secondaryLabel="Go Home"
          layout="fullscreen"
        />
      ) : phase === "sync_error" ? (
        <AuthStatePanel
          key="auth-gate-sync-error"
          variant="sync_error_retry"
          description="Your session is valid, but account sync is incomplete. Retry to continue."
          onRetry={retryUserSync}
          secondaryHref="/"
          secondaryLabel="Go Home"
          layout="fullscreen"
        />
      ) : (
        <AuthStatePanel
          key="auth-gate-initializing"
          variant="loading"
          layout="fullscreen"
          loadingStyle="spinner"
        />
      )}
    </AnimatePresence>
  );
}
