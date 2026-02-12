"use client";

import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { isPublicPath } from "@/lib/auth/public-routes";
import { useTranslations } from "next-intl";

export function AuthRouteGate({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
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
          primaryHref="/auth/signin"
          primaryLabel={tc("signIn")}
          secondaryHref="/"
          secondaryLabel={tc("goHome")}
          layout="fullscreen"
        />
      ) : phase === "sync_error" ? (
        <AuthStatePanel
          key="auth-gate-sync-error"
          variant="sync_error_retry"
          description={t("syncErrorAccess")}
          onRetry={retryUserSync}
          secondaryHref="/"
          secondaryLabel={tc("goHome")}
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
