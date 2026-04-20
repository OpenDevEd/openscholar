"use client";

/**
 * Plan-06 unified status banner for non-terminal job pauses.
 *
 * Replaces the per-variant banners with a single component driven by
 * `variant`:
 *   - `paused` → user-initiated pause; role="status" (polite
 *     announcement because the user just took the action).
 *   - `creditsExhausted` → auto-pause from plan 03; role="alert"
 *     (escalated because the user is interrupted by the system).
 *
 * data-job-status on the container is the test-stable handle per the
 * project's testing doctrine (CLAUDE.md): assertions target the
 * attribute, never Tailwind utility strings.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Coins, Pause } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";

type CommonProps = {
  onResume?: () => void;
  onCancelRemaining?: () => void;
};

export type JobStatusBannerProps =
  | (CommonProps & {
      variant: "paused";
      /** Papers done / total — rendered into the localized body. */
      processedPapers?: number;
      totalPapers?: number;
    })
  | (CommonProps & {
      variant: "creditsExhausted";
      /** Required balance floor before the Resume CTA is enabled. */
      minCreditsToResume?: number;
    });

export function JobStatusBanner(props: JobStatusBannerProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const router = useRouter();

  // Skip the balance query on paused-variant renders — paused is not a
  // credit state, so displaying balance would be misleading and the
  // query cost is wasted.
  const { data: balance } = useProtectedQuery(
    api.credits.queries.checkBalance,
    props.variant === "creditsExhausted"
      ? { requiredAmount: props.minCreditsToResume ?? 1 }
      : "skip",
  );

  if (props.variant === "paused") {
    return (
      <Alert
        role="status"
        aria-live="polite"
        data-job-status="paused"
      >
        <Pause className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{t("paused.title")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-sm">
            {t("paused.body", {
              processed: props.processedPapers ?? 0,
              total: props.totalPapers ?? 0,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              data-action="resume"
              onClick={props.onResume}
              disabled={!props.onResume}
            >
              {t("paused.resume")}
            </Button>
            {props.onCancelRemaining && (
              <Button
                size="sm"
                variant="ghost"
                data-action="cancel-remaining"
                onClick={props.onCancelRemaining}
                className="text-destructive hover:text-destructive"
              >
                {t("paused.cancelRemaining")}
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const hasEnough = balance?.hasEnough ?? false;
  const total = balance?.total ?? 0;
  const canResume = Boolean(props.onResume) && hasEnough;

  return (
    <Alert
      role="alert"
      aria-live="polite"
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
            {total.toLocaleString()} {tc("credits").toLowerCase()}
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
            onClick={props.onResume}
          >
            {t("creditsExhausted.resume")}
          </Button>
          {props.onCancelRemaining && (
            <Button
              size="sm"
              variant="ghost"
              data-action="cancel-remaining"
              onClick={props.onCancelRemaining}
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
