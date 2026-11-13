"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight, Layers, Repeat } from "@/components/icons";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { useMoney } from "@/lib/hooks/use-money";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import type { BalancePart } from "@/convex/billing/validators";

/**
 * The workspace's publication balance, beside its credits, in two lines: what it holds, in dollars, then what that is.
 * A part that refills shows how much of it is left on a meter and when it comes back; what was given once or bought
 * stays until used, and alone it needs no second line. It pays for reports on Openscholar Reports; a card pays what
 * it can't.
 */
export function PublicationBalanceRow({ parts, unlimited = false }: { parts: BalancePart[]; /** A balance with no limit: every report is paid from it. */ unlimited?: boolean }) {
  const t = useTranslations("billingPage.publication");
  const format = useFormatter();
  const money = useMoney();
  const balance = parts.reduce((sum, part) => sum + part.left, 0);
  const refilling = parts.filter((part) => part.interval !== "once");
  const kept = parts.find((part) => part.interval === "once");
  return (
    <div className="@container/publication space-y-1.5 border-t border-border-subtle pt-4">
      {/* Too narrow for the title and a long amount (a phone at large text), the amount goes under the title. */}
      <div className="flex items-center gap-2 @max-[12rem]/publication:flex-wrap">
        <p className="min-w-0 text-sm font-medium sm:truncate">{t("title")}</p>
        <StatusChip tone={balance === 0 && !unlimited ? "neutral" : "success"}>{unlimited ? t("noLimit") : <bdi dir="ltr" className="tabular-nums">{money(balance)}</bdi>}</StatusChip>
        {/* Narrow, the way to Publish is its arrow, so the amount keeps its line. */}
        <Button asChild variant="ghost" size="sm" className="-me-2 ms-auto h-7 @max-[22rem]/publication:hidden">
          <Link href="/publish">
            {t("publish")} <ArrowRight />
          </Link>
        </Button>
        <TooltipHint label={t("publish")}>
          <Button asChild variant="ghost" size="icon" className="-me-1.5 ms-auto hidden size-7 @max-[22rem]/publication:inline-flex">
            <Link href="/publish" aria-label={t("publish")}>
              <ArrowRight />
            </Link>
          </Button>
        </TooltipHint>
      </div>
      {/* Each part keeps its words together and wraps whole; on a phone, where large text can outgrow the line, its
          words wrap too. What stays, alone, needs no line: the amount above is all of it. */}
      {unlimited ? null : parts.length === 0 || refilling.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:[&>*]:whitespace-nowrap">
          {parts.length === 0 ? <span className="!whitespace-normal">{t("hint")}</span> : null}
          {refilling.map((part) => (
            <span key={part.interval} className="contents">
              <span className="inline-flex items-center gap-2 max-sm:flex-wrap sm:whitespace-nowrap">
                <Repeat className="size-3.5 shrink-0" />
                <span className="font-medium text-foreground">{t("every", { interval: part.interval })}</span>
                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${part.size > 0 ? Math.min(100, (part.left / part.size) * 100) : 0}%` }} />
                </span>
                <bdi dir="ltr" className="tabular-nums">
                  {money(part.left)} / {money(part.size)}
                </bdi>
              </span>
              {part.resetsAt !== undefined ? <span className="sm:whitespace-nowrap">{t("backTo", { amount: money(part.refillsTo ?? part.size), date: format.dateTime(part.resetsAt, { day: "numeric", month: "short" }) })}</span> : null}
            </span>
          ))}
          {kept ? (
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5 shrink-0" />
              {t("kept", { amount: money(kept.left) })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
