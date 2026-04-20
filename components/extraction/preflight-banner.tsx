"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExtractionCostEstimate } from "@/lib/extraction/cost-estimate";

type BalanceCheck = {
  hasEnough: boolean;
  total: number;
  deficit: number;
  required: number;
};

export interface ExtractionPreflightBannerProps {
  estimate: ExtractionCostEstimate;
  balance: BalanceCheck | null | undefined;
  onBeforeNavigate?: () => void;
}

/**
 * Pre-submission credit-balance banner for the extraction job creator.
 * Mirrors the screening dialog pattern at
 * components/screening/screening-dialog.tsx:411-440 — same Coins icon,
 * same {estimate}/{total} display, same deep-link to billing top-up.
 *
 * Exposes data-preflight-ok + role="status" so tests can assert on
 * behaviour (sufficient vs insufficient) without coupling to Tailwind
 * utilities.
 */
export function ExtractionPreflightBanner({
  estimate,
  balance,
  onBeforeNavigate,
}: ExtractionPreflightBannerProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const router = useRouter();

  // No questions / no papers → no estimate → nothing to say.
  if (estimate.high <= 0) return null;
  // Waiting for the credits query.
  if (balance === undefined) return null;

  const total = balance?.total ?? 0;
  const ok = balance?.hasEnough ?? false;

  return (
    <div
      role="status"
      data-preflight-ok={ok ? "true" : "false"}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-xs ${
        ok ? "bg-muted/50" : "bg-destructive/10"
      }`}
    >
      <div className="flex items-center gap-3">
        <Coins
          className={`h-3.5 w-3.5 ${ok ? "text-muted-foreground" : "text-destructive"}`}
          aria-hidden="true"
        />
        <span className="tabular-nums">
          {ok ? (
            <>
              <span className="font-semibold">
                {t("preflight.sufficient", {
                  estimate: Math.round(estimate.mid).toLocaleString(),
                })}
              </span>
              <span className="text-muted-foreground">
                {" "}
                / {total.toLocaleString()}
              </span>
            </>
          ) : (
            t("preflight.insufficient", {
              estimate: Math.round(estimate.high).toLocaleString(),
              balance: total.toLocaleString(),
            })
          )}
        </span>
      </div>
      {!ok && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-semibold border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 transition-all"
          onClick={() => {
            onBeforeNavigate?.();
            router.push("/settings/billing#topup-section");
          }}
        >
          {tc("buyCredits")}
        </Button>
      )}
    </div>
  );
}
