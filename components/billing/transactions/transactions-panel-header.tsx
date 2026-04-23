"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

interface Props {
  shownCount: number;
  exportSlot?: ReactNode;
}

export function TransactionsPanelHeader({
  shownCount,
  exportSlot,
}: Props) {
  const t = useTranslations("billingPage.transactions");

  const progress =
    shownCount === 0
      ? 0
      : Math.min(100, (shownCount / Math.max(shownCount, 25)) * 100);

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
        <div className="flex items-center gap-3">{exportSlot}</div>
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
