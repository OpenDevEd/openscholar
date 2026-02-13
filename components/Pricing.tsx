"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
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
  const createPortalSession = useAction(
    api.subscriptions.actions.createPortalSession,
  );

  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Fetch current subscription
  const { phase, retryUserSync } = useAuthReadiness();
  const subscriptionState = useSubscriptionState();
  const isAuthLoading = subscriptionState.isAuthLoading;
  const isSubscriptionLoading = subscriptionState.isQueryLoading;
  const isAnonymous = subscriptionState.isAnonymous;
  const hasResolvedSubscription = subscriptionState.isReady;
  const resolvedPlan = subscriptionState.resolvedPlan;
  const resolvedTier = subscriptionState.resolvedTier;

  // Fetch prices using SWR
  const {
    data: prices,
    error,
    isLoading: isPricesLoading,
  } = useSWR<PlanPrice[]>(
    "stripe-prices",
    async () => {
      return await getPlans({});
    },
    {
      revalidateOnFocus: false,
      revalidateOnMount: true, // Always fetch real Stripe prices on mount
    },
  );

  useEffect(() => {
    if (error) {
      console.error("Failed to load Stripe prices", error);
      toast.error(t("failedToLoadPricing"), t("pleaseRefresh"));
    }
  }, [error, t]);

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

  const handleSubscribe = async (planType: "go" | "pro" | "enterprise") => {
    if (phase !== "authenticated") {
      router.push("/auth/signin");
      return;
    }

    const priceId = prices?.find((price) => price.plan === planType)?.id;

    if (!priceId) {
      toast.error(t("planUnavailable"), t("pricingNotConfigured"));
      return;
    }

    try {
      setLoadingPriceId(priceId);

      const { url } = await createCheckoutSession({
        priceId,
        mode: "subscription",
        quantity: 1,
      });

      if (url) {
        window.location.href = url;
      } else {
        toast.billing.checkoutFailed();
      }
    } catch (err) {
      console.error(err);
      toast.error(tc("somethingWentWrong"), t("couldNotInitiateCheckout"));
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
      toast.billing.portalFailed();
    } finally {
      setLoadingPriceId(null);
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
        onClick: () => router.push("/auth/signin"),
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

    if (isCurrent) {
      return {
        disabled: true,
        label: tc("currentPlan"),
        variant: "outline" as const,
        onClick: () => {},
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

    // Downgrades not allowed - disable button
    if (isDowngrade) {
      return {
        disabled: true,
        label: tc("notAvailable"),
        variant: "outline" as const,
        onClick: () => {},
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

          return (
            <motion.div
              key={plan.id}
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
                  <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">
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
                {plan.features.map((feature, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="p-6 pt-0 mt-auto">
                <Button
                  className="w-full"
                  variant={buttonConfig.variant}
                  disabled={buttonConfig.disabled || loadingPriceId !== null}
                  onClick={buttonConfig.onClick}
                >
                  {loadingPriceId === planPriceId ||
                  loadingPriceId === "portal" ? (
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
    </div>
  );
}
