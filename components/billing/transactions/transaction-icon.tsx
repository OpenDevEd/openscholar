"use client";

import { memo } from "react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import {
  BILLING_TYPE_ICON,
  presentationFor,
} from "@/lib/billing/transactions/presentation";
import { cn } from "@/lib/utils";

interface Props {
  type: TransactionViewModel["type"];
  billingType: TransactionViewModel["billingType"];
  className?: string;
}

function TransactionIconImpl({ type, billingType, className }: Props) {
  const { icon: Icon, colorVar } = presentationFor(type);
  const SubIcon = billingType ? BILLING_TYPE_ICON[billingType] : null;

  return (
    <div
      data-txn-icon=""
      data-txn-type={type}
      data-txn-billing-type={billingType ?? "none"}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklch, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
      }}
    >
      <Icon className="size-4" aria-hidden="true" />
      {SubIcon && (
        <span
          className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-background"
          aria-hidden="true"
        >
          <SubIcon className="size-2.5 text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

export const TransactionIcon = memo(TransactionIconImpl);
