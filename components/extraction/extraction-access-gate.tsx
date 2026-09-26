"use client";

import type { ReactNode } from "react";
import { PageWrapper } from "@/components/PageWrapper";
import { PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { useTranslations } from "next-intl";
import { CommandCenterContainer } from "@/components/command-center";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { ExtractionPlanGate } from "./extraction-plan-gate";

type ExtractionAccessGateProps = {
  children: ReactNode;
};

/** An extraction page while access is checked: the empty page frame with the list spinner. */
export function ExtractionLoading() {
  const tc = useTranslations("common");
  return (
    <PageWrapper>
      <PageFrameLoading label={tc("loading")} />
    </PageWrapper>
  );
}

export function ExtractionAccessGate({ children }: ExtractionAccessGateProps) {
  const { isSettling } = useSubscriptionState();
  const extractionEnabled = useFeatureFlag("extraction.enabled");
  const canStartExtraction = useFeatureFlag("extraction.start");
  const hasExtractionAccess = extractionEnabled && canStartExtraction;

  if (isSettling) return <ExtractionLoading />;

  if (!hasExtractionAccess) {
    return (
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
          <CommandCenterContainer>
            <ExtractionPlanGate />
          </CommandCenterContainer>
        </div>
      </PageWrapper>
    );
  }

  return <>{children}</>;
}
