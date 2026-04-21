"use client";

import { memo, useCallback, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import {
  renderTitle,
  resolveTitle,
  type Translator,
} from "@/lib/billing/transactions/row-title";
import {
  resolveSecondaryParts,
  type SecondaryPart,
} from "@/lib/billing/transactions/row-secondary";
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
  const tRaw = useTranslations("billingPage.transactions");
  const t = tRaw as unknown as Translator;
  const format = useFormatter();

  const status = resolveStatus(row);
  const titleResolution = resolveTitle(row);
  const title = renderTitle(titleResolution, t);
  const secondaryParts = resolveSecondaryParts(row);
  const secondaryText = buildSecondaryText(row, secondaryParts, format, t);

  const handleClick = useCallback(() => onClick?.(row), [onClick, row]);

  return (
    <div
      role="listitem"
      id={`txn-row-${row.id}`}
      tabIndex={-1}
      data-txn-row=""
      data-txn-id={row.id}
      data-txn-type={row.type}
      data-txn-direction={row.direction}
      data-txn-credit-type={row.creditType}
      data-txn-billing-type={row.billingType ?? "none"}
      data-txn-status={status}
      data-txn-density={density}
      data-txn-title-source={titleResolution.source}
      data-txn-active={isActive || undefined}
      onClick={handleClick}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 border-l-2 px-3 transition-colors",
        density === "compact" && "py-2",
        density === "comfortable" && "py-2.5",
        density === "spacious" && "py-3.5",
        status === "failed" && "border-l-destructive",
        status === "expired" && "border-l-muted-foreground/40",
        status === "pending" && "border-l-primary/60",
        status === "routine" && "border-l-transparent",
        "hover:bg-muted/30",
        isActive && "bg-muted/50 ring-1 ring-ring ring-inset",
      )}
      aria-label={buildAriaLabel(row, title, format, t)}
    >
      <TransactionIcon type={row.type} billingType={row.billingType} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className="line-clamp-1 text-[13px] font-semibold leading-snug text-foreground"
          data-txn-title=""
        >
          {title}
        </p>
        {density !== "compact" && (
          <p
            className="truncate text-[11px] leading-snug text-muted-foreground"
            data-txn-secondary=""
          >
            {secondaryText}
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

      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground/50 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {row.jobId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:text-foreground"
            aria-label={tRaw("actions.openJob")}
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

function renderSecondaryPart(part: SecondaryPart, t: Translator): string {
  if (part.kind === "literal") return part.text;
  return t(part.key, part.values);
}

function buildSecondaryText(
  row: TransactionViewModel,
  parts: readonly SecondaryPart[],
  format: ReturnType<typeof useFormatter>,
  t: Translator,
): ReactNode {
  const pieces: string[] = parts
    .map((p) => renderSecondaryPart(p, t).trim())
    .filter((s) => s.length > 0);
  const when = format.dateTime(new Date(row.createdAt), {
    day: "numeric",
    month: "short",
  });
  if (when && when.length > 0) pieces.push(when);
  return pieces.join(" · ");
}

function buildAriaLabel(
  row: TransactionViewModel,
  title: string,
  format: ReturnType<typeof useFormatter>,
  t: Translator,
): string {
  const sign = row.direction === "in" ? t("aria.credit") : t("aria.debit");
  const amt = format.number(row.amount);
  const date = format.dateTime(new Date(row.createdAt), { dateStyle: "medium" });
  const bal = format.number(row.balanceAfter);
  return `${title}. ${sign} ${amt}. ${t("aria.balanceAfter", { balance: bal })}. ${date}.`;
}
