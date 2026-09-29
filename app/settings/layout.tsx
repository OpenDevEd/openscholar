"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import {
  Bot, Boxes, CreditCard, ExternalLink, Plug, Settings, ShieldCheck, Sparkles, ToggleRight, UserRound, Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import {
  ConfigurationLayout,
  ConfigurationNavigation,
} from "@/components/evidence-libraries/configuration/configuration-layout";
import { RailGroup, RailLink } from "@/components/evidence-libraries/configuration/navigation-rail";
import { BAR_ACTION, BAR_LABEL, PanelHeader } from "@/components/evidence-libraries/configuration/panel-header";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { AutumnIcon, ClerkIcon } from "@/components/icons/dashboard-icons";
import type { Ico } from "@/components/settings/parts";
import { SubscriptionStateProvider, useSharedSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useFeatureFlagForPlan } from "@/lib/feature-flags/hook";
import { findPlan } from "@/lib/billing/catalog";
import { useAppToast } from "@/lib/toast";

type Item = { href: string; title: string; icon: Ico; aside?: string; external?: string };

/** The deployment the admin pages change, named from its Convex address. */
function deployment() {
  const host = process.env.NEXT_PUBLIC_CONVEX_URL ? new URL(process.env.NEXT_PUBLIC_CONVEX_URL).host : "";
  if (host === "convex.opendev.space") return { kind: "sharedDev" as const, host };
  if (host.endsWith(".convex.cloud")) return { kind: "production" as const, host };
  return { kind: "other" as const, host };
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SubscriptionStateProvider>
      <Shell>{children}</Shell>
    </SubscriptionStateProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations("settingsShell");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const { phase, canRunProtectedQueries } = useAuthReadiness();
  const signedIn = phase === "authenticated";
  const isAdmin = useQuery(api.admins.queries.amI, canRunProtectedQueries ? {} : "skip") === true;
  const links = useQuery(api.admins.queries.links, isAdmin ? {} : "skip");
  const subscription = useSharedSubscriptionState();
  const subscriptionsEnabled = useFeatureFlagForPlan("subscriptions.enabled", subscription.planFeatures);
  const creditsEnabled = useFeatureFlagForPlan("credits.enabled", subscription.planFeatures);
  const plan = subscription.resolvedPlan;
  const showUpgrade = subscription.onDefaultPlan !== false && !subscription.account?.hasPaid;
  const hideBilling = !subscriptionsEnabled && !creditsEnabled && showUpgrade && !subscription.isSettling;
  const planLabel = (plan && subscription.catalog && findPlan(subscription.catalog, plan)?.name) || plan || "";
  const env = deployment();

  if (phase === "initializing") {
    return (
      <PageWrapper>
        <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
      </PageWrapper>
    );
  }

  const groups: Array<{ label: string; items: Item[] }> = [
    {
      label: t("groups.account"),
      items: signedIn
        ? [
            { href: "/settings", title: t("items.profile"), icon: UserRound },
            { href: "/settings/security", title: t("items.security"), icon: ShieldCheck },
            ...(hideBilling ? [] : [{ href: "/settings/billing", title: tc("billing"), icon: CreditCard, aside: planLabel }]),
          ]
        : [],
    },
    {
      label: t("groups.research"),
      items: [
        { href: "/settings/ai", title: tc("ai"), icon: Bot },
        ...(signedIn ? [{ href: "/settings/connections", title: tc("connections"), icon: Plug }] : []),
      ],
    },
    {
      label: t("groups.admin"),
      items: isAdmin
        ? [
            { href: "/settings/admin", title: t("items.switches"), icon: ToggleRight },
            { href: "/settings/admin/ai", title: t("items.aiModels"), icon: Bot },
            { href: "/settings/admin/models", title: t("items.modelList"), icon: Boxes },
            { href: "/settings/admin/admins", title: t("items.admins"), icon: Users },
            ...(links?.autumn ? [{ href: links.autumn, title: t("items.plans"), icon: AutumnIcon, external: "Autumn" }] : []),
            { href: "https://dashboard.clerk.com", title: t("items.users"), icon: ClerkIcon, external: "Clerk" },
          ]
        : [],
    },
  ].filter((g) => g.items.length > 0);

  return (
    <PageWrapper>
      <ConfigurationLayout
        header={
          <PanelHeader
            icon={Settings}
            image={user?.imageUrl}
            title={user?.fullName || user?.primaryEmailAddress?.emailAddress || tc("settings")}
            titleAside={
              <>
                {user ? <span className="hidden text-sm text-muted-foreground @3xl:inline">{tc("settings")}</span> : null}
                {isAdmin && pathname.startsWith("/settings/admin") ? (
                  <StatusChip tone={env.kind === "production" ? "danger" : "neutral"}>
                    <span className={BAR_LABEL}>
                      {env.kind === "sharedDev" ? t("sharedDev") : env.kind === "production" ? t("production") : env.host}
                    </span>
                  </StatusChip>
                ) : null}
                {signedIn && planLabel ? (
                  <StatusChip tone={showUpgrade ? "neutral" : "success"}>
                    <Sparkles aria-hidden />
                    <span className={BAR_LABEL}>{t("planChip", { plan: planLabel })}</span>
                  </StatusChip>
                ) : null}
              </>
            }
          >
            {pathname === "/settings/billing" ? (
              <BillingAction showUpgrade={showUpgrade} subscriptionsEnabled={subscriptionsEnabled} />
            ) : null}
          </PanelHeader>
        }
        navigation={
          <ConfigurationNavigation label={tc("settings")}>
            {groups.map((group) => (
              <RailGroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <RailLink
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    active={pathname === item.href}
                    onClick={() => {
                      if (item.external) {
                        window.open(item.href, "_blank", "noopener,noreferrer");
                        return;
                      }
                      // A new page starts at the top, not where the last one was scrolled to.
                      window.scrollTo({ top: 0, behavior: "instant" });
                      router.push(item.href, { scroll: false });
                    }}
                  >
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.aside ? <span className="text-xs font-normal text-muted-foreground">{item.aside}</span> : null}
                    {item.external ? (
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        {item.external}
                        <ExternalLink className="size-3" aria-hidden />
                      </span>
                    ) : null}
                  </RailLink>
                ))}
              </RailGroup>
            ))}
          </ConfigurationNavigation>
        }
      >
        {/* Every page fills the window below the header: the card ends 1.5rem above the
            bottom edge (the offset includes the header, 3rem is the card's padding, 2px
            its border; flow-root keeps a page's negative margins inside). */}
        <div className="flow-root min-h-[calc(100dvh-var(--configuration-offset)-5rem-2px)]">{children}</div>
      </ConfigurationLayout>
    </PageWrapper>
  );
}

/** Billing's main action sits in the command bar. */
function BillingAction({ showUpgrade, subscriptionsEnabled }: { showUpgrade: boolean; subscriptionsEnabled: boolean }) {
  const t = useTranslations("billingPage");
  const router = useRouter();
  const toast = useAppToast();
  const openPortal = useAction(api.billing.actions.openPortal);
  const [loading, setLoading] = useState(false);
  if (!subscriptionsEnabled && showUpgrade) return null;

  const onClick = async () => {
    if (showUpgrade) {
      router.push("/pricing");
      return;
    }
    setLoading(true);
    try {
      window.location.href = await openPortal({});
    } catch (error) {
      console.error("[settings] billing portal failed", error);
      toast.billing.portalFailed(error);
      setLoading(false);
    }
  };

  return (
    <Button
      data-testid="billing-manage-button"
      variant={showUpgrade ? "default" : "outline"}
      size="sm"
      className={BAR_ACTION}
      disabled={loading}
      onClick={onClick}
    >
      {loading ? <Spinner /> : showUpgrade ? <Sparkles /> : <ExternalLink />}
      <span className={BAR_LABEL}>{showUpgrade ? t("upgradePlan") : t("manageSubscriptionBtn")}</span>
    </Button>
  );
}
