"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface Props {
  status: "pending" | "failed" | "expired";
}

export function TransactionStatusPill({ status }: Props) {
  const t = useTranslations("billingPage.transactions.status");
  return (
    <span
      data-txn-status-pill={status}
      role="status"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        status === "pending" && "bg-primary/10 text-primary txn-pulse",
        status === "failed" && "bg-destructive/10 text-destructive",
        status === "expired" && "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  );
}
