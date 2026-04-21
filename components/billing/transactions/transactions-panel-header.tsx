"use client";

import type { ReactNode } from "react";

import { useFormatter, useTranslations } from "next-intl";

export interface TransactionsSummary {
  in: number;
  out: number;
  net: number;
}

interface Props {
  shownCount: number;
  summary: TransactionsSummary;
  exportSlot?: ReactNode;
}

export function TransactionsPanelHeader({
  shownCount,
  summary,
  exportSlot,
}: Props) {
  const t = useTranslations("billingPage.transactions");
  const format = useFormatter();

  const progress =
    shownCount === 0
      ? 0
      : Math.min(100, (shownCount / Math.max(shownCount, 25)) * 100);
  const netSign = summary.net >= 0 ? "+" : "−";
  const netDisplay = `${netSign}${format.number(Math.abs(summary.net))}`;

  return (
    <header
      data-transactions-header
      className="flex flex-col gap-1.5 border-b border-border/50 px-4 pb-3 pt-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="transactions-heading"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {t("title")}
        </h2>
        <div className="flex items-center gap-3">
          <span
            aria-label={t("summary.aria", {
              inAmount: summary.in,
              outAmount: summary.out,
              net: netDisplay,
              count: shownCount,
            })}
            data-transactions-summary
            data-transactions-shown={shownCount}
            data-transactions-in={summary.in}
            data-transactions-out={summary.out}
            data-transactions-net={summary.net}
            className="text-xs tabular-nums text-muted-foreground"
          >
            <span className="text-emerald-600">
              +{format.number(summary.in)}
            </span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span>
              {"−"}
              {format.number(summary.out)}
            </span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span
              className={summary.net >= 0 ? "text-emerald-600" : "text-foreground"}
            >
              {t("summary.net")} {netDisplay}
            </span>
          </span>
          {exportSlot}
        </div>
      </div>
      <div
        role="presentation"
        aria-hidden="true"
        data-transactions-progress={Math.round(progress)}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  );
}
