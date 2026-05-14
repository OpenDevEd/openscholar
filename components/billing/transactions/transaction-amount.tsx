"use client";

import { useFormatter } from "next-intl";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { cn } from "@/lib/utils";

export type TransactionAmountStatus = "routine" | "pending" | "failed" | "expired";

interface Props {
  direction: TransactionViewModel["direction"];
  amount: TransactionViewModel["amount"];
  status: TransactionAmountStatus;
  density: "compact" | "comfortable" | "spacious";
}

export function TransactionAmount({ direction, amount, status }: Props) {
  const format = useFormatter();
  const sign = direction === "in" ? "+" : "−";
  const isFailure = status === "failed" || status === "expired";

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
    </div>
  );
}
