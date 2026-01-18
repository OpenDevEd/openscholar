"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Calendar, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CreditBalanceCard } from "@/components/billing/credit-balance-card";
import { useRouter } from "next/navigation";

export default function BillingPage() {
  const router = useRouter();
  const subscription = useQuery(api.subscriptions.queries.getMy);
  const creditBalance = useQuery(api.credits.queries.getMyBalance);
  const createPortalSession = useAction(
    api.subscriptions.actions.createPortalSession,
  );
  const getSubscriptionDetails = useAction(
    api.subscriptions.actions.getSubscriptionDetails,
  );
  const cancelImmediately = useAction(api.subscriptions.actions.cancelImmediately);

  const [isLoading, setIsLoading] = useState(false);
  const [details, setDetails] = useState<{
    amount: number;
    currency: string;
    interval: string;
    currentPeriodEnd: number;
    status: string;
    cancelAtPeriodEnd: boolean;
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
            setErrorMsg(result.error || "Failed to load details");
          }
        })
        .catch((err) => {
          console.error("Failed to fetch details", err);
          setErrorMsg("Network error fetching details");
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
    // If user is on free plan, redirect to pricing page
    if (isFree) {
      router.push("/pricing");
      return;
    }

    // Otherwise, open the portal
    try {
      setIsLoading(true);
      const { url } = await createPortalSession({});
      if (url) window.location.href = url;
    } catch (error) {
      toast.error("Failed to redirect to billing portal");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelImmediately = async () => {
    if (!confirm("Are you sure you want to cancel immediately? You will lose access to paid features instantly.")) return;
    
    try {
      setIsLoading(true);
      await cancelImmediately({});
      
      // Clear Stripe details immediately for better UX
      setDetails(null);
      setErrorMsg(null);
      
      toast.success("Subscription cancelled immediately");
      // Full state update happens automatically via Convex reactivity
    } catch (error) {
      toast.error("Failed to cancel subscription");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (subscription === undefined) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span>Loading details...</span>
      </div>
    );
  }

  const currentPlan = subscription?.plan || "free";
  const status = subscription?.status || "inactive";
  const creditsPerMonth = subscription?.creditsPerMonth || 0;
  const seats = subscription?.seats || 1;
  const isFree = currentPlan === "free";

  // Format currency
  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border/40 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Billing & Plans
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your subscription and usage.
          </p>
        </div>
        <Button
          variant={isFree ? "default" : "outline"}
          onClick={handleManageSubscription}
          disabled={isLoading}
          size="sm"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isFree ? "Upgrade Plan" : "Manage Subscription"}
        </Button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-8 max-w-2xl">
        {/* Plan Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
            <CreditCard className="w-4 h-4" />
            <span>Subscription</span>
          </div>

          <div className="rounded-xl border border-border/50 bg-muted/30 overflow-hidden">
            <div className="p-4 flex items-center justify-between border-b border-border/40 min-h-[80px]">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold capitalize">
                  {currentPlan} Plan
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${status === "active" ? "bg-green-500/10 text-green-600" : "bg-yellow-500/10 text-yellow-600"}`}
                >
                  {status}
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
                      / {details.interval}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Error State */}
            {errorMsg && !isFree && (
              <div className="bg-red-500/10 p-3 text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Detailed Info (Only for Paid Plans) */}
            {!isFree && (
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
                            ? "Expires on"
                            : "Renews on"}
                        </span>
                        <span className="font-medium">
                          {new Date(
                            details.currentPeriodEnd,
                          ).toLocaleDateString()}
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
            {isFree && (
              <div className="bg-background/50 p-4 text-sm text-muted-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Upgrade to Pro to unlock higher limits and features.
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

        {/* Danger Zone */}
        {!isFree && (
          <div className="pt-8 border-t border-border/40 space-y-4">
            <h3 className="text-sm font-medium text-red-600 uppercase tracking-wider">
              Danger Zone
            </h3>
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-red-900 dark:text-red-200">
                  Cancel Subscription Immediately
                </div>
                <div className="text-sm text-red-700/80 dark:text-red-300/70 mt-1">
                  This will immediately end your subscription and downgrade you to the Free plan.
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelImmediately}
                disabled={isLoading}
              >
                Cancel Immediately
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
