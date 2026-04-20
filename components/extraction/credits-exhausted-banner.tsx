"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Coins } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";

export interface CreditsExhaustedBannerProps {
  /**
   * Minimum credits required before the Resume button may re-enable.
   * Plan-03 ships this as 1 (just enough to start a single question);
   * plan-04's credit-aggregation surfaces a "remaining estimate" that
   * will replace this. Plan-06's resume mutation is what actually wires
   * the onResume handler — until it lands we leave the button disabled
   * via onResume={undefined}.
   */
  minCreditsToResume?: number;
  onResume?: () => void;
  onCancelRemaining?: () => void;
}

/**
 * In-job banner shown when `extractionJobs.status === "creditsExhausted"`.
 * Exposes role="alert" + data-job-status="creditsExhausted" so tests
 * assert on behaviour (not Tailwind). The Resume button is deliberately
 * non-functional until plan 06 — this component only ships the disabled
 * state + balance gate; the mutation wiring is plan-06's job.
 */
export function CreditsExhaustedBanner({
  minCreditsToResume = 1,
  onResume,
  onCancelRemaining,
}: CreditsExhaustedBannerProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const router = useRouter();

  const { data: balance } = useProtectedQuery(
    api.credits.queries.checkBalance,
    { requiredAmount: minCreditsToResume },
  );

  const hasEnoughToResume = balance?.hasEnough ?? false;
  const total = balance?.total ?? 0;
  const canResume = Boolean(onResume) && hasEnoughToResume;

  return (
    <Alert
      role="alert"
      data-job-status="creditsExhausted"
      className="border-destructive/30 bg-destructive/5"
    >
      <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
      <AlertTitle className="text-destructive">
        {t("creditsExhausted.title")}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-sm">{t("creditsExhausted.body")}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Coins className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="tabular-nums">
            {tc("balance")}: {total.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => router.push("/settings/billing#topup-section")}
          >
            {tc("buyCredits")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-action="resume"
            disabled={!canResume}
            onClick={onResume}
          >
            {t("creditsExhausted.resume")}
          </Button>
          {onCancelRemaining && (
            <Button
              size="sm"
              variant="ghost"
              data-action="cancel-remaining"
              onClick={onCancelRemaining}
              className="text-destructive hover:text-destructive"
            >
              {t("creditsExhausted.cancelRemaining")}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
