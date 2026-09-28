"use client";
"use no memo"; // try/finally in handlers

import { useEffect, useState, useMemo } from "react";
import { useAction } from "convex/react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";
import { PAID_PLANS, PLAN_TIER, SIGNUP_CREDITS } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
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
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useTranslations, useFormatter } from "next-intl";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

type PlanId = "free" | "go" | "pro" | "enterprise";

type PlanConfig = {
  id: PlanId;
  name: string;
  icon: typeof BookOpen;
  description: string;
  features: string[];
  tier: number;
  popular?: boolean;
};

/** Enterprise is sold by contract, so it only appears as a contact card. */
const ENTERPRISE_CREDITS_PER_MONTH = 150_000;
const ENTERPRISE_TIER = 30;

const tierOf = (plan: PlanId) => (plan === "enterprise" ? ENTERPRISE_TIER : PLAN_TIER[plan]);

export function Pricing() {
  const toast = useAppToast();
  const t = useTranslations("pricing");
  const tc = useTranslations("common");
  const format = useFormatter();

  const FEATURES = useMemo(() => ({
    free: [t("freeFeature1", { credits: SIGNUP_CREDITS }), t("freeFeature2"), t("freeFeature3")],
    go: [t("goFeature1", { credits: PAID_PLANS.go.creditsPerMonth }), t("goFeature2"), t("goFeature3")],
    pro: [t("proFeature1", { credits: PAID_PLANS.pro.creditsPerMonth }), t("proFeature2"), t("proFeature3"), t("proFeature4")],
    enterprise: [t("enterpriseFeature1", { credits: ENTERPRISE_CREDITS_PER_MONTH }), t("enterpriseFeature2"), t("enterpriseFeature3"), t("enterpriseFeature4")],
  }), [t]);

  const showGo = useFeatureFlag("subscriptions.plan.go");
  const showPro = useFeatureFlag("subscriptions.plan.pro");
  const showEnterprise = useFeatureFlag("subscriptions.plan.enterprise");

  const PLANS: PlanConfig[] = useMemo(() => {
    const all: PlanConfig[] = [
      { id: "free", name: t("freePlanName"), icon: BookOpen, description: t("freeDescription"), features: FEATURES.free, tier: tierOf("free") },
      ...(showGo ? [{ id: "go" as const, name: t("goPlanName"), icon: Rocket, description: t("goDescription"), features: FEATURES.go, tier: tierOf("go") }] : []),
      ...(showPro ? [{ id: "pro" as const, name: t("proPlanName"), icon: Zap, description: t("proDescription"), features: FEATURES.pro, tier: tierOf("pro"), popular: true }] : []),
      ...(showEnterprise ? [{ id: "enterprise" as const, name: t("enterprisePlanName"), icon: Building2, description: t("enterpriseDescription"), features: FEATURES.enterprise, tier: ENTERPRISE_TIER }] : []),
    ];
    return all;
  }, [t, FEATURES, showGo, showPro, showEnterprise]);

  const choosePlan = useAction(api.billing.actions.choosePlan);
  const keepPlan = useAction(api.billing.actions.keepPlan);
  const previewPlan = useAction(api.billing.actions.previewPlan);
  const openPortal = useAction(api.billing.actions.openPortal);

  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [upgradePreview, setUpgradePreview] = useState<(UpgradePreview & { targetPlan: "go" | "pro" }) | null>(null);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isConfirmingUpgrade, setIsConfirmingUpgrade] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const { phase, retryUserSync } = useAuthReadiness();
  const subscriptionState = useSubscriptionState();
  const account = subscriptionState.account;
  const isAuthLoading = subscriptionState.isAuthLoading;
  const isSubscriptionLoading = subscriptionState.isQueryLoading;
  const isAnonymous = subscriptionState.isAnonymous;
  const hasResolvedSubscription = subscriptionState.isReady;
  const resolvedPlan = subscriptionState.resolvedPlan;
  const resolvedTier = subscriptionState.resolvedTier;

  // Track pricing page view
  useEffect(() => {
    if (phase === "authenticated" && hasResolvedSubscription) {
      posthog.capture("pricing_page_viewed", { current_plan: resolvedPlan ?? "free" });
    } else if (phase === "anonymous") {
      posthog.capture("pricing_page_viewed", { current_plan: "anonymous" });
    }
  }, [phase, hasResolvedSubscription, resolvedPlan]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const goToSignIn = useSignInRedirect();

  // Reorder plans for mobile (PRO first)
  const orderedPlans = useMemo(() => {
    if (isMobile) {
      const mobileOrder: PlanConfig["id"][] = ["pro", "go", "free", "enterprise"];
      return mobileOrder
        .map((id) => PLANS.find((p) => p.id === id))
        .filter((p): p is PlanConfig => p !== undefined);
    }
    return PLANS;
  }, [isMobile, PLANS]);

  const scheduledPlan = account?.changesAt !== undefined ? account.nextPlan : undefined;
  const hasPendingDowngrade = Boolean(
    scheduledPlan && resolvedTier !== null && tierOf(scheduledPlan) < resolvedTier,
  );

  const handleKeepCurrentPlan = async () => {
    try {
      setLoadingPlanId("keep-current");
      posthog.capture("pending_change_canceled", {
        current_plan: resolvedPlan ?? "free",
        context: "pricing_page",
      });
      await keepPlan({});
    } catch (err) {
      console.error(err);
      toast.error(tc("somethingWentWrong"), t("couldNotInitiateCheckout"));
    } finally {
      setLoadingPlanId(null);
    }
  };

  const handleOpenPortal = async () => {
    try {
      setLoadingPlanId("portal");
      posthog.capture("billing_portal_opened", {
        current_plan: resolvedPlan ?? "free",
        context: "pricing_page",
      });
      window.location.href = await openPortal({});
    } catch (err) {
      console.error(err);
      toast.billing.portalFailed(err);
    } finally {
      setLoadingPlanId(null);
    }
  };

  const handleSubscribe = async (planType: "go" | "pro") => {
    if (phase !== "authenticated") {
      goToSignIn();
      return;
    }
    const isUpgrade = resolvedTier !== null && tierOf(planType) > resolvedTier;
    posthog.capture("pricing_plan_clicked", {
      target_plan: planType,
      current_plan: resolvedPlan ?? "free",
      is_upgrade: isUpgrade,
    });

    try {
      setLoadingPlanId(planType);
      // A saved card is charged without Checkout, so confirm the amount first.
      const preview = resolvedPlan && isUpgrade ? await previewPlan({ plan: planType }) : null;
      if (resolvedPlan && preview?.card) {
        const remainingDays = account?.renewsAt
          ? Math.max(0, Math.ceil((account.renewsAt - Date.now()) / 86_400_000))
          : 0;
        setUpgradePreview({
          currency: preview.currency,
          immediateChargeCents: Math.round(preview.dueNow * 100),
          currentPlan: resolvedPlan,
          targetPlan: planType,
          targetPlanCreditsPerMonth: PAID_PLANS[planType].creditsPerMonth,
          remainingDays,
          card: preview.card,
          lineItems: preview.lineItems.map((item) => ({
            description: item.description,
            amountCents: Math.round(item.amount * 100),
            currency: preview.currency,
          })),
        });
        setIsUpgradeDialogOpen(true);
        posthog.capture("upgrade_preview_viewed", {
          current_plan: resolvedPlan,
          target_plan: planType,
          proration_amount_cents: Math.round(preview.dueNow * 100),
        });
        return;
      }
      if (!isUpgrade) {
        posthog.capture("downgrade_initiated", { current_plan: resolvedPlan, target_plan: planType });
      }
      const { url } = await choosePlan({ plan: planType });
      if (url) {
        posthog.capture("checkout_session_created", { plan: planType });
        window.location.href = url;
      }
    } catch (err) {
      console.error(err);
      toast.billing.checkoutFailed(err);
    } finally {
      setLoadingPlanId(null);
    }
  };

  const td = useTranslations("upgradeDialog");

  const handleConfirmUpgrade = async () => {
    if (!upgradePreview) return;
    try {
      setIsConfirmingUpgrade(true);
      posthog.capture("upgrade_confirmed", {
        current_plan: upgradePreview.currentPlan,
        target_plan: upgradePreview.targetPlan,
        proration_amount_cents: upgradePreview.immediateChargeCents,
      });
      const { url } = await choosePlan({ plan: upgradePreview.targetPlan });
      if (url) {
        window.location.href = url;
        return;
      }
      const targetPlan = upgradePreview.targetPlan;
      setIsUpgradeDialogOpen(false);
      setUpgradePreview(null);
      posthog.capture("upgrade_completed", {
        current_plan: upgradePreview.currentPlan,
        target_plan: targetPlan,
      });
      sonnerToast.success(td("upgradeSuccess"), {
        description: td("upgradeSuccessCredits", {
          plan: targetPlan,
          credits: format.number(PAID_PLANS[targetPlan].creditsPerMonth),
        }),
        duration: 5000,
      });
    } catch (err) {
      console.error(err);
      toast.billing.checkoutFailed(err);
    } finally {
      setIsConfirmingUpgrade(false);
    }
  };

  const getPriceDisplay = (planType: "go" | "pro") =>
    format.number(PAID_PLANS[planType].usdPerMonth, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    });

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
        onClick: goToSignIn,
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

    const currentPlan = resolvedPlan;
    const currentTier = resolvedTier;
    const isCurrent = currentPlan === plan.id;
    const isUpgrade = plan.tier > currentTier;
    const isDowngrade = plan.tier < currentTier;
    const isScheduledTarget = scheduledPlan === plan.id;

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
        onClick: () => handleSubscribe(plan.id as "go" | "pro"),
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

  if (phase === "initializing") {
    return (
      <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
    );
  }

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
      {hasPendingDowngrade && account?.changesAt !== undefined && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 flex items-center justify-between gap-3">
          <span>
            {t("downgradeScheduledTo")}{" "}
            <span className="font-semibold capitalize">{scheduledPlan}</span>{" "}
            {tc("onDate", {
              date: format.dateTime(new Date(account.changesAt), {
                year: "numeric",
                month: "short",
                day: "numeric",
              }),
            })}
            .
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleKeepCurrentPlan}
            disabled={loadingPlanId !== null}
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
          const Icon = plan.icon;
          const isScheduledTarget = scheduledPlan === plan.id;

          return (
            <motion.div
              key={plan.id}
              data-testid={`pricing-plan-${plan.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...subtleSpring, delay: index * 0.1 }}
              className={cn(
                "relative rounded-xl overflow-hidden flex flex-col",
                "bg-background/90",
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
                  disabled={buttonConfig.disabled || loadingPlanId !== null}
                  onClick={buttonConfig.onClick}
                >
                  {loadingPlanId === plan.id ||
                  loadingPlanId === "portal" ||
                  loadingPlanId === "keep-current" ? (
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
        cardBrand={upgradePreview?.card?.brand}
        cardLast4={upgradePreview?.card?.last4}
      />
    </div>
  );
}
