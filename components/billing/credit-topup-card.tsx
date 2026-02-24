"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

export type CreditTopupBundleCard = {
  key: string;
  credits: number;
  amountCents: number;
  currency: "usd";
};

type CreditTopupCardProps = {
  bundles: CreditTopupBundleCard[];
  creditsPerUsd: number;
  loadingBundleKey: string | null;
  onPurchase: (bundleKey: string) => void;
  disabled?: boolean;
  className?: string;
};

export function CreditTopupCard({
  bundles,
  creditsPerUsd,
  loadingBundleKey,
  onPurchase,
  disabled = false,
  className,
}: CreditTopupCardProps) {
  const tc = useTranslations("common");
  const t = useTranslations("billingPage");
  const format = useFormatter();

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
        <Sparkles className="w-4 h-4" />
        <span>{t("topupTitle")}</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-muted/30 p-5 space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-foreground">{t("topupDescription")}</p>
          <p className="text-xs text-muted-foreground">
            {t("topupRate", { rate: format.number(creditsPerUsd) })}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {bundles.map((bundle) => {
            const isLoading = loadingBundleKey === bundle.key;
            const buttonDisabled = disabled || Boolean(loadingBundleKey);
            return (
              <div
                key={bundle.key}
                className="rounded-lg border border-border/50 bg-background/70 p-4 space-y-3"
              >
                <div className="space-y-1">
                  <div className="text-lg font-semibold tabular-nums">
                    {format.number(bundle.credits)} {tc("credits")}
                  </div>
                  <div className="text-sm text-muted-foreground tabular-nums">
                    {format.number(bundle.amountCents / 100, {
                      style: "currency",
                      currency: bundle.currency.toUpperCase(),
                    })}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={buttonDisabled}
                  onClick={() => onPurchase(bundle.key)}
                >
                  {isLoading ? t("topupProcessing") : t("topupBuyButton")}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
