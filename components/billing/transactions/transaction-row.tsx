"use client";

import { memo, useCallback } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import type { BillingType } from "@/lib/billing/transactions/presentation";
import { TransactionIcon } from "./transaction-icon";
import { TransactionAmount } from "./transaction-amount";
import { TransactionStatusPill } from "./transaction-status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RowStatus = "routine" | "pending" | "failed" | "expired";
type Density = "compact" | "comfortable" | "spacious";

export interface TransactionRowProps {
  row: TransactionViewModel;
  density: Density;
  isActive?: boolean;
  onClick?: (row: TransactionViewModel) => void;
}

function TransactionRowImpl({
  row,
  density,
  isActive = false,
  onClick,
}: TransactionRowProps) {
  const t = useTranslations("billingPage.transactions");
  const tType = useTranslations("billingPage.transactions.type");
  const tBilling = useTranslations("extraction.cost.breakdown");
  const format = useFormatter();

  const status = resolveStatus(row);
  const title = row.description ?? tType(row.type);
  const billingLabel = row.billingType ? tBilling(billingKey(row.billingType)) : null;
  const secondary = buildSecondaryLine(row, format, billingLabel);

  const handleClick = useCallback(() => onClick?.(row), [onClick, row]);

  return (
    <div
      role="listitem"
      id={`txn-row-${row.id}`}
      data-txn-row=""
      data-txn-id={row.id}
      data-txn-type={row.type}
      data-txn-direction={row.direction}
      data-txn-credit-type={row.creditType}
      data-txn-billing-type={row.billingType ?? "none"}
      data-txn-status={status}
      data-txn-density={density}
      data-txn-active={isActive || undefined}
      onClick={handleClick}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 border-l-2 px-3 transition-colors",
        density === "compact" && "py-2",
        density === "comfortable" && "py-2.5",
        density === "spacious" && "py-3",
        status === "failed" && "border-l-destructive",
        status === "expired" && "border-l-muted-foreground/40",
        status === "pending" && "border-l-primary/60",
        status === "routine" && "border-l-transparent",
        "hover:bg-muted/40",
        isActive && "bg-muted/60 ring-1 ring-ring ring-inset",
      )}
      aria-label={buildAriaLabel(row, format)}
    >
      <TransactionIcon type={row.type} billingType={row.billingType} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-1 text-[13px] font-semibold leading-snug text-foreground">
          {title}
        </p>
        {density !== "compact" && (
          <p className="truncate text-[11px] text-muted-foreground">
            {secondary}
          </p>
        )}
      </div>

      {status !== "routine" && <TransactionStatusPill status={status} />}

      <TransactionAmount
        direction={row.direction}
        amount={row.amount}
        status={status}
        density={density}
        balanceAfter={row.balanceAfter}
      />

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {row.jobId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            aria-label={t("actions.openJob")}
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/extraction/${row.jobId}`}>
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export const TransactionRow = memo(
  TransactionRowImpl,
  (prev, next) =>
    prev.row === next.row &&
    prev.density === next.density &&
    prev.isActive === next.isActive &&
    prev.onClick === next.onClick,
);

function resolveStatus(row: TransactionViewModel): RowStatus {
  if (row.type === "expiry") return "expired";
  return "routine";
}

type BillingLabelKey = "indexing" | "extraction" | "screening" | "chat";

function buildSecondaryLine(
  row: TransactionViewModel,
  format: ReturnType<typeof useFormatter>,
  billingLabel: string | null,
): string {
  const parts: string[] = [];
  if (billingLabel) parts.push(billingLabel);
  parts.push(
    format.dateTime(new Date(row.createdAt), {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  );
  return parts.join(" · ");
}

function billingKey(billingType: BillingType): BillingLabelKey {
  if (billingType === "embedding") return "indexing";
  if (billingType === "extraction_llm") return "extraction";
  return billingType;
}

function buildAriaLabel(
  row: TransactionViewModel,
  format: ReturnType<typeof useFormatter>,
): string {
  const sign = row.direction === "in" ? "credit" : "debit";
  const amt = format.number(row.amount);
  const date = format.dateTime(new Date(row.createdAt), { dateStyle: "medium" });
  return `${row.type} ${sign} ${amt} credits, ${date}`;
}
