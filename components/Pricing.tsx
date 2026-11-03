"use client";
"use no memo"; // try/finally in handlers

import { useCallback, useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
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
import {
  Loader2,
  Building2,
  CreditCard,
  UserRound,
  type AppIcon,
} from "@/components/icons";
import { planIcon } from "@/components/billing/plan-icon";
import { useAppToast } from "@/lib/toast";
import { toast as sonnerToast } from "sonner";
import {
  UpgradeConfirmationDialog,
  type UpgradePreview,
} from "@/components/billing/upgrade-confirmation-dialog";
import { cn } from "@/lib/utils";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Spinner } from "@/components/ui/spinner";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useTranslations, useFormatter } from "next-intl";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { OrganizationPlans, type CurrentWorkspace } from "@/components/workspaces/org-plans";
import { StickyPageHeader } from "@/components/layout/sticky-page-header";
import { PlanCard } from "@/components/billing/plan-card";
import { AlphaPlansNotice, ContactButton } from "@/components/alpha-notices";
import { CONTACT_EMAIL, SOUTHERN_REQUEST } from "@/lib/billing/contact";

type PlanCard = {
  id: string;
  name: string;
  icon: AppIcon;
  description?: string;
  features: string[];
  price?: { amount: number; interval: string };
  popular: boolean;
  /** The plan every customer starts on. */
  isDefault: boolean;
  /** Listed, not sold: asked for by email. */
  byRequest: boolean;
};

/** Enterprise is sold by contract, so it only appears as a contact card. */
const ENTERPRISE_ID = "enterprise";
const ENTERPRISE_CREDITS_PER_MONTH = 150_000;

/**
 * Translated wording for the plans OpenScholar launched with. A description or
 * highlights set on the plan in Autumn replace it; plans added in Autumn use
 * Autumn's text.
 */
const PLAN_COPY = {
  free: { description: "freeDescription", highlights: ["everyFeature", "papersRunning", "papersInRequest", "unlimitedCollectionsAndGuests"] },
  southern: { description: "southernDescription", highlights: ["southernFeature1", "southernFeature2"] },
} as const;

/** Translated names for Autumn features; others show the name set in Autumn. */
const FEATURE_NAMES = { extraction: "features.extraction", authors: "features.authors" } as const;

/** `organization`: the organization whose address the page is under, as the server read it; `libraries`: whether it has Evidence Libraries. */
export function Pricing({ organization, libraries }: { organization?: CurrentWorkspace; libraries?: boolean } = {}) {
  const tLabels = useTranslations("pricing");
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

  // Under an organization's address its plans show first (#652); either tab shows the other's.
  const inOrganization = Boolean(useParams<{ slug?: string }>().slug);
  const [audience, setAudience] = useState<"me" | "org">(inOrganization ? "org" : "me");

  const { phase, retryUserSync } = useAuthReadiness();
  // Your own plans are your own whichever workspace the page is in.
  const subscriptionState = useSubscriptionState({ own: true });
  const account = subscriptionState.account;
  const catalog = subscriptionState.catalog;
  const isAuthLoading = subscriptionState.isAuthLoading;
  const isSubscriptionLoading = subscriptionState.isQueryLoading;
  const isAnonymous = subscriptionState.isAnonymous;
  const hasResolvedSubscription = subscriptionState.isReady;
  const resolvedPlan = subscriptionState.resolvedPlan;
  // A plan another tab moved to meanwhile is current: there's nothing left to confirm, now or later (#858).
  if (upgradePreview && upgradePreview.targetPlanId === resolvedPlan && !isConfirmingUpgrade) {
    setIsUpgradeDialogOpen(false);
    setUpgradePreview(null);
  }

  const featureName = useCallback(
    (id: string) =>
      id in FEATURE_NAMES
        ? t(FEATURE_NAMES[id as keyof typeof FEATURE_NAMES])
        : (catalog?.features.find((f) => f.id === id)?.name ?? id),
    [catalog, t],
  );

  const PLANS: PlanCard[] = useMemo(() => {
    if (!catalog) return [];
    const creditsLine = (plan: CatalogPlan) => {
      if (plan.credits?.interval === "month") return [t("creditsPerMonth", { credits: plan.credits.included })];
      const credits = plan.autoEnable ? signupCredits(catalog) : 0;
      return credits > 0 ? [t("creditsOnce", { credits })] : [];
    };
    const cards: PlanCard[] = mainPlans(catalog).map((plan) => {
      const copy = plan.id in PLAN_COPY ? PLAN_COPY[plan.id as keyof typeof PLAN_COPY] : undefined;
      return {
        id: plan.id,
        name: plan.name,
        icon: planIcon(plan.id),
        description: plan.description ?? (copy ? t(copy.description) : undefined),
        features: [
          ...creditsLine(plan),
          ...plan.features.map(featureName),
          ...(plan.highlights ?? copy?.highlights.map((key) => t(key, { running: plan.limits?.concurrency ?? 0, request: plan.limits?.request_papers ?? 0 })) ?? []),
        ],
        price: plan.price,
        popular: plan.popular,
        isDefault: plan.autoEnable,
        byRequest: plan.byRequest === true,
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
        byRequest: false,
      });
    }
    return cards;
  }, [catalog, featureName, showEnterprise, t]);

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
        setUpgradePreview({
          currency: preview.currency,
          immediateChargeCents: Math.round(preview.dueNow * 100),
          currentPlan: planName(resolvedPlan),
          targetPlan: planName(planType),
          targetPlanId: planType,
          targetPlanCreditsPerMonth: monthlyCredits(planType),
          renewsAt: preview.renewsAt,
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
        label: null,
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    if (isAnonymous || phase !== "authenticated") {
      return {
        disabled: false,
        label: tc("signIn"),
        variant: "default" as const,
        onClick: goToSignIn,
      };
    }

    if (!hasResolvedSubscription || !resolvedPlan || !catalog) {
      return {
        disabled: true,
        label: null,
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    const isCurrent = resolvedPlan === plan.id;
    const isScheduledTarget = scheduledPlan === plan.id;

    if (isCurrent && hasPendingDowngrade) {
      return {
        disabled: false,
        label: tLabels("cancelScheduledDowngrade"),
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
        label: tLabels("scheduled"),
        variant: "outline" as const,
        onClick: () => {},
      };
    }

    // Leaving a plan given by request is asked for the same way.
    if (plan.isDefault && findPlan(catalog, resolvedPlan)?.byRequest) {
      return {
        disabled: false,
        label: tc("contactSupport"),
        variant: "outline" as const,
        onClick: () => window.location.assign(`mailto:${CONTACT_EMAIL}`),
      };
    }

    if (plan.isDefault) {
      return {
        disabled: false,
        label: tLabels("manageInBillingPortal"),
        variant: "outline" as const,
        onClick: handleOpenPortal,
      };
    }

    if (plan.id === ENTERPRISE_ID) {
      return {
        disabled: false,
        label: tc("contactSupport"),
        variant: "outline" as const,
        onClick: () => window.location.assign(`mailto:${CONTACT_EMAIL}`),
      };
    }

    if (!isUpgrade(catalog, resolvedPlan, plan.id)) {
      return {
        disabled: false,
        label: tLabels("downgradeTo", { name: plan.name }),
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

  const audienceTabs = (
    <ListViewTabs
      label={t("plansFor")}
      value={audience}
      onChange={setAudience}
      tabs={[
        { value: "me" as const, label: t("forYou"), icon: <UserRound className="size-3.5" /> },
        { value: "org" as const, label: t("forAnOrganization"), icon: <Building2 className="size-3.5" /> },
      ]}
    />
  );

  return (
    <div className="@container w-full pb-16">
      <StickyPageHeader>
        <PanelHeader icon={CreditCard} title={t("chooseYourPlan")} tabs={audienceTabs} />
      </StickyPageHeader>

      <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        {/* A narrow bar has no room for the tabs. */}
        <div className="@3xl:hidden">{audienceTabs}</div>

        {/* As wide as the row of plans under it. */}
        <div className={audience === "me" ? "mx-auto max-w-3xl" : undefined}>
          <AlphaPlansNotice />
        </div>

        {audience === "org" ? (
          <OrganizationPlans featureName={featureName} initial={organization} libraries={libraries} />
        ) : (
          <>
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
            "mx-auto grid gap-6",
            "grid-cols-1",
            "md:grid-cols-2",
            // Two plans sit side by side at a card's width; more share one row, while they fit.
            orderedPlans.length > 2 ? "lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]" : "max-w-3xl",
          )}
        >
          {orderedPlans.map((plan, index) => {
            const isCurrent = hasResolvedSubscription && resolvedPlan === plan.id;
            const buttonConfig = getButtonConfig(plan);
            const isScheduledTarget = scheduledPlan === plan.id;

            return (
              <PlanCard
                key={plan.id}
                testId={`pricing-plan-${plan.id}`}
                index={index}
                current={isCurrent}
                badges={[
                  ...(isCurrent ? [{ tone: "success" as const, label: tc("currentPlan"), testId: "pricing-current-badge" }] : []),
                  ...(plan.popular && !isCurrent ? [{ tone: "primary" as const, label: tc("mostPopular") }] : []),
                  ...(isScheduledTarget && !isCurrent ? [{ tone: "info" as const, label: tLabels("scheduled"), testId: "pricing-scheduled-badge" }] : []),
                ]}
                icon={plan.icon}
                name={plan.name}
                price={
                  plan.byRequest ? (
                    <div className="text-4xl font-bold">{t("onRequest")}</div>
                  ) : plan.id === ENTERPRISE_ID ? (
                    <div className="text-4xl font-bold">{tc("custom")}</div>
                  ) : plan.price ? (
                    <div className="text-4xl font-bold">
                      {formatPrice(plan.price.amount)}
                      <span className="text-lg text-muted-foreground">
                        {plan.price.interval === "month"
                          ? t("perMonth")
                          : tb("perInterval", {
                              interval: plan.price.interval === "year" ? tb("intervalYear") : plan.price.interval,
                            })}
                      </span>
                    </div>
                  ) : (
                    <div className="text-4xl font-bold">{t("freePrice")}</div>
                  )
                }
                description={plan.description}
                features={plan.features}
              >
                {plan.byRequest && !isCurrent ? <ContactButton href={SOUTHERN_REQUEST} /> : <Button
                  data-testid={`pricing-button-${plan.id}`}
                  className="w-full"
                  variant={buttonConfig.variant}
                  disabled={buttonConfig.disabled || loadingPlanId !== null}
                  onClick={buttonConfig.onClick}
                >
                  {loadingPlanId === plan.id || loadingPlanId === "portal" || loadingPlanId === "keep-current" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    (buttonConfig.label ?? <Spinner aria-label={tc("loading")} />)
                  )}
                </Button>}
              </PlanCard>
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
          </>
        )}
      </div>
    </div>
  );
}
