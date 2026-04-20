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
  const sign = direction === "in" ? "+" : "−";
  const isFailure = status === "failed" || status === "expired";

  return (
    <div
      data-txn-amount=""
      data-txn-direction={direction}
      data-txn-status={status}
      className="flex shrink-0 flex-col items-end gap-0.5"
    >
      <span
        className={cn(
          "tabular-nums text-sm font-semibold",
          direction === "in" &&
            status === "routine" &&
            "text-emerald-600 dark:text-emerald-500",
          isFailure && "text-destructive",
        )}
      >
        {sign}
        {format.number(amount)}
      </span>
      {density === "spacious" && balanceAfter !== undefined && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 tabular-nums">
          bal&nbsp;{format.number(balanceAfter)}
        </span>
      )}
    </div>
  );
}
