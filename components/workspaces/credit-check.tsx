"use client";

// What a new job costs against the credits it draws on (#651): your own, or in an organization
// its credits, with its logo and name beside the balance so you know whose they are, and within
// the cap an admin set on you there (#652).

import { useNow, useTranslations } from "next-intl";
import { Coins } from "@/components/icons";
import { AnimatedNumber, Meter } from "@/components/screening/parts";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { monthStart } from "@/lib/billing/month";
import { cn } from "@/lib/utils";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace, useWorkspaceScope } from "@/lib/workspaces/url";
import { useCurrentWorkspace, WorkspaceTile } from "./parts";

/**
 * What the person can spend in the page's workspace: `balance`, its credits (`pool`), or in an
 * organization what's `left` of the `cap` an admin set on them when that's less. The server
 * checks work against the same figure before it starts. `loaded` once it's all read.
 */
export function useSpendable() {
  const { data: account } = useProtectedQuery(api.billing.accounts.mine, useWorkspaceScope());
  const workspaceId = useWorkspace();
  const org = useWorkspaceSlug() !== undefined;
  // This month's, which moves on to the next when a page left open reaches it.
  const month = monthStart(useNow({ updateInterval: 60_000 }).getTime());
  const { data: allowance } = useProtectedQuery(api.billing.caps.allowance, inWorkspace(org ? workspaceId : undefined, { month }));
  const pool = account?.balance ?? 0;
  return { loaded: account !== undefined && (!org || allowance !== undefined), balance: Math.min(pool, allowance?.left ?? pool), pool, cap: allowance?.cap, left: allowance?.left };
}

export function CreditCheck({ credits, balance, enough, cap }: { credits: number; balance: number; enough: boolean; /** The person's cap in an organization, which the balance is within. */ cap?: number }) {
  const t = useTranslations("screeningPage");
  const tw = useTranslations("workspaces");
  const workspace = useCurrentWorkspace();
  const organization = workspace?.kind === "organization" ? workspace : undefined;
  return (
    <div className="min-w-fit flex-1 space-y-1.5">
      <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="flex shrink-0 items-center gap-1.5 font-medium">
          <Coins className="size-3.5 text-primary" />
          <span>{t.rich("upToCredits", { n: () => <AnimatedNumber value={credits} /> })}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {organization ? (
            <TooltipHint label={cap === undefined ? tw("fromCredits", { name: organization.name }) : tw("fromCreditsCapped", { name: organization.name, cap })}>
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
