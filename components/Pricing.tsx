"use client";
"use no memo"; // try/finally in handlers

import React, { useEffect, useState, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getPlanTier } from "@/convex/lib/constants";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Check,
  Loader2,
  Building2,
  Zap,
  Rocket,
  CreditCard,
  BookOpen,
} from "lucide-react";
import { useAppToast } from "@/lib/toast";
import { toast as sonnerToast } from "sonner";
import {
  UpgradeConfirmationDialog,
  type UpgradePreview,
} from "@/components/billing/upgrade-confirmation-dialog";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useTranslations, useFormatter } from "next-intl";

type PlanPrice = {
  id: string;
  amount: number | null;
  currency: string;
  interval: "day" | "week" | "month" | "year" | undefined;
  nickname: string | null;
  metadata: Record<string, string>;
  plan: "free" | "go" | "pro" | "enterprise";
};

type PlanConfig = {
  id: "free" | "go" | "pro" | "enterprise";
  name: string;
  icon: typeof BookOpen;
  description: string;
  features: string[];
  tier: number;
  popular?: boolean;
};

type SubscriptionDetails = {
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
};

export function Pricing() {
  const toast = useAppToast();
  const t = useTranslations("pricing");
  const tc = useTranslations("common");
  const format = useFormatter();

  const FEATURES = useMemo(() => ({
    free: [t("freeFeature1"), t("freeFeature2"), t("freeFeature3")],
    go: [t("goFeature1"), t("goFeature2"), t("goFeature3")],
    pro: [t("proFeature1"), t("proFeature2"), t("proFeature3"), t("proFeature4")],
    enterprise: [t("enterpriseFeature1"), t("enterpriseFeature2"), t("enterpriseFeature3"), t("enterpriseFeature4")],
  }), [t]);

  const PLANS: PlanConfig[] = useMemo(() => [
    { id: "free", name: t("freePlanName"), icon: BookOpen, description: t("freeDescription"), features: FEATURES.free, tier: 0 },
    { id: "go", name: t("goPlanName"), icon: Rocket, description: t("goDescription"), features: FEATURES.go, tier: 10 },
    { id: "pro", name: t("proPlanName"), icon: Zap, description: t("proDescription"), features: FEATURES.pro, tier: 20, popular: true },
    { id: "enterprise", name: t("enterprisePlanName"), icon: Building2, description: t("enterpriseDescription"), features: FEATURES.enterprise, tier: 30 },
  ], [t, FEATURES]);

  const getPlans = useAction(api.subscriptions.actions.getPlans);
  const createCheckoutSession = useAction(
    api.subscriptions.actions.createCheckoutSession,
  );
  const changePlan = useAction(api.subscriptions.actions.changePlan);
  const createPortalSession = useAction(
    api.subscriptions.actions.createPortalSession,
  );
  const getSubscriptionDetails = useAction(
    api.subscriptions.actions.getSubscriptionDetails,
  );
  const getUpgradePreview = useAction(
    api.subscriptions.actions.getUpgradePreview,
  );

  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);
  const [upgradePreview, setUpgradePreview] = useState<(UpgradePreview & { targetPriceId: string }) | null>(null);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isConfirmingUpgrade, setIsConfirmingUpgrade] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [subscriptionDetails, setSubscriptionDetails] = useState<SubscriptionDetails | null>(null);

  // Fetch current subscription
  const { phase, retryUserSync } = useAuthReadiness();
  const subscriptionState = useSubscriptionState();
  const isAuthLoading = subscriptionState.isAuthLoading;
  const isSubscriptionLoading = subscriptionState.isQueryLoading;
  const isAnonymous = subscriptionState.isAnonymous;
  const hasResolvedSubscription = subscriptionState.isReady;
  const isEntitled = subscriptionState.isEntitled;
  const resolvedPlan = subscriptionState.resolvedPlan;
  const resolvedTier = subscriptionState.resolvedTier;

  // Fetch prices using SWR
  const {
    data: prices,
    isLoading: isPricesLoading,
  } = useSWR<PlanPrice[]>(
    "stripe-prices",
    async () => getPlans({}),
    {
      revalidateOnFocus: false,
      revalidateOnMount: true, // Always fetch real Stripe prices on mount
      onError: (err) => {
        console.error("Failed to load Stripe prices", err);
        toast.error(t("failedToLoadPricing"), t("pleaseRefresh"));
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    const stripeSubscriptionId = subscriptionState.subscription?.stripeSubscriptionId;

    if (phase !== "authenticated" || !stripeSubscriptionId) {
      setSubscriptionDetails(null);
      return;
    }

    getSubscriptionDetails({})
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success" && result.data) {
          setSubscriptionDetails(result.data as SubscriptionDetails);
          return;
        }
        setSubscriptionDetails(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Failed to fetch subscription details for pricing page", err);
        setSubscriptionDetails(null);
      });

    return () => {
      cancelled = true;
    };
  }, [phase, subscriptionState.subscription?.stripeSubscriptionId, getSubscriptionDetails]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const router = useRouter();

  // Reorder plans for mobile (PRO first)
  const orderedPlans = useMemo(() => {
    if (isMobile) {
      return [
        PLANS.find((p) => p.id === "pro")!,
        PLANS.find((p) => p.id === "go")!,
        PLANS.find((p) => p.id === "free")!,
        PLANS.find((p) => p.id === "enterprise")!,
      ];
    }
    return PLANS;
  }, [isMobile, PLANS]);

  const pendingTargetTier = subscriptionDetails?.pendingTargetPlan
    ? getPlanTier(subscriptionDetails.pendingTargetPlan)
    : null;
  const isPaymentPending =
    subscriptionState.subscription?.status === "incomplete" ||
    subscriptionDetails?.entitlementState === "payment_pending";
  const hasPendingDowngrade = Boolean(
    subscriptionDetails?.hasPendingChange &&
      pendingTargetTier !== null &&
      resolvedTier !== null &&
      pendingTargetTier < resolvedTier,
  );

  const handleKeepCurrentPlan = async () => {
    if (!subscriptionDetails?.currentPriceId) {
      return;
    }

    try {
      setLoadingPriceId("keep-current");
      const result = await changePlan({ targetPriceId: subscriptionDetails.currentPriceId });

      const refreshed = await getSubscriptionDetails({});
      if (refreshed.status === "success" && refreshed.data) {
        setSubscriptionDetails(refreshed.data as SubscriptionDetails);
      }
    } catch (err) {
      console.error(err);
      toast.error(tc("somethingWentWrong"), t("couldNotInitiateCheckout"));
    } finally {
      setLoadingPriceId(null);
    }
  };

  const handleSubscribe = async (planType: "go" | "pro" | "enterprise") => {
    if (phase !== "authenticated") {
      router.push("/sign-in");
      return;
    }

    if (isPaymentPending) {
      await handleOpenPortal();
      return;
    }

    const priceId = prices?.find((price) => price.plan === planType)?.id;

    if (!priceId) {
      toast.error(t("planUnavailable"), t("pricingNotConfigured"));
      return;
    }

    try {
      setLoadingPriceId(priceId);
      const hasLinkedStripeSubscription = Boolean(
        subscriptionState.subscription?.stripeSubscriptionId,
      );

      if (isEntitled && resolvedPlan && resolvedPlan !== "free") {
        const targetTier = getPlanTier(planType);
        const isUpgrade = resolvedTier !== null && targetTier > resolvedTier;

        if (isUpgrade) {
          // Show confirmation dialog with proration preview
          const preview = await getUpgradePreview({ targetPriceId: priceId });
          setUpgradePreview({ ...preview, targetPriceId: priceId });
          setIsUpgradeDialogOpen(true);
        } else {
          // Downgrade: keep existing behavior (no dialog)
          await changePlan({ targetPriceId: priceId });
          const refreshed = await getSubscriptionDetails({});
          if (refreshed.status === "success" && refreshed.data) {
            setSubscriptionDetails(refreshed.data as SubscriptionDetails);
          }
        }
      } else {
        if (hasLinkedStripeSubscription) {
          const { url } = await createPortalSession({});
          if (url) {
            window.location.href = url;
          }
          return;
        }

        const { url } = await createCheckoutSession({
          priceId,
          quantity: 1,
        });

        if (url) {
          window.location.href = url;
        } else {
          toast.billing.checkoutFailed();
        }
      }
    } catch (err) {
      console.error(err);
      toast.billing.checkoutFailed(err);
    } finally {
      setLoadingPriceId(null);
    }
  };

  const handleOpenPortal = async () => {
    try {
      setLoadingPriceId("portal");
      const { url } = await createPortalSession({});
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error(err);
      toast.billing.portalFailed(err);
    } finally {
      setLoadingPriceId(null);
    }
  };

  const td = useTranslations("upgradeDialog");

  const handleConfirmUpgrade = async () => {
    if (!upgradePreview) return;
    try {
      setIsConfirmingUpgrade(true);
      const result = await changePlan({
        targetPriceId: upgradePreview.targetPriceId,
        prorationDate: upgradePreview.prorationDate,
      });

      const refreshed = await getSubscriptionDetails({});
      if (refreshed.status === "success" && refreshed.data) {
        setSubscriptionDetails(refreshed.data as SubscriptionDetails);
      }

      // Save reference before clearing state
      const targetPlan = upgradePreview.targetPlan;

      setIsUpgradeDialogOpen(false);
      setUpgradePreview(null);

      if (result.creditsGranted > 0) {
        // Happy path: credits granted immediately — show actual count from server
        sonnerToast.success(td("upgradeSuccess"), {
          description: td("upgradeSuccessCredits", {
            plan: targetPlan,
            credits: result.creditsGranted.toLocaleString(),
          }),
          duration: 5000,
        });
      } else {
        // Grant failed or zero: credits are being processed — info-level tone
        sonnerToast(td("upgradeSuccess"), {
          description: td("upgradeProcessingCredits", {
            plan: targetPlan,
          }),
          duration: 5000,
        });
      }
    } catch (err) {
      console.error(err);
      toast.billing.checkoutFailed(err);
    } finally {
      setIsConfirmingUpgrade(false);
    }
  };

  const getPriceDisplay = (planType: "go" | "pro") => {
    if (isPricesLoading || !prices)
      return <Loader2 className="h-4 w-4 animate-spin" />;
    const price = prices?.find((p) => p.plan === planType);
    if (!price || !price.amount)
      return <Loader2 className="h-4 w-4 animate-spin" />;
    return format.number(price.amount / 100, {
      style: "currency",
      currency: price.currency,
      minimumFractionDigits: 0,
    });
  };

  const getButtonConfig = (plan: PlanConfig) => {
    if (isAuthLoading || isSubscriptionLoading) {
      return {
        disabled: true,
        label: tc("loading"),
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (isAnonymous || phase !== "authenticated") {
      return {
        disabled: false,
        label: tc("signInToSubscribe"),
        variant: "default" as const,
        onClick: () => router.push("/sign-in"),
      };
    }

    if (!hasResolvedSubscription || !resolvedPlan || resolvedTier === null) {
      return {
        disabled: true,
        label: tc("loading"),
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (isPaymentPending) {
      if (plan.id === "free") {
        return {
          disabled: true,
          label: "Payment pending",
          variant: "outline" as const,
          onClick: () => {},
        };
      }
      return {
        disabled: false,
        label: "Complete payment in billing portal",
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    const currentPlan = resolvedPlan;
    const currentTier = resolvedTier;
    const isCurrent = currentPlan === plan.id;
    const isUpgrade = plan.tier > currentTier;
    const isDowngrade = plan.tier < currentTier;
    const isScheduledTarget =
      subscriptionDetails?.hasPendingChange &&
      subscriptionDetails.pendingTargetPlan === plan.id;

    if (isCurrent && hasPendingDowngrade) {
      return {
        disabled: false,
        label: "Cancel scheduled downgrade",
        variant: "outline" as const,
        onClick: handleKeepCurrentPlan,
      };
    }

    if (isCurrent && !hasPendingDowngrade) {
      return {
        disabled: true,
        label: tc("currentPlan"),
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (isScheduledTarget) {
      return {
        disabled: true,
        label: "Scheduled",
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (plan.id === "free") {
      return {
        disabled: false,
        label: "Manage in Billing Portal",
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (plan.id === "enterprise") {
      return {
        disabled: false,
        label: tc("contactSupport"),
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (isUpgrade) {
      return {
        disabled: false,
        label: tc("upgradeTo", { plan: plan.name }),
        variant: "default" as const,
        onClick: () => handleSubscribe(plan.id as "go" | "pro" | "enterprise"),
      };
    }

    if (isDowngrade) {
      return {
        disabled: false,
        label: `Downgrade to ${plan.name}`,
        variant: "outline" as const,
        onClick: () => handleSubscribe(plan.id as "go" | "pro"),
      };
    }

    // Fallback (shouldn't reach here)
    return {
      disabled: true,
      label: tc("notAvailable"),
      variant: "outline" as const,
      onClick: () => {},
    };
  };

  if (phase === "sync_error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <AuthStatePanel
          variant="sync_error_retry"
          title={t("sessionSetupIssue")}
          description={t("retrySyncToContinue")}
          onRetry={retryUserSync}
          secondaryHref="/"
          secondaryLabel={tc("goHome")}
          className="max-w-lg"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 min-h-screen">
      {/* Header Section */}
      <div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={subtleSpring}
          className="text-center py-8 md:py-12"
        >
          {/* Icon with dramatic glow */}
          <div className="relative inline-block mb-4">
            <div
              className={cn(
                "w-16 h-16 md:w-20 md:h-20 rounded-2xl mx-auto",
                "bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10",
                "flex items-center justify-center",
                "shadow-lg",
              )}
            >
              <CreditCard className="w-8 h-8 md:w-10 md:h-10 text-primary" />
            </div>
            <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-2xl -z-10 scale-150" />
          </div>

          {/* Title with gradient */}
          <h1
            className={cn(
              "text-3xl md:text-5xl font-bold mb-2",
              "bg-gradient-to-r from-foreground via-foreground to-muted-foreground",
              "bg-clip-text text-transparent",
            )}
          >
            {t("chooseYourPlan")}
          </h1>

          {/* Subtitle */}
          <p className="text-sm md:text-lg text-muted-foreground max-w-xl mx-auto">
            {t("subtitle")}
          </p>
        </motion.div>
      </div>

      {/* Plans Grid */}
      {isPaymentPending && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 flex items-center justify-between gap-3">
          <span>
            {subscriptionDetails?.entitlementMessage ??
              t("paymentPendingDefault")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenPortal}
            disabled={loadingPriceId !== null}
          >
            {tc("openBillingPortal")}
          </Button>
        </div>
      )}

      {hasPendingDowngrade && subscriptionDetails && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 flex items-center justify-between gap-3">
          <span>
            {t("downgradeScheduledTo")}{" "}
            <span className="font-semibold">
              {subscriptionDetails.pendingTargetPlan ?? tc("anotherPlan")}
            </span>
            {subscriptionDetails.pendingEffectiveDate
              ? ` ${tc("onDate", { date: format.dateTime(new Date(subscriptionDetails.pendingEffectiveDate), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }) })}`
              : ""}
            .
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleKeepCurrentPlan}
            disabled={loadingPriceId !== null || !subscriptionDetails.currentPriceId}
          >
            {tc("keepCurrentPlan")}
          </Button>
        </div>
      )}

      <div
        className={cn(
          "grid gap-6",
          "grid-cols-1",
          "md:grid-cols-2",
          "lg:grid-cols-4",
        )}
      >
        {orderedPlans.map((plan, index) => {
          const isCurrent = hasResolvedSubscription && resolvedPlan === plan.id;
          const buttonConfig = getButtonConfig(plan);
          const planPriceId = prices?.find((p) => p.plan === plan.id)?.id;
          const Icon = plan.icon;
          const isScheduledTarget =
            subscriptionDetails?.hasPendingChange &&
            subscriptionDetails.pendingTargetPlan === plan.id;

          return (
            <motion.div
              key={plan.id}
              data-testid={`pricing-plan-${plan.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...subtleSpring, delay: index * 0.1 }}
              className={cn(
                "relative rounded-xl overflow-hidden flex flex-col",
                "bg-background/50 backdrop-blur-sm",
                "border",
                isCurrent && "border-primary/50 bg-primary/[0.02]",
                !isCurrent && "border-border/50",
              )}
            >
              {/* Current Plan Badge */}
              {isCurrent && (
                <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 flex items-center justify-center">
                  <span data-testid="pricing-current-badge" className="text-xs font-semibold text-green-600 uppercase tracking-wider">
                    {tc("currentPlan")}
                  </span>
                </div>
              )}

              {/* Popular Badge */}
              {plan.popular && !isCurrent && (
                <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                    {tc("mostPopular")}
                  </span>
                </div>
              )}

              {isScheduledTarget && !isCurrent && (
                <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 flex items-center justify-center">
                  <span data-testid="pricing-scheduled-badge" className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
                    Scheduled
                  </span>
                </div>
              )}

              {/* Header */}
              <div className="p-6 border-b border-border/40">
                <div className="flex items-center gap-3 mb-4">
                  <Icon className="w-8 h-8 text-primary" />
                  <h3 className="text-2xl font-bold">{plan.name}</h3>
                </div>

                {/* Price Display */}
                <div className="mb-2">
                  {plan.id === "free" ? (
                    <div className="text-4xl font-bold">{t("freePlanName")}</div>
                  ) : plan.id === "enterprise" ? (
                    <div className="text-4xl font-bold">{tc("custom")}</div>
                  ) : (
                    <div className="text-4xl font-bold">
                      {getPriceDisplay(plan.id as "go" | "pro")}
                      <span className="text-lg text-muted-foreground">{t("perMonth")}</span>
                    </div>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              {/* Features */}
              <div className="p-6 space-y-3 flex-1">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="p-6 pt-0 mt-auto">
                <Button
                  data-testid={`pricing-button-${plan.id}`}
                  className="w-full"
                  variant={buttonConfig.variant}
                  disabled={buttonConfig.disabled || loadingPriceId !== null}
                  onClick={buttonConfig.onClick}
                >
                  {loadingPriceId === planPriceId ||
                  loadingPriceId === "portal" ||
                  loadingPriceId === "keep-current" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    buttonConfig.label
                  )}
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>

      <UpgradeConfirmationDialog
        open={isUpgradeDialogOpen}
        onOpenChange={(open) => {
          if (!isConfirmingUpgrade) {
            setIsUpgradeDialogOpen(open);
            if (!open) setUpgradePreview(null);
          }
        }}
        onConfirm={handleConfirmUpgrade}
        isConfirming={isConfirmingUpgrade}
        preview={upgradePreview}
        cardBrand={subscriptionDetails?.cardBrand}
        cardLast4={subscriptionDetails?.cardLast4}
      />
    </div>
  );
}
