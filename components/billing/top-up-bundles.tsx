"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useFormatter, useTranslations } from "next-intl";
import { toast as sonnerToast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, X } from "@/components/icons";
import { UpgradeConfirmationDialog } from "@/components/billing/upgrade-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
import { api } from "@/convex/_generated/api";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { topUpBundles, type TopUpBundle } from "@/lib/billing/catalog";
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
  // Named as it was when the purchase started: the person may have moved to another workspace by the time it lands.
  const current = useCurrentWorkspace();
  const organization = current?.kind === "organization" ? current.name : null;
  const buyCredits = useWorkspaceAction(api.billing.actions.buyCredits);
  const [buying, setBuying] = useState<number | null>(null);
  const [asking, setAsking] = useState<TopUpBundle | null>(null);

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
      const amount = format.number(credits);
      sonnerToast.success(t("creditsAddedTitle"), { description: organization ? t("creditsAddedToOrganization", { amount, organization }) : t("creditsAddedDescription", { amount }) });
    } catch (error) {
      console.error("[BILLING] Failed to buy credits:", error);
      toast.billing.checkoutFailed(error);
    } finally {
      setBuying(null);
    }
  };

  return { bundles: enabled && catalog ? topUpBundles(catalog) : [], buying, buy, asking, setAsking };
}

/** The "Top up" list. `row` lays the amounts side by side, where a page has no column for them. */
export function TopUpBundles({ topUps, row = false, className }: { topUps: ReturnType<typeof useTopUps>; row?: boolean; className?: string }) {
  const t = useTranslations("billingPage");
  const format = useFormatter();
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", trailingZeroDisplay: "stripIfInteger" });
  const { bundles, buying, buy, asking, setAsking } = topUps;
  const { account } = useSharedSubscriptionState();
  return (
    <div className={cn("flex flex-col", className)}>
      <p className="px-5 pb-1 pt-4 text-xs font-medium text-muted-foreground">{t("topUp")}</p>
      <div className={cn("flex-1 p-2", row ? "grid grid-cols-[repeat(auto-fit,minmax(min(11rem,100%),1fr))] gap-1" : "flex flex-col justify-center")}>
        {bundles.map((bundle) => (
          <button
            key={bundle.credits}
            type="button"
            disabled={buying !== null}
            onClick={() => setAsking(bundle)}
            aria-label={t("buyBundle", { credits: format.number(bundle.credits), price: money(bundle.amount) })}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-muted disabled:opacity-60"
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
      <TopUpConfirmation bundle={asking} account={account} onClose={() => setAsking(null)} onConfirm={(credits) => void buy(credits)} />
    </div>
  );
}

/**
 * Asks before a purchase: a saved card is charged as soon as `buyCredits` runs, with no page of Stripe's in between.
 * It closes on the answer, and the amount's own row shows the purchase under way.
 */
export function TopUpConfirmation({ bundle, account, onClose, onConfirm }: { bundle: TopUpBundle | null; account: { balance: number; card?: { brand: string; last4: string } } | null | undefined; onClose: () => void; onConfirm: (credits: number) => void }) {
  const t = useTranslations("billingPage");
  const format = useFormatter();
  const current = useCurrentWorkspace();
  // The last amount stays in the dialog while it fades out.
  const [shown, setShown] = useState(bundle);
  if (bundle && bundle !== shown) setShown(bundle);
  const balance = Math.floor(account?.balance ?? 0);
  return (
    <UpgradeConfirmationDialog
      open={bundle !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown ? t("topUpTitle", { credits: format.number(shown.credits) }) : undefined}
      description={current?.kind === "organization" ? t("topUpForOrganization", { organization: current.name }) : undefined}
      confirmLabel={t("topUpConfirm")}
      totalLabel={t("topUpDue")}
      labels={{ from: t("topUpBalanceNow"), to: t("topUpBalanceAfter") }}
      isConfirming={false}
      onConfirm={() => {
        if (!shown) return;
        onConfirm(shown.credits);
        onClose();
      }}
      cardBrand={account?.card?.brand}
      cardLast4={account?.card?.last4}
      preview={
        shown && {
          currency: "USD",
          immediateChargeCents: Math.round(shown.amount * 100),
          currentPlan: format.number(balance),
          targetPlan: format.number(balance + shown.credits),
          targetPlanCreditsPerMonth: 0,
          lineItems: [],
        }
      }
    />
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
    <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/10 py-2 ps-4 pe-2 text-sm ink-success">
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
