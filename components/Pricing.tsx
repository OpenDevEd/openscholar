"use client";
"use no memo"; // try/finally in handlers

import { useEffect, useState, useMemo } from "react";
import { useAction } from "convex/react";
import posthog from "posthog-js";
import { api } from "@/convex/_generated/api";
import type { CatalogPlan } from "@/convex/billing/validators";
import {
  findPlan,
  isUpgrade,
  mainPlans,
  signupCredits,
} from "@/lib/billing/catalog";
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
  Sparkles,
} from "@/components/icons";
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

type PlanCard = {
  id: string;
  name: string;
  icon: typeof BookOpen;
  description?: string;
  features: string[];
  price?: { amount: number; interval: string };
  popular: boolean;
  /** The plan every customer starts on. */
  isDefault: boolean;
};

/** Enterprise is sold by contract, so it only appears as a contact card. */
const ENTERPRISE_ID = "enterprise";
const ENTERPRISE_CREDITS_PER_MONTH = 150_000;

/** Icons for the plans OpenScholar launched with; other plans get a generic one. */
const PLAN_ICONS: Record<string, typeof BookOpen> = { free: BookOpen, go: Rocket, pro: Zap };

/**
 * Translated wording for the plans OpenScholar launched with. A description or
 * highlights set on the plan in Autumn replace it; plans added in Autumn use
 * Autumn's text.
 */
const PLAN_COPY = {
  free: { description: "freeDescription", highlights: ["freeFeature2", "freeFeature3"] },
  go: { description: "goDescription", highlights: ["goFeature2", "goFeature3"] },
  pro: { description: "proDescription", highlights: ["proFeature3", "proFeature4"] },
} as const;

/** Translated names for Autumn features; others show the name set in Autumn. */
const FEATURE_NAMES = { extraction: "features.extraction" } as const;

export function Pricing() {
  const toast = useAppToast();
  const t = useTranslations("pricing");
  const tb = useTranslations("billingPage");
  const tc = useTranslations("common");
  const format = useFormatter();

  const showEnterprise = useFeatureFlag("subscriptions.plan.enterprise");

  const choosePlan = useAction(api.billing.actions.choosePlan);
  const keepPlan = useAction(api.billing.actions.keepPlan);
  const previewPlan = useAction(api.billing.actions.previewPlan);
  const openPortal = useAction(api.billing.actions.openPortal);

  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [upgradePreview, setUpgradePreview] = useState<(UpgradePreview & { targetPlanId: string }) | null>(null);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isConfirmingUpgrade, setIsConfirmingUpgrade] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const { phase, retryUserSync } = useAuthReadiness();
  const subscriptionState = useSubscriptionState();
  const account = subscriptionState.account;
  const catalog = subscriptionState.catalog;
  const isAuthLoading = subscriptionState.isAuthLoading;
  const isSubscriptionLoading = subscriptionState.isQueryLoading;
  const isAnonymous = subscriptionState.isAnonymous;
  const hasResolvedSubscription = subscriptionState.isReady;
  const resolvedPlan = subscriptionState.resolvedPlan;

  const PLANS: PlanCard[] = useMemo(() => {
    if (!catalog) return [];
    const featureName = (id: string) =>
      id in FEATURE_NAMES
        ? t(FEATURE_NAMES[id as keyof typeof FEATURE_NAMES])
        : (catalog.features.find((f) => f.id === id)?.name ?? id);
    const creditsLine = (plan: CatalogPlan) => {
      if (plan.autoEnable) {
        const credits = signupCredits(catalog);
        return credits > 0 ? [t("creditsOnce", { credits })] : [];
      }
      return plan.credits?.interval === "month"
        ? [t("creditsPerMonth", { credits: plan.credits.included })]
        : [];
    };
    const cards: PlanCard[] = mainPlans(catalog).map((plan) => {
      const copy = plan.id in PLAN_COPY ? PLAN_COPY[plan.id as keyof typeof PLAN_COPY] : undefined;
      return {
        id: plan.id,
        name: plan.name,
        icon: PLAN_ICONS[plan.id] ?? Sparkles,
        description: plan.description ?? (copy ? t(copy.description) : undefined),
        features: [
          ...creditsLine(plan),
          ...plan.features.map(featureName),
          ...(plan.highlights ?? copy?.highlights.map((key) => t(key)) ?? []),
        ],
        price: plan.price,
        popular: plan.popular,
        isDefault: plan.autoEnable,
      };
    });
    if (showEnterprise) {
      cards.push({
        id: ENTERPRISE_ID,
        name: t("enterprisePlanName"),
        icon: Building2,
        description: t("enterpriseDescription"),
        features: [
          t("enterpriseFeature1", { credits: ENTERPRISE_CREDITS_PER_MONTH }),
          t("enterpriseFeature2"),
          t("enterpriseFeature3"),
          t("enterpriseFeature4"),
        ],
        popular: false,
        isDefault: false,
      });
    }
    return cards;
  }, [catalog, showEnterprise, t]);

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

  // On mobile, the recommended plans come first.
  const orderedPlans = useMemo(
    () => (isMobile ? [...PLANS].sort((a, b) => Number(b.popular) - Number(a.popular)) : PLANS),
    [isMobile, PLANS],
  );

  const planName = (id: string) => (catalog && findPlan(catalog, id)?.name) || id;
  // The upgrade dialog and toast describe monthly refills; other intervals show none.
  const monthlyCredits = (id: string) => {
    const credits = catalog && findPlan(catalog, id)?.credits;
    return credits?.interval === "month" ? credits.included : 0;
  };
  const scheduledPlan = account?.changesAt !== undefined ? account.nextPlan : undefined;
  const hasPendingDowngrade = Boolean(
    catalog &&
      scheduledPlan &&
      resolvedPlan &&
      scheduledPlan !== resolvedPlan &&
      !isUpgrade(catalog, resolvedPlan, scheduledPlan),
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

  const handleSubscribe = async (planType: string) => {
    if (phase !== "authenticated") {
      goToSignIn();
      return;
    }
    const upgrade = Boolean(catalog && resolvedPlan && isUpgrade(catalog, resolvedPlan, planType));
    posthog.capture("pricing_plan_clicked", {
      target_plan: planType,
      current_plan: resolvedPlan ?? "free",
      is_upgrade: upgrade,
    });

    try {
      setLoadingPlanId(planType);
      // A saved card is charged without Checkout, so confirm any amount due
      // now. Autumn decides that, not the price comparison: a move to a
      // yearly plan is charged at once even when it's cheaper per month.
      const preview = resolvedPlan ? await previewPlan({ plan: planType }) : null;
      if (resolvedPlan && preview?.card && preview.dueNow > 0) {
        const remainingDays = account?.renewsAt
          ? Math.max(0, Math.ceil((account.renewsAt - Date.now()) / 86_400_000))
          : 0;
        setUpgradePreview({
          currency: preview.currency,
          immediateChargeCents: Math.round(preview.dueNow * 100),
          currentPlan: planName(resolvedPlan),
          targetPlan: planName(planType),
          targetPlanId: planType,
          targetPlanCreditsPerMonth: monthlyCredits(planType),
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
      if (!upgrade) {
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
      const { url } = await choosePlan({ plan: upgradePreview.targetPlanId });
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
        ...(upgradePreview.targetPlanCreditsPerMonth > 0 && {
          description: td("upgradeSuccessCredits", {
            plan: targetPlan,
            credits: format.number(upgradePreview.targetPlanCreditsPerMonth),
          }),
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

  const formatPrice = (amount: number) =>
    format.number(amount, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    });

  const getButtonConfig = (plan: PlanCard) => {
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

    if (!hasResolvedSubscription || !resolvedPlan || !catalog) {
      return {
        disabled: true,
        label: tc("loading"),
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    const isCurrent = resolvedPlan === plan.id;
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

    if (plan.isDefault) {
      return {
        disabled: false,
        label: "Manage in Billing Portal",
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (plan.id === ENTERPRISE_ID) {
      return {
        disabled: false,
        label: tc("contactSupport"),
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (!isUpgrade(catalog, resolvedPlan, plan.id)) {
      return {
        disabled: false,
        label: `Downgrade to ${plan.name}`,
        variant: "outline" as const,
        onClick: () => handleSubscribe(plan.id),
      };
    }

    return {
      disabled: false,
      label: tc("upgradeTo", { plan: plan.name }),
      variant: "default" as const,
      onClick: () => handleSubscribe(plan.id),
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
        <div className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm ink-info flex items-center justify-between gap-3">
          <span>
            {t("downgradeScheduledTo")}{" "}
            <span className="font-semibold">{planName(scheduledPlan!)}</span>{" "}
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
          // One row for however many plans Autumn offers, while they fit.
          "lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]",
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
                "bg-card",
                "border",
                isCurrent && "border-primary/50 bg-primary/[0.02]",
                !isCurrent && "border-border-subtle",
              )}
            >
              {/* Current Plan Badge */}
              {isCurrent && (
                <div className="bg-success/10 border-b border-success/20 px-4 py-2 flex items-center justify-center">
                  <span data-testid="pricing-current-badge" className="text-xs font-semibold ink-success uppercase tracking-wider">
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
                <div className="bg-info/10 border-b border-info/20 px-4 py-2 flex items-center justify-center">
                  <span data-testid="pricing-scheduled-badge" className="text-xs font-semibold ink-info uppercase tracking-wider">
                    Scheduled
                  </span>
                </div>
              )}

              {/* Header */}
              <div className="p-6 border-b border-border-subtle">
                <div className="flex items-center gap-3 mb-4">
                  <Icon className="w-8 h-8 text-primary" />
                  <h3 className="text-2xl font-bold">{plan.name}</h3>
                </div>

                {/* Price Display */}
                <div className="mb-2">
                  {plan.id === ENTERPRISE_ID ? (
                    <div className="text-4xl font-bold">{tc("custom")}</div>
                  ) : plan.price ? (
                    <div className="text-4xl font-bold">
                      {formatPrice(plan.price.amount)}
                      <span className="text-lg text-muted-foreground">
                        {plan.price.interval === "month"
                          ? t("perMonth")
                          : tb("perInterval", {
                              interval:
                                plan.price.interval === "year" ? tb("intervalYear") : plan.price.interval,
                            })}
                      </span>
                    </div>
                  ) : (
                    <div className="text-4xl font-bold">{t("freePrice")}</div>
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
