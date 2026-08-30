"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CreditBalanceCardProps {
  free: number;
  paid: number;
  total: number;
  creditsPerMonth?: number;
  freeCreditCap: number;
  className?: string;
}

export function CreditBalanceCard({
  free,
  paid,
  total,
  creditsPerMonth = 0,
  freeCreditCap,
  className,
}: CreditBalanceCardProps) {
  const tc = useTranslations("common");
  const t = useTranslations("billingPage");
  const format = useFormatter();

  // Calculate how close to the cap
  const freeCapPercentage =
    freeCreditCap > 0 ? Math.min((free / freeCreditCap) * 100, 100) : 0;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-6 rounded-xl border border-border/50 bg-muted/30 p-5">
        {/* Total Balance */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("totalBalance")}</span>
            <span data-testid="billing-credit-balance" className={cn(
              "text-2xl font-bold font-mono",
              total < 0 && "text-red-600"
            )}>
              {format.number(total)}
            </span>
          </div>
        </div>

        {/* Free Credits */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium flex items-center gap-2">
              {t("freeCredits")}
              {creditsPerMonth > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  {t("perMonth", { amount: format.number(creditsPerMonth) })}
                </span>
              )}
            </span>
            <span data-testid="billing-free-credits" className="text-muted-foreground font-mono">
              {format.number(free)} / {format.number(freeCreditCap)}
            </span>
          </div>
          <Progress 
            value={freeCapPercentage} 
            className="h-2 bg-background"
          />
          {freeCapPercentage >= 100 && (
            <p
              data-testid="billing-credit-cap-banner"
              className="text-xs text-amber-600"
            >
              {t("freeCapReached")}
            </p>
          )}
        </div>

        {/* Paid Credits */}
        {paid !== 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{t("purchasedCredits")}</span>
              <span data-testid="billing-paid-credits" className={cn(
                "text-muted-foreground font-mono",
                paid < 0 && "text-red-600"
              )}>
                {format.number(paid)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("noExpiration")}
            </div>
          </div>
        )}

        {/* Help Text */}
        <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground">
          {t("creditsOrder")}
        </div>
      </div>
    </div>
  );
}
