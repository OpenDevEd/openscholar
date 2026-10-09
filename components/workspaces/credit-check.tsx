"use client";

// What a new job costs against the credits it draws on (#651): your own, or in an organization
// its credits, with its logo and name beside the balance so you know whose they are.

import { useTranslations } from "next-intl";
import { Coins } from "@/components/icons";
import { AnimatedNumber, Meter } from "@/components/screening/parts";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCurrentWorkspace, WorkspaceTile } from "./parts";

export function CreditCheck({ credits, balance, enough }: { credits: number; balance: number; enough: boolean }) {
  const t = useTranslations("screeningPage");
  const tw = useTranslations("workspaces");
  const workspace = useCurrentWorkspace();
  const organization = workspace?.kind === "organization" ? workspace : undefined;
  return (
    <div className="min-w-48 flex-1 space-y-1.5">
      <p className="flex items-center justify-between gap-3 text-xs">
        <span className="flex shrink-0 items-center gap-1.5 font-medium">
          <Coins className="size-3.5 text-primary" />
          <span>{t.rich("upToCredits", { n: () => <AnimatedNumber value={credits} /> })}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {organization ? (
            <TooltipHint label={tw("fromCredits", { name: organization.name })}>
              <span tabIndex={0} className="flex min-w-0 items-center gap-1.5 rounded-sm">
                <WorkspaceTile workspace={organization} size="xs" />
                {/* A phone has room for the logo alone; the tip names it. */}
                <span className="hidden min-w-0 truncate sm:block">{organization.name}</span>
              </span>
            </TooltipHint>
          ) : null}
          <span className={cn("shrink-0 tabular-nums transition-colors", !enough && "text-destructive")}>
            {t.rich("balanceLeft", { balance: Math.floor(balance), n: () => <AnimatedNumber value={Math.max(0, Math.floor(balance) - credits)} /> })}
          </span>
        </span>
      </p>
      <Meter value={Math.min(credits, balance)} max={Math.max(1, balance)} fill={enough ? "bg-primary" : "bg-destructive"} />
    </div>
  );
}
