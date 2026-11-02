"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useFormatter, useTranslations } from "next-intl";
import { toast as sonnerToast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { topUpBundles } from "@/lib/billing/catalog";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { useAppToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useWorkspaceAction } from "@/lib/workspaces/url";

/**
 * The credit amounts on offer in this workspace and the way to buy one: the person's own, or an
 * organization's, which only its admins are shown. Empty when top-ups are off.
 */
export function useTopUps() {
  const t = useTranslations("billingPage");
  const format = useFormatter();
  const toast = useAppToast();
  const { catalog, planFeatures } = useSharedSubscriptionState();
  const enabled = useFeatureFlagForPlan("credits.topups", planFeatures);
  const buyCredits = useWorkspaceAction(api.billing.actions.buyCredits);
  const [buying, setBuying] = useState<number | null>(null);

  const buy = async (credits: number) => {
    if (buying) return;
    posthog.capture("credit_topup_clicked", { credits });
    setBuying(credits);
    try {
      const { url } = await buyCredits({ credits });
      if (url) {
        window.location.href = url;
        return;
      }
      sonnerToast.success(t("creditsAddedTitle"), { description: t("creditsAddedDescription", { amount: format.number(credits) }) });
    } catch (error) {
      console.error("[BILLING] Failed to buy credits:", error);
      toast.billing.checkoutFailed(error);
    } finally {
      setBuying(null);
    }
  };

  return { bundles: enabled && catalog ? topUpBundles(catalog) : [], buying, buy };
}

/** The "Top up" list. `row` lays the amounts side by side, where a page has no column for them. */
export function TopUpBundles({ topUps, row = false, className }: { topUps: ReturnType<typeof useTopUps>; row?: boolean; className?: string }) {
  const t = useTranslations("billingPage");
  const format = useFormatter();
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", trailingZeroDisplay: "stripIfInteger" });
  const { bundles, buying, buy } = topUps;
  return (
    <div id="topup-section" className={cn("flex flex-col", className)}>
      <p className="px-5 pb-1 pt-4 text-xs font-medium text-muted-foreground">{t("topUp")}</p>
      <div className={cn("flex-1 p-2", row ? "grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-1" : "flex flex-col justify-center")}>
        {bundles.map((bundle) => (
          <button
            key={bundle.credits}
            type="button"
            disabled={buying !== null}
            onClick={() => void buy(bundle.credits)}
            aria-label={t("buyBundle", { credits: format.number(bundle.credits), price: money(bundle.amount) })}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
          >
            <span className="flex-1 text-sm font-semibold tabular-nums">+{format.number(bundle.credits)}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{money(bundle.amount)}</span>
            {buying === bundle.credits ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <ArrowRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Says a payment went through, on the billing page Stripe's checkout comes back to. */
export function PaymentReceived() {
  const t = useTranslations("billingPage");
  const tc = useTranslations("common");
  const router = useWorkspaceRouter();
  const searchParams = useSearchParams();
  if (searchParams.get("checkout") !== "success" && searchParams.get("topup") !== "success") return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/10 py-2 pl-4 pr-2 text-sm ink-success">
      <span className="flex items-center gap-2">
        <CheckCircle2 className="size-4" />
        {t("paymentReceived")}
      </span>
      <Button variant="ghost" size="icon" className="size-7" aria-label={tc("close")} onClick={() => router.replace("/settings/billing")}>
        <X />
      </Button>
    </div>
  );
}
