"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { PageWrapper } from "@/components/PageWrapper";
import { CommandCenterContainer } from "@/components/command-center";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { ExtractionPlanGate } from "./extraction-plan-gate";

type ExtractionAccessGateProps = {
  children: ReactNode;
};

export function ExtractionAccessGate({ children }: ExtractionAccessGateProps) {
  const subscriptionState = useSubscriptionState();
  const hasProAccess =
    subscriptionState.resolvedPlan === "pro" ||
    subscriptionState.resolvedPlan === "enterprise";

  if (subscriptionState.isSettling) {
    return (
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
          <CommandCenterContainer>
            <div className="flex min-h-[420px] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          </CommandCenterContainer>
        </div>
      </PageWrapper>
    );
  }

  if (!hasProAccess) {
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
