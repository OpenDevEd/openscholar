"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { GroupKey } from "@/lib/billing/transactions/grouping";

interface Props {
  groupKey: GroupKey;
}

const MONTH_KEY_PATTERN = /^month-(\d{4})-(\d{2})$/;

export function TransactionsGroupHeader({ groupKey }: Props) {
  const t = useTranslations("billingPage.transactions.group");
  const format = useFormatter();

  let label: string;
  if (groupKey === "today") {
    label = t("today");
  } else if (groupKey === "yesterday") {
    label = t("yesterday");
  } else if (groupKey === "this-week") {
    label = t("thisWeek");
  } else if (groupKey === "last-week") {
    label = t("lastWeek");
  } else {
    const match = MONTH_KEY_PATTERN.exec(groupKey);
    if (match) {
      const [, yearStr, monthStr] = match;
      const date = new Date(Number(yearStr), Number(monthStr) - 1, 1);
      label = format.dateTime(date, { month: "long", year: "numeric" });
    } else {
      label = groupKey;
    }
  }

  return (
    <div
      role="presentation"
      data-transactions-group-header={groupKey}
      className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70"
    >
      {label}
    </div>
  );
}
