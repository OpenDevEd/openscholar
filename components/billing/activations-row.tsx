"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight, Layers, Repeat } from "@/components/icons";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import type { ActivationGrant } from "@/convex/billing/validators";

/**
 * The workspace's activations for Openscholar Reports, beside its credits, in two lines: how many are left, then what
 * they are. One that refills shows how much of it is left on a meter and when it comes back; those granted once or
 * bought stay until used. Each makes a report live with nothing to pay; past them, activating one buys it.
 */
export function ActivationsRow({ left, grants }: { /** Null for no limit. */ left: number | null; grants: ActivationGrant[] }) {
  const t = useTranslations("billingPage.activations");
  const format = useFormatter();
  const refilling = grants.filter((grant) => grant.interval !== "once");
  const kept = grants.find((grant) => grant.interval === "once");
  return (
    <div className="@container/activations space-y-1.5 border-t border-border-subtle pt-4">
      <div className="flex items-center gap-2">
        <p className="truncate text-sm font-medium">{t("title")}</p>
        <StatusChip tone={left === 0 ? "neutral" : "success"}>{left === null ? t("unlimited") : left === 0 ? t("none") : t("left", { count: left })}</StatusChip>
        {/* Narrow, the way to Publish is its arrow, so the count keeps its line. */}
        <Button asChild variant="ghost" size="sm" className="-me-2 ms-auto h-7 @max-[22rem]/activations:hidden">
          <Link href="/publish">
            {t("publish")} <ArrowRight />
          </Link>
        </Button>
        <TooltipHint label={t("publish")}>
          <Button asChild variant="ghost" size="icon" className="-me-1.5 ms-auto hidden size-7 @max-[22rem]/activations:inline-flex">
            <Link href="/publish" aria-label={t("publish")}>
              <ArrowRight />
            </Link>
          </Button>
        </TooltipHint>
      </div>
      {/* Each part keeps its words together and wraps whole. Kept ones alone need no line: the count above is all of them. */}
      {grants.length === 0 || refilling.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground [&>*]:whitespace-nowrap">
          {grants.length === 0 ? <span className="!whitespace-normal">{t("hint")}</span> : null}
          {refilling.map((grant) => (
            <span key={grant.interval} className="contents">
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <Repeat className="size-3.5 shrink-0" />
                <span className="font-medium text-foreground">{t("every", { interval: grant.interval })}</span>
                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${grant.size > 0 ? Math.min(100, (grant.left / grant.size) * 100) : 0}%` }} />
                </span>
                <span className="tabular-nums">
                  {format.number(grant.left)} / {format.number(grant.size)}
                </span>
              </span>
              {grant.resetsAt !== undefined ? <span className="whitespace-nowrap">{t("backTo", { size: grant.refillsTo ?? grant.size, date: format.dateTime(grant.resetsAt, { day: "numeric", month: "short" }) })}</span> : null}
            </span>
          ))}
          {kept ? (
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5 shrink-0" />
              {t("kept", { count: kept.left })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
