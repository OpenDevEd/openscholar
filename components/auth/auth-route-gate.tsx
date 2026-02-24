"use client";

import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { isPublicPath } from "@/lib/auth/public-routes";
import { useTranslations } from "next-intl";

/** Renders auth gate panels with translations. Isolated so useTranslations runs only when gate is shown, avoiding hook-order issues during provider hydration. */
function AuthGateContent({
  phase,
  onRetry,
}: {
  phase: "anonymous" | "sync_error" | "initializing";
  onRetry: () => void;
}) {
  const t = useTranslations();

  if (phase === "anonymous") {
    return (
      <AuthStatePanel
        key="auth-gate-anonymous"
        variant="sign_in_required"
        primaryHref="/sign-in"
        primaryLabel={t("common.signIn")}
        secondaryHref="/"
        secondaryLabel={t("common.goHome")}
        layout="fullscreen"
      />
    );
  }

  if (phase === "sync_error") {
    return (
      <AuthStatePanel
        key="auth-gate-sync-error"
        variant="sync_error_retry"
        description={t("auth.syncErrorAccess")}
        onRetry={onRetry}
        secondaryHref="/"
        secondaryLabel={t("common.goHome")}
        layout="fullscreen"
      />
    );
  }

  return (
    <AuthStatePanel
      key="auth-gate-initializing"
      variant="loading"
      layout="fullscreen"
      loadingStyle="spinner"
    />
  );
}

export function AuthRouteGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { phase, retryUserSync } = useAuthReadiness();

  if (isPublicPath(pathname) || phase === "authenticated") {
    return <>{children}</>;
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <AuthGateContent key={phase} phase={phase} onRetry={retryUserSync} />
    </AnimatePresence>
  );
}
