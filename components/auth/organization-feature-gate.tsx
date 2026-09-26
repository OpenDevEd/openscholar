"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { OrganizationFeature } from "@/convex/organizationFeatures";
import { useOrganizationFeatures } from "@/lib/auth/use-organization-features";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { PageWrapper } from "@/components/PageWrapper";
import { AuthStatePanel } from "./auth-state-panel";

/**
 * `fallback` replaces the full-screen loader while access is checked. A page
 * passes itself in a state that runs no queries, so its frame shows at once
 * and stays mounted when access is confirmed.
 */
export function OrganizationFeatureGate({ feature, fallback, children }: { feature: OrganizationFeature; fallback?: ReactNode; children: ReactNode }) {
  const { data, phase } = useOrganizationFeatures();
  const { retryUserSync } = useAuthReadiness();
  const t = useTranslations("auth");
  if (phase === "authenticated" && data?.[feature]) return children;

  const variant = phase === "sync_error" ? "sync_error_retry"
    : phase === "anonymous" ? "sign_in_required"
    : data === undefined ? "loading" : "no_access";
  if (variant === "loading" && fallback) return fallback;
  return <PageWrapper><AuthStatePanel
    layout="fullscreen"
    variant={variant}
    onRetry={retryUserSync}
    {...(variant === "no_access" ? {
      title: t("organizationFeatureTitle"),
      description: t("organizationFeatureDescription"),
      primaryHref: "/", primaryLabel: t("backToSearch"),
    } : {})}
  /></PageWrapper>;
}
