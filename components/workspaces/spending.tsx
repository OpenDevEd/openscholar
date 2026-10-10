"use client";

// What an organization's members spent of its credits this month, on its billing page, and the
// monthly cap an admin sets on each on the Team plan (#652). Admins see everyone, themselves
// first; a member sees their own.

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { Check } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { LIST, Paged, Zone } from "@/components/settings/parts";
import { PersonName } from "@/components/ui/identity";
import { IdentityAvatar } from "@/components/ui/identity-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showStyledToast } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { inWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";

const PER_PAGE = 10;
const ROW_HEIGHT = 61;
/** The caps an admin picks from, in credits a month; null takes the cap off. */
const CAPS = [null, 1_000, 2_000, 5_000, 10_000] as const;

/** The spending list and the month's total, read with the rest of the billing page so they show with it. */
export function useMemberSpending(workspaceId: Id<"workspaces"> | undefined) {
  const list = useCursorPage(api.billing.caps.spending, inWorkspace(workspaceId, {}), PER_PAGE);
  const { data: allowance } = useProtectedQuery(api.billing.caps.allowance, inWorkspace(workspaceId, {}));
  return { list, allowance, ready: !list.isLoading && allowance !== undefined };
}

export function MemberSpending({ spending, admin, team, members }: { spending: ReturnType<typeof useMemberSpending>; admin: boolean; team: boolean; members: number }) {
  const t = useTranslations("workspaces.settings");
  const format = useFormatter();
  const reduce = useReducedMotion();
  const { list, allowance } = spending;
  // One scale for the page's bars: the most anyone on it spent, or was capped at.
  const top = Math.max(1, ...list.items.map((row) => Math.max(row.spent, row.cap ?? 0)));

  return (
    <Zone
      label={admin ? t("spendingThisMonth") : t("yourSpendingThisMonth")}
      aside={<span className="pr-1 text-xs tabular-nums text-muted-foreground">{t("creditsCount", { count: allowance?.total ?? 0 })}</span>}
    >
      <Paged pager={{ list, size: PER_PAGE, total: admin ? members : 1 }} rowHeight={ROW_HEIGHT} label={t("membersLabel")}>
        <ul key={list.page} className={LIST}>
          {list.items.map((row, i) => {
            const near = row.cap !== undefined && row.spent >= row.cap * 0.9;
            return (
              <li key={row.userId} className="flex items-center gap-3 p-3">
                <IdentityAvatar name={row.name} imageUrl={row.imageUrl} className="size-9" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <PersonName name={row.name} you={row.you} className="text-sm font-medium" />
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {row.cap === undefined ? format.number(row.spent) : t("spentOfCap", { spent: format.number(row.spent), cap: format.number(row.cap) })}
                    </p>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-muted">
                    {row.cap !== undefined ? <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/8" style={{ width: `${(row.cap / top) * 100}%` }} /> : null}
                    <motion.span
                      className={cn("absolute inset-y-0 left-0 rounded-full", near ? "bg-warning" : "bg-primary")}
                      initial={{ width: 0 }}
                      animate={{ width: `${(row.spent / top) * 100}%` }}
                      transition={reduce ? { duration: 0 } : { duration: 0.6, ease: EASE, delay: 0.1 + i * 0.03 }}
                    />
                  </div>
                </div>
                {admin && team ? <CapPicker userId={row.userId} cap={row.cap} /> : null}
              </li>
            );
          })}
        </ul>
      </Paged>
    </Zone>
  );
}

function CapPicker({ userId, cap }: { userId: Id<"users">; cap: number | undefined }) {
  const t = useTranslations("workspaces.settings");
  const tc = useTranslations("common");
  const format = useFormatter();
  const setCap = useWorkspaceMutation(api.billing.caps.setCap);
  const [open, setOpen] = useState(false);
  const pick = async (next: number | null) => {
    setOpen(false);
    try {
      await setCap({ userId, cap: next });
    } catch (error) {
      showStyledToast("error", getErrorMessage(error, tc("somethingWentWrong")));
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 w-28 shrink-0 items-center justify-between gap-1.5 rounded-lg border border-border-subtle px-2.5 text-xs transition-colors hover:bg-muted">
          <span className="text-muted-foreground">{t("cap")}</span>
          <span className="font-medium tabular-nums">{cap === undefined ? t("capNone") : format.number(cap, { notation: "compact" })}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 rounded-xl p-1">
        {CAPS.map((option) => (
          <button key={option ?? "none"} type="button" onClick={() => pick(option)} className="flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-sm hover:bg-muted">
            <span className="tabular-nums">{option === null ? t("noCap") : t("capAMonth", { amount: format.number(option) })}</span>
            {(cap ?? null) === option ? <Check className="size-3.5 text-primary" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
