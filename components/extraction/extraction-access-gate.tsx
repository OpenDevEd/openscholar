"use client";

import type { ReactNode } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { useTranslations } from "next-intl";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

type ExtractionAccessGateProps = {
  children: ReactNode;
};

/** An extraction page while access is checked: the empty page frame with the list spinner. */
function ExtractionLoading() {
  const tc = useTranslations("common");
  return (
    <PageWrapper>
      <PageFrameLoading label={tc("loading")} />
    </PageWrapper>
  );
}

/**
 * Extraction comes with every plan, and credits are what limit it. Only its switches turn it
 * off, for everyone at once (Settings, Admin).
 */
export function ExtractionAccessGate({ children }: ExtractionAccessGateProps) {
  const t = useTranslations("auth");
  const { isSettling } = useSubscriptionState();
  const extractionEnabled = useFeatureFlag("extraction.enabled");
  const canStartExtraction = useFeatureFlag("extraction.start");

  if (isSettling) return <ExtractionLoading />;

  if (!extractionEnabled || !canStartExtraction) {
    return (
      <PageWrapper>
        <AuthStatePanel layout="fullscreen" variant="no_access" primaryHref="/" primaryLabel={t("backToSearch")} />
      </PageWrapper>
    );
  }

  return <>{children}</>;
}
