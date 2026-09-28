"use client";

import { useTranslations } from "next-intl";
import { SidebarNav } from "@/components/settings/sidebar-nav";
import { PageWrapper } from "@/components/PageWrapper";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { Settings, Bot, CreditCard, Settings2, Plug } from "lucide-react";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import {
  SubscriptionStateProvider,
  useSharedSubscriptionState,
} from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SubscriptionStateProvider>
      <SettingsLayoutContent>{children}</SettingsLayoutContent>
    </SubscriptionStateProvider>
  );
}

function SettingsLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const tc = useTranslations("common");
  const { phase } = useAuthReadiness();
  const isSignedIn = phase === "authenticated";
  const subscriptionState = useSharedSubscriptionState();
  const subscriptionsEnabled = useFeatureFlagForPlan(
    "subscriptions.enabled",
    subscriptionState.planFeatures,
  );
  const creditsEnabled = useFeatureFlagForPlan(
    "credits.enabled",
    subscriptionState.planFeatures,
  );
  const showUpgradeCta =
    subscriptionState.onDefaultPlan !== false && !subscriptionState.account?.hasPaid;
  const hideBilling =
    !subscriptionsEnabled && !creditsEnabled && showUpgradeCta && !subscriptionState.isSettling;

  const baseSignedInItems = [
    { title: tc("general"), href: "/settings", icon: Settings2 },
    { title: tc("ai"), href: "/settings/ai", icon: Bot },
    ...(hideBilling ? [] : [{ title: tc("billing"), href: "/settings/billing", icon: CreditCard }]),
    { title: tc("connections"), href: "/settings/connections", icon: Plug },
  ];
  const sidebarNavItems = isSignedIn
    ? baseSignedInItems
    : [{ title: tc("ai"), href: "/settings/ai", icon: Bot }];

  if (phase === "initializing") {
    return (
      <PageWrapper>
        <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <div
          className={cn(
            "relative rounded-2xl flex flex-col md:flex-row",
            "bg-background/95 dark:bg-background/90",
            "border border-border/50",
            "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
          )}
        >
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

          {/* Sidebar */}
          <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border/40 bg-muted/20 md:bg-transparent">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="md:sticky top-0 p-6 border-b border-border/40 md:border-none"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm">
                  <Settings className="w-5 h-5 text-primary" />
                </div>
                <h1 className="text-xl font-bold tracking-tight">{tc("settings")}</h1>
              </div>
              <SidebarNav items={sidebarNavItems} />
            </motion.div>
          </aside>

          {/* Main Content */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
            className="flex-1 min-w-0"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </PageWrapper>
  );
}
