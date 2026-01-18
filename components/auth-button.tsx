"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User, Crown, CreditCard } from "lucide-react";
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
import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";

interface AuthButtonProps {
  isCollapsed?: boolean;
}

export function AuthButton({ isCollapsed = false }: AuthButtonProps) {
  const { user, loading } = useAuth();
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Fetch user subscription (will be undefined if not logged in or loading)
  // We strictly skip this query if Convex is not fully authenticated to avoid "Unauthenticated" errors
  const subscription = useQuery(
    api.subscriptions.queries.getMy,
    isAuthenticated ? {} : "skip",
  );

  // Loading state
  if (loading) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-all duration-200",
          isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2",
        )}
        disabled
      >
        <User className="h-[1.2rem] w-[1.2rem] animate-pulse" />
        {!isCollapsed && (
          <span className="text-sm font-medium">Loading...</span>
        )}
        <span className="sr-only">Loading...</span>
      </Button>
    );
  }

  // Not signed in
  if (!user) {
    const button = (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "transition-all duration-200 hover:bg-sidebar-accent/80",
          isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2",
        )}
        onClick={() => router.push("/auth/signin")}
        title={isCollapsed ? undefined : "Sign In"}
      >
        <LogIn className="h-[1.2rem] w-[1.2rem] shrink-0" />
        {!isCollapsed && <span className="text-sm font-medium">Sign In</span>}
        <span className="sr-only">Sign In</span>
      </Button>
    );

    if (isCollapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">Sign In</TooltipContent>
        </Tooltip>
      );
    }

    return button;
  }

  // Signed in - get display info
  const displayName = user.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user.email?.split("@")[0] || "User";

  const initials =
    user.firstName && user.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user.firstName
        ? user.firstName[0]
        : user.email?.[0]?.toUpperCase() || "U";

  // Determine plan label and upgrade status
  const planLabel = subscription?.plan
    ? subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)
    : "Free";

  const showUpgrade =
    !subscription || subscription.plan === "free" || subscription.plan === "go";

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "transition-all duration-200 hover:bg-sidebar-accent/80",
        isCollapsed ? "h-8 w-8 px-0" : "flex-1 justify-start px-2 h-9 gap-2",
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
                src={user.profilePictureUrl || undefined}
                alt={displayName}
              />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground truncate max-w-[160px]">
                {user.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <div className="px-2 py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Plan
            </span>
            <div className="flex items-center text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {(subscription?.plan === "pro" ||
                subscription?.plan === "enterprise") && (
                <Crown className="w-3 h-3 mr-1" />
              )}
              {planLabel}
            </div>
          </div>

          {showUpgrade && (
            <Button
              size="sm"
              className="w-full h-8 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0"
              onClick={() => {
                setOpen(false);
                router.push("/pricing");
              }}
            >
              Upgrade to Pro
            </Button>
          )}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/pricing");
          }}
          className="cursor-pointer"
        >
          <CreditCard className="h-4 w-4 mr-2" />
          Plans
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/settings/billing");
          }}
          className="cursor-pointer"
        >
          <User className="h-4 w-4 mr-2" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/auth/signout");
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
