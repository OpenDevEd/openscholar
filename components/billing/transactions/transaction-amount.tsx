"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { cn } from "@/lib/utils";

export type TransactionAmountStatus = "routine" | "pending" | "failed" | "expired";

interface Props {
  direction: TransactionViewModel["direction"];
  amount: TransactionViewModel["amount"];
  status: TransactionAmountStatus;
  density: "compact" | "comfortable" | "spacious";
  balanceAfter?: number;
}

export function TransactionAmount({
  direction,
  amount,
  status,
  density,
  balanceAfter,
}: Props) {
  const format = useFormatter();
  const t = useTranslations("billingPage.transactions");
  const sign = direction === "in" ? "+" : "−";
  const isFailure = status === "failed" || status === "expired";
  const showBalance = density !== "compact" && balanceAfter !== undefined;

  return (
    <div
      data-txn-amount=""
      data-txn-direction={direction}
      data-txn-status={status}
      className="flex shrink-0 flex-col items-end gap-0.5 leading-tight"
    >
      <span
        className={cn(
          "tabular-nums text-sm font-semibold leading-none",
          direction === "in" &&
            status === "routine" &&
            "text-emerald-600 dark:text-emerald-500",
          isFailure && "text-destructive",
        )}
      >
        {sign}
        {format.number(amount)}
      </span>
      {showBalance && (
        <span
          className="text-[10.5px] tabular-nums text-muted-foreground/80"
          data-txn-balance=""
        >
          {t("amount.balance", { balance: format.number(balanceAfter!) })}
        </span>
      )}
    </div>
  );
}
