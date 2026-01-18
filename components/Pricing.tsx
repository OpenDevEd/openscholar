"use client";

import React, { useEffect, useState } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Loader2, Building2, Zap, Rocket } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";



const FEATURES = {
  go: ["Basic Search", "100 Queries/mo", "Standard Support"],
  pro: [
    "Advanced Search",
    "Unlimited Queries",
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


export function Pricing({ initialPrices = [] }: { initialPrices?: PlanPrice[] }) {
  const getPlans = useAction(api.subscriptions.actions.getPlans);
  const createCheckoutSession = useAction(
    api.subscriptions.actions.createCheckoutSession,
  );

  const [loadingPriceId, setLoadingPriceId] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(5);

  // Fetch prices using SWR (best practice as per rules)
  const {
    data: prices,
    error,
    isLoading,
  } = useSWR<PlanPrice[]>(
    "stripe-prices",
    async () => {
      // If we have initial prices and they match what we need, we might strictly rely on them
      // but SWR allows revalidation.
      return await getPlans({});
    },
    {
      fallbackData: initialPrices,
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

  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { user } = useAuth();
  const router = useRouter();

  const handleSubscribe = async (
    planType: "go" | "pro" | "enterprise",
  ) => {
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

      const quantity = planType === "enterprise" ? seatCount : 1;

      const { url } = await createCheckoutSession({
        priceId,
        mode: "subscription",
        quantity,
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

  const containerVariants: any = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants: any = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 10,
      },
    },
  };

  const getPriceDisplay = (planType: "go" | "pro") => {
    if (isLoading || !prices) return <Loader2 className="h-4 w-4 animate-spin" />;
    const price = prices?.find((p) => p.plan === planType);
    if (!price || !price.amount) return <Loader2 className="h-4 w-4 animate-spin" />;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency,
      minimumFractionDigits: 0,
    }).format(price.amount / 100);
  };

  return (
    <div className="w-full py-24 px-4 bg-background text-foreground overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
            Unleash Your Potential
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your ambition. From individual researchers
            to global organizations.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {/* GO PLAN */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -10 }}
            className="group relative p-8 rounded-[2rem] border border-border/50 bg-background/50 backdrop-blur-sm hover:border-primary/50 transition-colors duration-500"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center mb-6">
                  <Rocket className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Go</h3>
                <div className="text-4xl font-bold tracking-tight mb-1">
                  {getPriceDisplay("go")}
                  <span className="text-lg font-medium text-muted-foreground">
                    /mo
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Perfect for getting started.
                </p>
              </div>

              <ul className="flex-1 space-y-4 mb-8">
                {FEATURES.go.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSubscribe("go")}
                disabled={!!loadingPriceId || isAuthLoading}
                className="w-full h-12 rounded-xl text-base font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20"
              >
                {loadingPriceId === (prices?.find((price) => price.plan === "go")?.id ?? null) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Get Started"
                )}
              </Button>
            </div>
          </motion.div>

          {/* PRO PLAN */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -10 }}
            className="group relative p-8 rounded-[2rem] border border-primary/50 bg-primary/[0.02] backdrop-blur-sm hover:border-primary transition-colors duration-500"
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-full shadow-lg">
              Most Popular
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Pro</h3>
                <div className="text-4xl font-bold tracking-tight mb-1">
                  {getPriceDisplay("pro")}
                  <span className="text-lg font-medium text-muted-foreground">
                    /mo
                  </span>
                </div>
                <p className="text-muted-foreground">
                  For power users who need more.
                </p>
              </div>

              <ul className="flex-1 space-y-4 mb-8">
                {FEATURES.pro.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="p-0.5 rounded-full bg-primary/20">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    </div>
                    <span className="text-sm font-medium">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={() => handleSubscribe("pro")}
                disabled={!!loadingPriceId || isAuthLoading}
                className="w-full h-12 rounded-xl text-base font-semibold shadow-xl shadow-primary/20 hover:scale-[1.02] transition-transform"
              >
                {loadingPriceId === (prices?.find((price) => price.plan === "pro")?.id ?? null) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "Upgrade to Pro"
                )}
              </Button>
            </div>
          </motion.div>

          {/* ENTERPRISE PLAN */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -10 }}
            className="group relative p-8 rounded-[2rem] border border-border/50 bg-background/50 backdrop-blur-sm hover:border-orange-500/50 transition-colors duration-500"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center mb-6">
                  <Building2 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
                <div className="text-4xl font-bold tracking-tight mb-1">
                  Custom
                  <span className="text-lg font-medium text-muted-foreground">
                    /seat
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Scaling your entire organization.
                </p>
              </div>

              <ul className="flex-1 space-y-4 mb-8">
                {FEATURES.enterprise.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Number of Seats</label>
                  <input
                    type="number"
                    min="5"
                    value={seatCount}
                    onChange={(e) =>
                      setSeatCount(Math.max(5, parseInt(e.target.value) || 0))
                    }
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background/50 focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum 5 seats required
                  </p>
                </div>

                <Button
                  onClick={() => handleSubscribe("enterprise")}
                  disabled={!!loadingPriceId || isAuthLoading}
                  variant="outline"
                  className="w-full h-12 rounded-xl text-base font-semibold border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-950/30 hover:text-orange-600 dark:hover:text-orange-400"
                >
                  {loadingPriceId === (prices?.find((price) => price.plan === "enterprise")?.id ?? null) ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "Contact Sales / Select"
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
