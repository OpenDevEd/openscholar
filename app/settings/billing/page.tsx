"use client";
"use no memo"; // try/finally in handlers

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Calendar, AlertCircle } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useAppToast } from "@/lib/toast";
import { CreditBalanceCard } from "@/components/billing/credit-balance-card";
import { useRouter } from "next/navigation";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { isEntitledStatus } from "@/lib/billing/entitlements";

export default function BillingPage() {
  const t = useTranslations("billingPage");
  const toast = useAppToast();
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const subscriptionState = useSubscriptionState();
  const subscription = subscriptionState.subscription;
  const creditBalanceQuery = useProtectedQuery(api.credits.queries.getMyBalance, {});
  const grantDiagnosticsQuery = useProtectedQuery(
    (api).credits.queries.getLatestGrantStatus,
    {},
  );
  const creditBalance = creditBalanceQuery.data;
  const grantDiagnostics = grantDiagnosticsQuery.data;
  const createPortalSession = useAction(
    api.subscriptions.actions.createPortalSession,
  );
  const changePlan = useAction((api as any).subscriptions.actions.changePlan);
  const getSubscriptionDetails = useAction(
    api.subscriptions.actions.getSubscriptionDetails,
  );

  const [isLoading, setIsLoading] = useState(false);
  const [navStartTime, setNavStartTime] = useState<number | null>(null);

  // Reset isLoading if we've been in loading state for too long (handles back navigation from Stripe)
  useEffect(() => {
    if (isLoading && navStartTime) {
      const elapsed = Date.now() - navStartTime;
      // If we've been loading for more than 5 seconds, something went wrong - reset
      if (elapsed > 5000) {
        console.log("[BILLING] Resetting stuck loading state");
        setIsLoading(false);
        setNavStartTime(null);
      }
    }
  });

  // Debug: track isLoading changes
  useEffect(() => {
    console.log("[BILLING] isLoading changed:", isLoading);
  }, [isLoading]);
  const [details, setDetails] = useState<{
    amount: number;
    currency: string;
    interval: string;
    currentPeriodEnd: number;
    currentPriceId: string;
    status: string;
    entitlementState: "entitled" | "payment_pending" | "not_entitled";
    entitlementMessage?: string;
    cancelAtPeriodEnd: boolean;
    hasPendingChange: boolean;
    pendingTargetPriceId?: string;
    pendingTargetPlan?: "free" | "go" | "pro" | "enterprise";
    pendingEffectiveDate?: number;
    cardBrand?: string;
    cardLast4?: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  // Fetch detailed info from Stripe on mount if user has a paid plan
  useEffect(() => {
    if (subscription && subscription.plan !== "free") {
      setIsFetchingDetails(true);
      getSubscriptionDetails({})
        .then((result) => {
          if (result.status === "success" && result.data) {
            setDetails(result.data);
            setErrorMsg(null);
          } else {
            console.error("Stripe fetch error:", result.error);
            setErrorMsg(result.error || t("failedToLoadDetails"));
          }
        })
        .catch((err) => {
          console.error("Failed to fetch details", err);
          setErrorMsg(t("networkErrorFetchingDetails"));
        })
        .finally(() => setIsFetchingDetails(false));
    } else if (subscription && subscription.plan === "free") {
      // Clear details when subscription becomes free (after cancellation)
      setDetails(null);
      setErrorMsg(null);
      setIsFetchingDetails(false);
    }
  }, [subscription]); // Intentional dependency for 'getSubscriptionDetails' omission to avoid loops if reference unstable

  const handleManageSubscription = async () => {
    console.log(`[BILLING] ${performance.now().toFixed(1)}ms handleManageSubscription called`, { isLoading, showUpgradeCta, isSettling: subscriptionState.isSettling });
    // Prevent multiple clicks during loading
    if (isLoading) {
      console.log("[BILLING] Blocked - already loading");
      return;
    }

    // Route truly free users to pricing. If a Stripe subscription/customer is linked,
    // always prefer portal management (including non-entitled states like unpaid).
    if (showUpgradeCta) {
      console.log("[BILLING] Navigating to pricing");
      router.push("/pricing");
      return;
    }

    // Otherwise, open the portal
    try {
      console.log(`[BILLING] ${performance.now().toFixed(1)}ms Before setIsLoading(true)`);
      setNavStartTime(Date.now());
      setIsLoading(true);
      console.log(`[BILLING] ${performance.now().toFixed(1)}ms After setIsLoading(true), calling action`);
      const { url } = await createPortalSession({});
      console.log("[BILLING] createPortalSession returned", { url });
      if (url) {
        console.log("[BILLING] Navigating to", url);
        window.location.href = url;
      }
    } catch (error) {
      console.error("[BILLING] Error:", error);
      toast.billing.portalFailed();
      setIsLoading(false);
      setNavStartTime(null);
    }
  };

  const handleKeepCurrentPlan = async () => {
    if (!details?.currentPriceId) return;
    if (isLoading) return;

    try {
      setIsLoading(true);
      const result = await changePlan({ targetPriceId: details.currentPriceId });
      toast.success("Plan updated", result.message);

      const refreshed = await getSubscriptionDetails({});
      if (refreshed.status === "success" && refreshed.data) {
        setDetails(refreshed.data);
      }
    } catch (error) {
      toast.error(tc("somethingWentWrong"), t("failedToLoadDetails"));
      console.error(error);
    } finally {
      setIsLoading(false);
      setNavStartTime(null);
    }
  };

  let displayPlan: "free" | "go" | "pro" | "enterprise" = "free";
  if (subscription?.plan) {
    displayPlan = subscription.plan;
  }
  const effectivePlan: "free" | "go" | "pro" | "enterprise" =
    subscriptionState.resolvedPlan ?? "free";
  let status = "inactive";
  if (subscription?.status) {
    status = subscription.status;
  }
  const hasBillingLink = Boolean(
    subscription?.stripeSubscriptionId || subscription?.stripeCustomerId,
  );
  const showUpgradeCta = effectivePlan === "free" && !hasBillingLink;
  const creditsPerMonth = subscriptionState.isEntitled
    ? (subscription?.creditsPerMonth ?? 0)
    : 0;

  const statusLabels: Record<string, string> = {
    active: tc("active"),
    inactive: tc("inactive"),
    past_due: t("statusPastDue"),
    canceled: t("statusCanceled"),
    trialing: t("statusTrialing"),
    incomplete: t("statusIncomplete"),
    incomplete_expired: t("statusIncompleteExpired"),
    unpaid: t("statusUnpaid"),
    paused: t("statusPaused"),
  };
  const inGracePeriod = isEntitledStatus(status) && status !== "active" && status !== "trialing";
  const hasPendingChange = Boolean(details?.hasPendingChange);
  const isPaymentPending =
    status === "incomplete" || details?.entitlementState === "payment_pending";
  const paymentPendingMessage =
    details?.entitlementMessage ||
    "Payment is pending. Complete payment in Stripe Billing Portal to activate credits.";

  // Format currency
  const formatPrice = (amount: number, currency: string) => {
    return format.number(amount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  };

  // Debug logging for state changes
  const renderId = useRef(0);
  renderId.current++;
  console.log(`[BILLING] ${performance.now().toFixed(1)}ms Render #`, renderId.current, {
    isLoading,
    isSettling: subscriptionState.isSettling,
    settlement: subscriptionState.settlement,
    isDeferred: creditBalanceQuery.isDeferred,
    creditBalance: creditBalance === undefined ? "undefined" : "defined",
    effectivePlan,
    hasBillingLink,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("billingAndPlans")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("manageSubscription")}
          </p>
        </div>
        <Button
          variant={showUpgradeCta ? "default" : "outline"}
          onClick={handleManageSubscription}
          disabled={isLoading}
          size="sm"
          // Prevent button from being re-rendered during loading state change
          style={{ transition: 'none' }}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {showUpgradeCta ? t("upgradePlan") : t("manageSubscriptionBtn")}
        </Button>
      </div>

      {/* Content - show skeleton when data is loading */}
      {subscriptionState.isSettling || creditBalanceQuery.isDeferred || creditBalance === undefined ? (
        <div className="p-6 space-y-8 max-w-2xl">
          {/* Plan Section Skeleton */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
              <CreditCard className="w-4 h-4" />
              <span>{t("subscription")}</span>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/30 p-4 space-y-3">
              <div className="h-8 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </div>
      ) : (
      <div className="p-6 space-y-8 max-w-2xl">
        {/* Plan Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <CreditCard className="w-4 h-4" />
            <span>{t("subscription")}</span>
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
            <div className="p-4 flex items-center justify-between border-b border-border/40 min-h-[80px]">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold capitalize">
                  {t("planLabel", { plan: displayPlan })}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${status === "active" ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-yellow-600"}`}
                >
                  {statusLabels[status] ?? status}
                </span>
              </div>
              {isFetchingDetails ? (
                <div className="text-right space-y-2">
                  <div className="h-6 w-24 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-16 bg-muted animate-pulse rounded ml-auto" />
                </div>
              ) : (
                details && (
                  <div className="text-right">
                    <div className="text-lg font-bold">
                      {formatPrice(details.amount, details.currency)}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">
                      {t("perInterval", {
                        interval: details.interval === "year"
                          ? t("intervalYear")
                          : t("intervalMonth"),
                      })}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Error State */}
            {errorMsg && !showUpgradeCta && (
              <div className="bg-red-500/10 p-3 text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>{errorMsg}</span>
              </div>
            )}

            {inGracePeriod && (
              <div className="bg-amber-500/10 p-3 text-amber-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>{t("gracePeriodNotice")}</span>
              </div>
            )}

            {isPaymentPending && (
              <div className="bg-amber-500/10 p-3 text-amber-700 text-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{paymentPendingMessage}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManageSubscription}
                  disabled={isLoading}
                >
                  Open billing portal
                </Button>
              </div>
            )}

            {hasPendingChange && details && (
              <div className="bg-blue-500/10 p-3 text-blue-700 text-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>
                    Scheduled change to{" "}
                    <span className="font-semibold">
                      {details.pendingTargetPlan ?? "another plan"}
                    </span>
                    {details.pendingEffectiveDate
                      ? ` on ${format.dateTime(new Date(details.pendingEffectiveDate), {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}`
                      : ""}
                    .
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleKeepCurrentPlan}
                  disabled={isLoading || !details.currentPriceId}
                >
                  Keep current plan
                </Button>
              </div>
            )}

            {/* Detailed Info (Only for Paid Plans) */}
            {!showUpgradeCta && (
              <div className="bg-background/50 p-4 min-h-[60px]">
                {isFetchingDetails ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-muted animate-pulse" />
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-muted animate-pulse" />
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                ) : (
                  details && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {details.cancelAtPeriodEnd
                            ? t("expiresOn")
                            : t("renewsOn")}
                        </span>
                        <span className="font-medium">
                          {format.dateTime(new Date(details.currentPeriodEnd), {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>

                      {details.cardLast4 && (
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-muted-foreground" />
                          <span className="capitalize text-muted-foreground">
                            {details.cardBrand}
                          </span>
                          <span className="font-medium">
                            •••• {details.cardLast4}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            {/* Free Plan Empty State */}
            {showUpgradeCta && (
              <div className="bg-background/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {t("upgradeToProDescription")}
              </div>
            )}
          </div>
        </div>

        {/* Credits Section */}
        {creditBalance && (
          <CreditBalanceCard
            freeBalance={creditBalance.free}
            paidBalance={creditBalance.paid}
            totalBalance={creditBalance.total}
            creditsPerMonth={creditsPerMonth}
          />
        )}

        {/* {grantDiagnostics && (
          <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-sm">
            <div className="font-medium mb-1">Last credit grant status</div>
            <div className="text-muted-foreground">
              Event status:{" "}
              <span className="font-medium text-foreground">
                {grantDiagnostics.latestEventStatus ?? "unknown"}
              </span>
              {grantDiagnostics.latestEventClassification
                ? ` (${grantDiagnostics.latestEventClassification})`
                : ""}
            </div>
            {grantDiagnostics.lastGrantAt ? (
              <div className="text-muted-foreground">
                Last successful grant:{" "}
                {format.dateTime(new Date(grantDiagnostics.lastGrantAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            ) : (
              <div className="text-muted-foreground">No successful grant recorded yet.</div>
            )}
            {grantDiagnostics.latestEventError && (
              <div className="text-red-600 mt-1">{grantDiagnostics.latestEventError}</div>
            )}
          </div>
        )} */}

      </div>
      )}
    </div>
  );
}
