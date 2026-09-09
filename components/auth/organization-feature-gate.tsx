"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { OrganizationFeature } from "@/convex/organizationFeatures";
import { useOrganizationFeatures } from "@/lib/auth/use-organization-features";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { PageWrapper } from "@/components/PageWrapper";
import { AuthStatePanel } from "./auth-state-panel";

export function OrganizationFeatureGate({ feature, children }: { feature: OrganizationFeature; children: ReactNode }) {
  const { data, phase } = useOrganizationFeatures();
  const { retryUserSync } = useAuthReadiness();
  const t = useTranslations("auth");
  if (phase === "authenticated" && data?.[feature]) return children;

  const variant = phase === "sync_error" ? "sync_error_retry"
    : phase === "anonymous" ? "sign_in_required"
    : data === undefined ? "loading" : "no_access";
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
