"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, BadgeCheck } from "@/components/icons";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { Button } from "@/components/ui/button";
import Link from "@/components/workspace-link";
import type { RefillInterval } from "@/lib/billing/plans";

/**
 * The workspace's activations for Openscholar Reports, beside its credits: how many are left and what they refill by.
 * Each makes a report live with nothing to pay; past them, activating one buys it.
 */
export function ActivationsRow({ left, refill }: { /** Null for no limit. */ left: number | null; refill: RefillInterval | null }) {
  const t = useTranslations("billingPage.activations");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle pt-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset text-muted-foreground">
        <BadgeCheck className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          {t("title")}
          <StatusChip tone={left === 0 ? "neutral" : "success"}>
            {/* A balance that refills says so even when it's empty: more are on the way. */}
            {left === null ? t("unlimited") : refill ? t("leftRefills", { count: left, interval: refill }) : left === 0 ? t("none") : t("left", { count: left })}
          </StatusChip>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      </div>
      <Button asChild variant="ghost" size="sm" className="h-7">
        <Link href="/publish">
          {t("publish")} <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
