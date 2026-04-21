"use client";
"use no memo"; // try/finally in handlers

import { useAction } from "convex/react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Calendar, AlertCircle, Receipt } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useAppToast } from "@/lib/toast";
import { toast as sonnerToast } from "sonner";
import { CreditBalanceCard } from "@/components/billing/credit-balance-card";
import { CreditTopupCard } from "@/components/billing/credit-topup-card";
import { TransactionsPanel } from "@/components/billing/transactions/transactions-panel";
import { useRouter, useSearchParams } from "next/navigation";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { isEntitledStatus } from "@/lib/billing/entitlements";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { getToastMessageKeyForErrorCode } from "@/lib/toast/error-resolver";
import { getFreeCreditCapForPlan } from "@/convex/lib/constants";

export default function BillingPage() {
  const t = useTranslations("billingPage");
  const tToast = useTranslations("toast");
  const toast = useAppToast();
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const txnSearchParams = React.useMemo(() => {
    const obj: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((value, key) => {
      const existing = obj[key];
      if (existing === undefined) {
        obj[key] = value;
      } else if (Array.isArray(existing)) {
        obj[key] = [...existing, value];
      } else {
        obj[key] = [existing, value];
      }
    });
    return obj;
  }, [searchParams]);
  const creditsEnabled = useFeatureFlag("credits.enabled");
  const topupsEnabled = useFeatureFlag("credits.topups");
  const subscriptionsEnabled = useFeatureFlag("subscriptions.enabled");
  const subscriptionState = useSubscriptionState();
  const subscription = subscriptionState.subscription;
  const creditBalanceQuery = useProtectedQuery(api.credits.queries.getMyBalance, {});
  const topupCatalogQuery = useProtectedQuery(api.credits.queries.getTopupCatalog, {});
  const grantDiagnosticsQuery = useProtectedQuery(
    (api).credits.queries.getLatestGrantStatus,
    {},
  );
  const creditBalance = creditBalanceQuery.data;
  const topupCatalog = topupCatalogQuery.data;
  const grantDiagnostics = grantDiagnosticsQuery.data;
  const createPortalSession = useAction(
    api.subscriptions.actions.createPortalSession,
  );
  const changePlan = useAction(api.subscriptions.actions.changePlan);
  const createTopupCheckoutSession = useAction(
    api.credits.actions.createTopupCheckoutSession,
  );
  const getSubscriptionDetails = useAction(
    api.subscriptions.actions.getSubscriptionDetails,
  );

  const [isLoading, setIsLoading] = useState(false);
  const [loadingTopupBundle, setLoadingTopupBundle] = useState<string | null>(null);
  const [navStartTime, setNavStartTime] = useState<number | null>(null);
  const topupStatusToastShown = useRef<string | null>(null);

  // Reset isLoading if we've been in loading state for too long (handles back navigation from Stripe)
  useEffect(() => {
    if (isLoading && navStartTime) {
      const elapsed = Date.now() - navStartTime;
      if (elapsed > 5000) {
        setIsLoading(false);
        setNavStartTime(null);
      }
    }
  });

  // Handle return from Stripe Checkout
  useEffect(() => {
    const topupStatus = searchParams.get("topup");
    const checkoutSuccess = searchParams.get("success");
    const checkoutCanceled = searchParams.get("canceled");

    if (topupStatus === "success" && topupStatusToastShown.current !== "success") {
      topupStatusToastShown.current = "success";
      posthog.capture("credit_topup_completed");
      sonnerToast.success(t("creditsAddedTitle"));
      router.replace("/settings/billing");
    }

    if (topupStatus === "canceled" && topupStatusToastShown.current !== "canceled") {
      topupStatusToastShown.current = "canceled";
      posthog.capture("credit_topup_abandoned");
      router.replace("/settings/billing");
    }

    if (checkoutSuccess === "true") {
      posthog.capture("checkout_completed");
    }

    if (checkoutCanceled === "true") {
      posthog.capture("checkout_abandoned");
    }
  }, [searchParams, router, t]);
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
  const [detailsErrorCode, setDetailsErrorCode] = useState<string | null>(null);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  // Fetch detailed info from Stripe on mount if user has a paid plan
  useEffect(() => {
    if (subscription && subscription.plan !== "free") {
      setIsFetchingDetails(true);
      getSubscriptionDetails({})
        .then((result) => {
          if (result.status === "success" && result.data) {
            setDetails(result.data);
            setDetailsErrorCode(null);
          } else {
            const errorCode = (result as { errorCode?: string }).errorCode;
            console.error("Stripe fetch error code:", errorCode);
            setDetailsErrorCode(errorCode || "BILLING_STRIPE_ERROR");
          }
        })
        .catch((err) => {
          console.error("Failed to fetch details", err);
          setDetailsErrorCode("BILLING_NETWORK_ERROR");
        })
        .finally(() => setIsFetchingDetails(false));
    } else if (subscription && subscription.plan === "free") {
      // Clear details when subscription becomes free (after cancellation)
      setDetails(null);
      setDetailsErrorCode(null);
      setIsFetchingDetails(false);
    }
  }, [subscription]); // Intentional dependency for 'getSubscriptionDetails' omission to avoid loops if reference unstable

  const detailsErrorMessage = React.useMemo(() => {
    if (!detailsErrorCode) return null;
    const toastKey = getToastMessageKeyForErrorCode(detailsErrorCode);
    return toastKey ? tToast(toastKey) : t("failedToLoadDetails");
  }, [detailsErrorCode, t, tToast]);

  const hasBillingLink = Boolean(
    subscription?.stripeSubscriptionId || subscription?.stripeCustomerId,
  );
  const effectivePlan: "free" | "go" | "pro" | "enterprise" =
    subscriptionState.resolvedPlan ?? "free";
  const showUpgradeCta = effectivePlan === "free" && !hasBillingLink;

  // Track billing page view once data is loaded
  const billingViewTracked = useRef(false);
  useEffect(() => {
    if (!subscriptionState.isSettling && creditBalance !== undefined && !billingViewTracked.current) {
      billingViewTracked.current = true;
      posthog.capture("billing_page_viewed", {
        current_plan: effectivePlan,
        credit_balance: creditBalance?.total ?? 0,
        is_entitled: subscriptionState.isEntitled,
      });
    }
  }, [subscriptionState.isSettling, creditBalance, effectivePlan, subscriptionState.isEntitled]);

  // Redirect non-subscribers away only when both subscriptions AND credits are disabled
  useEffect(() => {
    if (
      !subscriptionState.isSettling &&
      !subscriptionsEnabled &&
      !creditsEnabled &&
      showUpgradeCta
    ) {
      router.replace("/settings");
    }
  }, [
    subscriptionState.isSettling,
    subscriptionsEnabled,
    creditsEnabled,
    showUpgradeCta,
    router,
  ]);

  const handleManageSubscription = async () => {
    // Prevent multiple clicks during loading
    if (isLoading) {
      return;
    }

    // Route truly free users to pricing. If a Stripe subscription/customer is linked,
    // always prefer portal management (including non-entitled states like unpaid).
    // When subscriptions disabled, do not route to pricing.
    if (showUpgradeCta && subscriptionsEnabled) {
      router.push("/pricing");
      return;
    }
    if (showUpgradeCta && !subscriptionsEnabled) {
      toast.error(tc("somethingWentWrong"), t("upgradesUnavailable"));
      return;
    }

    // Otherwise, open the portal
    try {
      setNavStartTime(Date.now());
      setIsLoading(true);
      posthog.capture("billing_portal_opened", {
        current_plan: effectivePlan,
        context: "billing_page",
      });
      const { url } = await createPortalSession({});
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("[BILLING] Error:", error);
      toast.billing.portalFailed(error);
      setIsLoading(false);
      setNavStartTime(null);
    }
  };

  const handleKeepCurrentPlan = async () => {
    if (!details?.currentPriceId) return;
    if (isLoading) return;

    try {
      setIsLoading(true);
      posthog.capture("pending_change_canceled", {
        current_plan: effectivePlan,
        context: "billing_page",
      });
      const result = await changePlan({ targetPriceId: details.currentPriceId });

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

  const handleTopupPurchase = async (bundleKey: string) => {
    if (loadingTopupBundle) return;

    const bundle = topupCatalog?.bundles.find((b) => b.key === bundleKey);
    posthog.capture("credit_topup_clicked", {
      bundle_key: bundleKey,
      credits: bundle?.credits,
      amount_cents: bundle?.amountCents,
    });

    try {
      setLoadingTopupBundle(bundleKey);
      const { url } = await createTopupCheckoutSession({ bundleKey });
      if (url) {
        posthog.capture("credit_topup_checkout_created", {
          bundle_key: bundleKey,
          credits: bundle?.credits,
          amount_cents: bundle?.amountCents,
        });
        window.location.href = url;
        return;
      }
      toast.billing.checkoutFailed();
    } catch (error) {
      console.error("[BILLING] Failed to start top-up checkout:", error);
      toast.billing.checkoutFailed(error);
    } finally {
      setLoadingTopupBundle(null);
    }
  };

  let displayPlan: "free" | "go" | "pro" | "enterprise" = "free";
  if (subscription?.plan) {
    displayPlan = subscription.plan;
  }
  let status = "inactive";
  if (subscription?.status) {
    status = subscription.status;
  }
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
    (status === "incomplete" || details?.entitlementState === "payment_pending") &&
    status !== "past_due";
  const paymentPendingMessage =
    details?.entitlementMessage ||
    t("paymentPendingDefault");

  // Format currency
  const formatPrice = (amount: number, currency: string) => {
    return format.number(amount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
  };

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
        {(subscriptionsEnabled || !showUpgradeCta) && (
          <Button
            data-testid="billing-manage-button"
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
        )}
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
        {(subscriptionsEnabled || !showUpgradeCta) && <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <CreditCard className="w-4 h-4" />
            <span>{t("subscription")}</span>
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
            <div className="p-4 flex items-center justify-between border-b border-border/40 min-h-[80px]">
              <div className="flex items-center gap-3">
                <span data-testid="billing-plan-name" className="text-2xl font-bold capitalize">
                  {t("planLabel", { plan: displayPlan })}
                </span>
                <span
                  data-testid="billing-status-badge"
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
            {detailsErrorMessage && !showUpgradeCta && (
              <div className="bg-red-500/10 p-3 text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>{detailsErrorMessage}</span>
              </div>
            )}

            {status === "past_due" && (
              <div className="bg-red-500/10 p-3 text-red-700 text-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {t("paymentFailedNotice")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManageSubscription}
                  disabled={isLoading}
                  className="flex-shrink-0"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("updatePaymentMethod")}
                </Button>
              </div>
            )}

            {inGracePeriod && status !== "past_due" && (
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
                  {tc("openBillingPortal")}
                </Button>
              </div>
            )}

            {hasPendingChange && details && (
              <div data-testid="billing-pending-change-banner" className="bg-blue-500/10 p-3 text-blue-700 text-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>
                    {t("scheduledChangeTo")}{" "}
                    <span className="font-semibold">
                      {details.pendingTargetPlan ?? tc("anotherPlan")}
                    </span>
                    {details.pendingEffectiveDate
                      ? ` ${tc("onDate", { date: format.dateTime(new Date(details.pendingEffectiveDate), {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }) })}`
                      : ""}
                    .
                  </span>
                </div>
                <Button
                  data-testid="billing-keep-plan-button"
                  variant="outline"
                  size="sm"
                  onClick={handleKeepCurrentPlan}
                  disabled={isLoading || !details.currentPriceId}
                >
                  {tc("keepCurrentPlan")}
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
                      <div data-testid="billing-renewal-date" className="flex items-center gap-2">
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
        </div>}

        {/* Credits Section */}

        {creditsEnabled && creditBalance && (
          <CreditBalanceCard
            freeBalance={creditBalance.free}
            paidBalance={creditBalance.paid}
            totalBalance={creditBalance.total}
            creditsPerMonth={creditsPerMonth}
            freeCreditCap={getFreeCreditCapForPlan(effectivePlan)}
          />
        )}

        {creditsEnabled &&
          topupsEnabled &&
          topupCatalog?.enabled &&
          topupCatalog.bundles.length > 0 && (
            <div id="topup-section">
              <CreditTopupCard
                bundles={topupCatalog.bundles}
                creditsPerUsd={topupCatalog.creditsPerUsd}
                loadingBundleKey={loadingTopupBundle}
                onPurchase={handleTopupPurchase}
                disabled={isLoading}
              />
            </div>
          )}

        {creditsEnabled && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
              <Receipt className="w-4 h-4" />
              <span>{t("transactions.title")}</span>
            </div>
            <TransactionsPanel searchParams={txnSearchParams} />
          </div>
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
