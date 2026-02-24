"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  LogIn,
  LogOut,
  User,
  Crown,
  CreditCard,
  Settings,
  Loader2,
  Bot,
  MoreVertical,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { useOptionalAuthQuery } from "@/lib/auth/use-auth-query";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useSubscriptionState } from "@/lib/auth/use-subscription-state";
import { useTranslations } from "next-intl";
import { creditsFeatureFlags } from "@/lib/credits/feature-flags";
import { subscriptionsFeatureFlags } from "@/lib/subscriptions/feature-flags";

interface AuthButtonProps {
  isCollapsed?: boolean;
}

export function AuthButton({ isCollapsed = false }: AuthButtonProps) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const tai = useTranslations("aiSettings");
  const { user } = useUser();
  const { signOut } = useClerk();
  const { phase } = useAuthReadiness();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isInitializing = phase === "initializing";
  const isSignedIn = phase === "authenticated";

  const subscriptionState = useSubscriptionState();
  const isSubscriptionLoading = subscriptionState.isSettling;
  const hasResolvedSubscription = subscriptionState.isReady;
  const resolvedPlan = subscriptionState.resolvedPlan;

  const creditsQuery = useOptionalAuthQuery(api.credits.queries.getMyBalance, {});
  const credits = creditsQuery.data;

  // Loading state
  if (isInitializing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-all duration-200",
          isCollapsed ? "h-8 w-8 px-0" : "w-full justify-start px-2 h-8 gap-2",
        )}
        disabled
      >
        <span className="flex h-[1.2rem] w-[1.2rem] items-center justify-center rounded-full border border-border/60 bg-background/70">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </span>
        {!isCollapsed && (
          <span
            className="h-2.5 w-16 animate-pulse rounded-full bg-muted/60"
            aria-hidden
          />
        )}
        <span className="sr-only">{tc("loadingAccountControls")}</span>
      </Button>
    );
  }

  // Not signed in - show dropdown with Sign In and AI Settings
  if (!isSignedIn) {
    const signedOutTrigger = (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-all duration-200 hover:bg-sidebar-accent/80",
          isCollapsed ? "h-8 w-8 px-0" : "w-full justify-start px-2 h-8 gap-2",
        )}
      >
        <MoreVertical className="h-[1.2rem] w-[1.2rem] shrink-0" />
        {!isCollapsed && (
          <span className="text-sm font-medium">{tc("more")}</span>
        )}
        <span className="sr-only">{tc("more")}</span>
      </Button>
    );

    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {isCollapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{signedOutTrigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{tc("more")}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger asChild>{signedOutTrigger}</DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          side={isCollapsed ? "right" : "top"}
          align="start"
          className="w-72"
        >
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              router.push("/sign-in");
            }}
            className="cursor-pointer flex items-start gap-3 py-2.5"
          >
            <LogIn className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
              <span className="font-medium">{tc("signIn")}</span>
              {creditsFeatureFlags.enabled && (
                <span className="text-xs text-muted-foreground leading-snug">
                  {tc("signInCreditsDescription")}
                </span>
              )}
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              router.push("/settings/ai");
            }}
            className="cursor-pointer flex items-start gap-3 py-2.5"
          >
            <Bot className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
              <span className="font-medium">{tai("aiConfiguration")}</span>
              <span className="text-xs text-muted-foreground leading-snug">
                {tai("configurePreferences")}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Signed in - get display info
  const fallbackEmail = "account@openscholar.ai";
  const profile: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    profilePictureUrl?: string | null;
  } = user
    ? {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.primaryEmailAddress?.emailAddress ?? null,
        profilePictureUrl: user.imageUrl ?? null,
      }
    : {
        email: fallbackEmail,
      };
  const displayName = profile.firstName
    ? `${profile.firstName}${profile.lastName ? ` ${profile.lastName}` : ""}`
    : profile.email?.split("@")[0] || tc("user");

  const initials =
    profile.firstName && profile.lastName
      ? `${profile.firstName[0]}${profile.lastName[0]}`
      : profile.firstName
        ? profile.firstName[0]
        : profile.email?.[0]?.toUpperCase() || "U";

  // Determine plan label and upgrade status
  const planLabel = resolvedPlan
    ? resolvedPlan.charAt(0).toUpperCase() + resolvedPlan.slice(1)
    : null;
  const isResolvedProPlan = resolvedPlan === "pro" || resolvedPlan === "enterprise";

  const showUpgrade =
    hasResolvedSubscription &&
    (resolvedPlan === "free" || resolvedPlan === "go");

  const showPlanRow = subscriptionsFeatureFlags.enabled || !showUpgrade;
  const showCredits =
    creditsFeatureFlags.enabled &&
    creditsQuery.settlement === "ready" &&
    credits &&
    credits.total > 0;
  const showUpgradeButton = subscriptionsFeatureFlags.enabled && showUpgrade;
  const showPlansItem = subscriptionsFeatureFlags.enabled;
  const hasAccountInfo = showPlanRow || showCredits || showUpgradeButton;

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "transition-all duration-200 hover:bg-sidebar-accent/80",
        isCollapsed ? "h-8 w-8 px-0" : "w-full justify-start px-2 h-8 gap-2",
      )}
    >
      <User className="h-[1.2rem] w-[1.2rem] shrink-0" />
      {!isCollapsed && (
        <span className="truncate text-sm font-medium">{displayName}</span>
      )}
      <span className="sr-only">{displayName}</span>
    </Button>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {isCollapsed ? (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{displayName}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        side={isCollapsed ? "right" : "top"}
        align="start"
        className="w-64"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage
                src={profile.profilePictureUrl || undefined}
                alt={displayName}
              />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground truncate max-w-[160px]">
                {profile.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>

        {hasAccountInfo && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 space-y-2">
              {showPlanRow && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {tc("plan")}
                  </span>
                  {isSubscriptionLoading ? (
                    <span
                      className="h-5 w-16 animate-pulse rounded-full bg-muted/60"
                      aria-hidden
                    />
                  ) : (
                    <div className="flex items-center text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {isResolvedProPlan && <Crown className="w-3 h-3 mr-1" />}
                      {planLabel}
                    </div>
                  )}
                </div>
              )}
              {showCredits && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {tc("credits")}
                  </span>
                  <span className="text-sm font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {credits.total}
                  </span>
                </div>
              )}
              {showUpgradeButton && (
                <Button
                  size="sm"
                  className="w-full h-8 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0"
                  onClick={() => {
                    setOpen(false);
                    router.push("/pricing");
                  }}
                >
                  {tc("upgradeTo", { plan: "Pro" })}
                </Button>
              )}
            </div>
          </>
        )}

        <DropdownMenuSeparator />
        {showPlansItem && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              router.push("/pricing");
            }}
            className="cursor-pointer"
          >
            <CreditCard className="h-4 w-4 mr-2" />
            {tc("plans")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/settings/ai");
          }}
          className="cursor-pointer"
        >
          <Settings className="h-4 w-4 mr-2" />
          {tc("settings")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            setOpen(false);
            await signOut({ redirectUrl: "/" });
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {tc("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
