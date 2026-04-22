"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Coins, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";

export type CreditTopupBundleCard = {
  key: string;
  credits: number;
  amountCents: number;
  currency: "usd";
};

type CreditTopupCardProps = {
  bundles: CreditTopupBundleCard[];
  loadingBundleKey: string | null;
  onPurchase: (bundleKey: string) => void;
  disabled?: boolean;
  className?: string;
};

export function CreditTopupCard({
  bundles,
  loadingBundleKey,
  onPurchase,
  disabled = false,
  className,
}: CreditTopupCardProps) {
  const tc = useTranslations("common");
  const t = useTranslations("billingPage");
  const format = useFormatter();
  const heroIdx = bundles.length >= 3 ? Math.floor(bundles.length / 2) : -1;

  return (
    <div className={cn("grid gap-4 md:grid-cols-3", className)}>
      {bundles.map((bundle, idx) => {
        const isHero = idx === heroIdx;
        const isLoading = loadingBundleKey === bundle.key;
        const btnDisabled = disabled || Boolean(loadingBundleKey);
        return (
          <motion.div
            key={bundle.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            data-bundle-key={bundle.key}
            data-hero={isHero ? "true" : undefined}
            className={cn(
              "group relative flex flex-col overflow-hidden rounded-2xl p-6 transition-all duration-200 hover:-translate-y-0.5",
              isHero
                ? "text-primary-foreground bg-[radial-gradient(120%_120%_at_0%_0%,var(--primary-400)_0%,var(--primary-600)_55%,var(--primary-700)_100%)] shadow-[var(--shadow-glow)] hover:shadow-xl"
                : "bg-muted/25 hover:bg-muted/50 hover:shadow-md",
            )}
          >
            {isHero && (
              <span
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/15 blur-2xl"
              />
            )}

            <span
              aria-hidden
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-xl",
                isHero
                  ? "bg-white/15 ring-1 ring-white/25 backdrop-blur-sm"
                  : "bg-primary/10 text-primary ring-1 ring-primary/15",
              )}
            >
              <Coins className="h-5 w-5" />
            </span>

            <div className="relative mt-6 flex items-baseline gap-1.5">
              <span className="text-4xl font-medium tabular-nums tracking-tight">
                {format.number(bundle.credits)}
              </span>
              <Coins
                className={cn("h-4 w-4", isHero ? "text-primary-foreground/60" : "text-primary/60")}
                aria-hidden
              />
            </div>
            <span
              className={cn(
                "relative mt-1 text-sm",
                isHero ? "text-primary-foreground/75" : "text-muted-foreground",
              )}
            >
              {tc("credits")}
            </span>

            <div className="relative mt-5 text-2xl font-semibold tabular-nums tracking-tight">
              {format.number(bundle.amountCents / 100, {
                style: "currency",
                currency: bundle.currency.toUpperCase(),
                maximumFractionDigits: 0,
              })}
            </div>

            <Button
              size="sm"
              disabled={btnDisabled}
              onClick={() => onPurchase(bundle.key)}
              data-loading={isLoading ? "true" : undefined}
              className={cn(
                "relative mt-6 h-10 w-full justify-between rounded-xl border-0 text-sm",
                isHero
                  ? "bg-primary-foreground text-primary shadow-sm hover:bg-primary-foreground/90"
                  : "bg-foreground text-background hover:bg-foreground/90",
              )}
            >
              <span className="inline-flex items-center gap-2">
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Coins className="h-4 w-4" aria-hidden />
                )}
                {isLoading ? t("topupProcessing") : t("topupBuyButton")}
              </span>
              {!isLoading && (
                <ArrowRight
                  className="h-4 w-4 opacity-70 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                  aria-hidden
                />
              )}
            </Button>
          </motion.div>
        );
      })}
    </div>
  );
}
