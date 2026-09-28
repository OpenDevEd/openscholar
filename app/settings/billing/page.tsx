"use client";
"use no memo"; // try/finally in handlers

import { useAction } from "convex/react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Calendar, AlertCircle, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useAppToast } from "@/lib/toast";
import { toast as sonnerToast } from "sonner";
import { CreditBalanceCard } from "@/components/billing/credit-balance-card";
import { CreditTopupCard, type CreditTopupBundleCard } from "@/components/billing/credit-topup-card";
import { UsageHistory } from "@/components/billing/usage-history";
import { useRouter, useSearchParams } from "next/navigation";
import { useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { defaultPlanId, findPlan, planCreditCap, topUpBundles } from "@/lib/billing/catalog";

export default function BillingPage() {
  const t = useTranslations("billingPage");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const subscriptionState = useSharedSubscriptionState();
  const account = subscriptionState.account;
  const creditsEnabled = useFeatureFlagForPlan("credits.enabled", subscriptionState.planFeatures);
  const topupsEnabled = useFeatureFlagForPlan("credits.topups", subscriptionState.planFeatures);
  const subscriptionsEnabled = useFeatureFlagForPlan(
    "subscriptions.enabled",
    subscriptionState.planFeatures,
  );
  const catalog = subscriptionState.catalog;
  const topUpBundleCards: CreditTopupBundleCard[] = (catalog ? topUpBundles(catalog) : []).map(
    (bundle) => ({
      key: String(bundle.credits),
      credits: bundle.credits,
      amountCents: Math.round(bundle.amount * 100),
      currency: "usd",
    }),
  );
  const openPortal = useAction(api.billing.actions.openPortal);
  const keepPlan = useAction(api.billing.actions.keepPlan);
  const buyCredits = useAction(api.billing.actions.buyCredits);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingTopupBundle, setLoadingTopupBundle] = useState<string | null>(null);

  const plan = subscriptionState.resolvedPlan ?? "";
  const planInfo = catalog ? findPlan(catalog, plan) : undefined;
  const planName = (id: string) => (catalog && findPlan(catalog, id)?.name) || id;
  const onPaidPlan = subscriptionState.onDefaultPlan === false;
  const showUpgradeCta = !onPaidPlan && !account?.hasPaid;
  const returnedFrom =
    searchParams.get("checkout") === "success" || searchParams.get("topup") === "success";

  const handleManageSubscription = async () => {
    if (isLoading) return;
    if (showUpgradeCta) {
      if (subscriptionsEnabled) router.push("/pricing");
      else toast.error(tc("somethingWentWrong"), t("upgradesUnavailable"));
      return;
    }
    try {
      setIsLoading(true);
      posthog.capture("billing_portal_opened", { current_plan: plan, context: "billing_page" });
      window.location.href = await openPortal({});
    } catch (error) {
      console.error("[BILLING] Error:", error);
      toast.billing.portalFailed(error);
      setIsLoading(false);
    }
  };

  const handleKeepCurrentPlan = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      posthog.capture("pending_change_canceled", { current_plan: plan, context: "billing_page" });
      await keepPlan({});
    } catch (error) {
      console.error(error);
      toast.error(tc("somethingWentWrong"), t("failedToLoadDetails"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTopupPurchase = async (bundleKey: string) => {
    if (loadingTopupBundle) return;
    const credits = Number(bundleKey);
    posthog.capture("credit_topup_clicked", { credits });
    try {
      setLoadingTopupBundle(bundleKey);
      const { url } = await buyCredits({ credits });
      if (url) {
        window.location.href = url;
        return;
      }
      sonnerToast.success(t("creditsAddedTitle"), {
        description: t("creditsAddedDescription", { amount: format.number(credits) }),
      });
    } catch (error) {
      console.error("[BILLING] Failed to buy credits:", error);
      toast.billing.checkoutFailed(error);
    } finally {
      setLoadingTopupBundle(null);
    }
  };

  const formatDate = (ms: number) =>
    format.dateTime(new Date(ms), { year: "numeric", month: "short", day: "numeric" });
  const price = onPaidPlan ? planInfo?.price : undefined;
  const endsWithoutRenewal =
    account?.nextPlan !== undefined && catalog !== null && account.nextPlan === defaultPlanId(catalog);
  const intervalLabel = (interval: string) =>
    interval === "month" ? t("intervalMonth") : interval === "year" ? t("intervalYear") : interval;
  const planChange = account?.changesAt !== undefined && account.nextPlan && !endsWithoutRenewal;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-border/40 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("billingAndPlans")}</h2>
          <p className="text-sm text-muted-foreground">{t("manageSubscription")}</p>
        </div>
        {(subscriptionsEnabled || !showUpgradeCta) && (
          <Button
            data-testid="billing-manage-button"
            variant={showUpgradeCta ? "default" : "outline"}
            onClick={handleManageSubscription}
            disabled={isLoading}
            size="sm"
            style={{ transition: "none" }}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {showUpgradeCta ? t("upgradePlan") : t("manageSubscriptionBtn")}
          </Button>
        )}
      </div>

      {subscriptionState.isSettling || !account ? (
        <div className="p-6 space-y-8 max-w-2xl">
          <div className="rounded-xl border border-border/50 bg-muted/30 p-4 space-y-3">
            <div className="h-8 w-32 bg-muted animate-pulse rounded" />
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-8 max-w-2xl">
          {returnedFrom && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-xl bg-green-500/10 p-3 text-sm text-green-700"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {t("paymentReceived")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={tc("close")}
                onClick={() => router.replace("/settings/billing")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {creditsEnabled && topupsEnabled && (
            <div id="topup-section">
              <CreditTopupCard
                bundles={topUpBundleCards}
                loadingBundleKey={loadingTopupBundle}
                onPurchase={handleTopupPurchase}
                disabled={isLoading}
              />
            </div>
          )}

          {(subscriptionsEnabled || !showUpgradeCta) && (
            <div className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
              <div className="p-4 flex items-center justify-between border-b border-border/40 min-h-[80px]">
                <div className="flex items-center gap-3">
                  <span data-testid="billing-plan-name" className="text-2xl font-bold capitalize">
                    {t("planLabel", { plan: planName(plan) })}
                  </span>
                  <span
                    data-testid="billing-status-badge"
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${account.pastDue ? "bg-yellow-500/10 text-yellow-600" : "bg-green-500/10 text-green-600"}`}
                  >
                    {account.pastDue ? t("statusPastDue") : tc("active")}
                  </span>
                </div>
                {price && (
                  <div className="text-right">
                    <div className="text-lg font-bold">
                      {format.number(price.amount, { style: "currency", currency: "USD" })}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">
                      {t("perInterval", { interval: intervalLabel(price.interval) })}
                    </div>
                  </div>
                )}
              </div>

              {account.pastDue && (
                <div className="bg-red-500/10 p-3 text-red-700 text-sm flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{t("paymentFailedNotice")}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManageSubscription}
                    disabled={isLoading}
                    className="flex-shrink-0"
                  >
                    {t("updatePaymentMethod")}
                  </Button>
                </div>
              )}

              {planChange && account.changesAt !== undefined && (
                <div
                  data-testid="billing-pending-change-banner"
                  className="bg-blue-500/10 p-3 text-blue-700 text-sm flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span>
                      {t("scheduledChangeTo")}{" "}
                      <span className="font-semibold">{planName(account.nextPlan!)}</span>{" "}
                      {tc("onDate", { date: formatDate(account.changesAt) })}.
                    </span>
                  </div>
                  <Button
                    data-testid="billing-keep-plan-button"
                    variant="outline"
                    size="sm"
                    onClick={handleKeepCurrentPlan}
                    disabled={isLoading}
                  >
                    {tc("keepCurrentPlan")}
                  </Button>
                </div>
              )}

              {onPaidPlan ? (
                <div className="bg-background/50 p-4 min-h-[60px]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {(account.renewsAt ?? account.changesAt) !== undefined && (
                      <div data-testid="billing-renewal-date" className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {account.renewsAt !== undefined ? t("renewsOn") : t("expiresOn")}
                        </span>
                        <span className="font-medium">
                          {formatDate((account.renewsAt ?? account.changesAt)!)}
                        </span>
                      </div>
                    )}
                    {account.card && (
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-muted-foreground" />
                        <span className="capitalize text-muted-foreground">{account.card.brand}</span>
                        <span className="font-medium">•••• {account.card.last4}</span>
                      </div>
                    )}
                  </div>
                  {endsWithoutRenewal && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        data-testid="billing-keep-plan-button"
                        variant="outline"
                        size="sm"
                        onClick={handleKeepCurrentPlan}
                        disabled={isLoading}
                      >
                        {tc("keepCurrentPlan")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-background/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {t("upgradeDescription")}
                </div>
              )}
            </div>
          )}

          {creditsEnabled && (
            <CreditBalanceCard
              free={account.balance - account.purchased}
              paid={account.purchased}
              total={account.balance}
              creditsPerMonth={planInfo?.credits?.interval === "month" ? planInfo.credits.included : 0}
              freeCreditCap={catalog ? planCreditCap(catalog, plan) : 0}
            />
          )}

          {creditsEnabled && <UsageHistory />}
        </div>
      )}
    </div>
  );
}
