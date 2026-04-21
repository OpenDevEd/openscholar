"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TransactionsSummary {
  in: number;
  out: number;
  net: number;
}

interface Props {
  shownCount: number;
  summary: TransactionsSummary;
}

export function TransactionsPanelHeader({ shownCount, summary }: Props) {
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
            <span>{"−"}
              {format.number(summary.out)}
            </span>
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span
              className={summary.net >= 0 ? "text-emerald-600" : "text-foreground"}
            >
              {t("summary.net")} {netDisplay}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled
            data-transactions-export
            aria-label={t("export.label")}
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t("export.label")}
          </Button>
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
