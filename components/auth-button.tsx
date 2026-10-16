"use client";

import { Button } from "@/components/ui/button";
import { LogIn, User, Loader2, AiIcon, HighlightIcon } from "@/components/icons";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useQueryHighlight } from "@/components/query-highlight";
import { useState } from "react";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useTranslations } from "next-intl";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

/** What the rail's foot shows someone who isn't signed in: Sign in, and AI settings. Signed in, the rail has its own account card. */
export function AuthButton() {
  const tc = useTranslations("common");
  const tai = useTranslations("aiSettings");
  const { phase } = useAuthReadiness();
  const router = useWorkspaceRouter();
  const goToSignIn = useSignInRedirect();
  const [open, setOpen] = useState(false);
  const creditsEnabled = useFeatureFlag("credits.enabled");
  const highlight = useQueryHighlight();

  if (phase === "initializing") {
    return (
      <Button variant="ghost" size="sm" className="h-8 w-8 px-0 transition-all duration-200" disabled>
        <span className="flex h-[1.2rem] w-[1.2rem] items-center justify-center rounded-full border border-border-subtle bg-background">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </span>
        <span className="sr-only">{tc("loadingAccountControls")}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 px-0 transition-all duration-200 hover:bg-sidebar-accent">
              <User className="h-[1.2rem] w-[1.2rem] shrink-0" />
              <span className="sr-only">{tc("more")}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{tc("more")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-72">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            goToSignIn();
          }}
          className="cursor-pointer flex items-start gap-3 py-2.5"
        >
          <LogIn className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
            <span className="font-medium">{tc("signIn")}</span>
            {creditsEnabled && <span className="text-xs text-muted-foreground leading-snug">{tc("signInCreditsDescription")}</span>}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            router.push("/settings/ai");
          }}
          className="cursor-pointer flex items-start gap-3 py-2.5"
        >
          <AiIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex flex-col items-start gap-0.5 min-w-0 text-left">
            <span className="font-medium">{tai("aiConfiguration")}</span>
            <span className="text-xs text-muted-foreground leading-snug">{tai("configurePreferences")}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Toggles in place: the menu stays open. */}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={highlight.on}
          onSelect={(event) => {
            event.preventDefault();
            highlight.setOn(!highlight.on);
          }}
          className="cursor-pointer flex items-start gap-3 py-2.5"
        >
          <HighlightIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex flex-1 flex-col items-start gap-0.5 min-w-0 text-left">
            <span className="font-medium">{tc("highlightSearchTerms")}</span>
            <span className="text-xs text-muted-foreground leading-snug">{tc("highlightSearchTermsDescription")}</span>
          </div>
          <Switch checked={highlight.on} tabIndex={-1} aria-hidden className="pointer-events-none mt-0.5" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
