"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  Loader2,
  Building2,
  Zap,
  Rocket,
  CreditCard,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import { getPlanTier } from "@/convex/lib/constants";

const FEATURES = {
  free: ["10,000 free credits", "Basic search", "Limited queries"],
  go: ["100 Queries/mo", "Basic Search", "Standard Support"],
  pro: [
    "Unlimited Queries",
    "Advanced Search",
    "Priority Support",
    "AI Analysis",
  ],
  enterprise: [
    "Everything in Pro",
    "Custom Seats",
    "SSO & Audit Logs",
    "Dedicated Manager",
  ],
};

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

const PLANS: PlanConfig[] = [
  {
    id: "free",
    name: "Free",
    icon: BookOpen,
    description: "Try OpenScholar",
    features: FEATURES.free,
    tier: 0,
  },
  {
    id: "go",
    name: "Go",
    icon: Rocket,
    description: "Perfect for getting started",
    features: FEATURES.go,
    tier: 10,
  },
  {
    id: "pro",
    name: "Pro",
    icon: Zap,
    description: "For power users who need more",
    features: FEATURES.pro,
    tier: 20,
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    icon: Building2,
    description: "Scaling your entire organization",
    features: FEATURES.enterprise,
    tier: 30,
  },
];

export function Pricing() {
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
  const subscription = useQuery(api.subscriptions.queries.getMy);
  const currentPlan = subscription?.plan || "free";
  const currentTier = getPlanTier(currentPlan);

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
      toast.error("Failed to load pricing", {
        description: "Please refresh and try again.",
      });
    }
  }, [error]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { user } = useAuth();
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
  }, [isMobile]);

  const handleSubscribe = async (planType: "go" | "pro" | "enterprise") => {
    if (isAuthLoading) return;

    // If not logged in at all, sign in
    if (!user) {
      router.push("/auth/signin");
      return;
    }

    // If logged in but Convex doesn't have the token yet
    if (!isAuthenticated) {
      toast.error("Authentication error", {
        description: "Please refresh the page and try again.",
      });
      return;
    }

    const priceId = prices?.find((price) => price.plan === planType)?.id;

    if (!priceId) {
      toast.error("Plan unavailable", {
        description: "Pricing is not configured for this plan.",
      });
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
        toast.error("Failed to start checkout");
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong", {
        description: "Could not initiate checkout. Please try again.",
      });
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
      toast.error("Failed to open billing portal");
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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency,
      minimumFractionDigits: 0,
    }).format(price.amount / 100);
  };

  const getButtonConfig = (plan: PlanConfig) => {
    const isLoading = subscription === undefined;
    const isCurrent = currentPlan === plan.id;
    const isUpgrade = plan.tier > currentTier;
    const isDowngrade = plan.tier < currentTier;
    const planPriceId = prices?.find((p) => p.plan === plan.id)?.id;

    if (isLoading) {
      return {
        disabled: true,
        label: "Loading...",
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (!user) {
      return {
        disabled: false,
        label: "Sign in to Subscribe",
        variant: "default" as const,
        onClick: () => router.push("/auth/signin"),
      };
    }

    if (isCurrent) {
      return {
        disabled: true,
        label: "Current Plan",
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (plan.id === "enterprise") {
      return {
        disabled: false,
        label: "Contact Support",
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (isUpgrade) {
      return {
        disabled: false,
        label: `Upgrade to ${plan.name}`,
        variant: "default" as const,
        onClick: () => handleSubscribe(plan.id as "go" | "pro"),
      };
    }

    // Downgrades not allowed - disable button
    if (isDowngrade) {
      return {
        disabled: true,
        label: "Not Available",
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    // Fallback (shouldn't reach here)
    return {
      disabled: true,
      label: "Not Available",
      variant: "outline" as const,
      onClick: () => {},
    };
  };

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
            Choose Your Plan
          </h1>

          {/* Subtitle */}
          <p className="text-sm md:text-lg text-muted-foreground max-w-xl mx-auto">
            Scale from free to enterprise with transparent pricing
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
          const isCurrent = currentPlan === plan.id;
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
                    Current Plan
                  </span>
                </div>
              )}

              {/* Popular Badge */}
              {plan.popular && !isCurrent && (
                <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                    Most Popular
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
                    <div className="text-4xl font-bold">Free</div>
                  ) : plan.id === "enterprise" ? (
                    <div className="text-4xl font-bold">Custom</div>
                  ) : (
                    <div className="text-4xl font-bold">
                      {getPriceDisplay(plan.id as "go" | "pro")}
                      <span className="text-lg text-muted-foreground">/mo</span>
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
