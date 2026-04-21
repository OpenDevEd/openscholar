"use client";

import { useFormatter, useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { cn } from "@/lib/utils";

import { DrawerLinkedEntities } from "./drawer-linked-entities";
import { DrawerMetadataTable } from "./drawer-metadata-table";
import { DrawerStripeSection } from "./drawer-stripe-section";
import { TransactionIcon } from "./transaction-icon";

interface Props {
  row: TransactionViewModel | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDetailDrawer({ row, onOpenChange }: Props) {
  const t = useTranslations("billingPage.transactions.drawer");
  const tType = useTranslations("billingPage.transactions.type");
  const tBilling = useTranslations("billingPage.transactions.billingType");
  const tCreditPool = useTranslations(
    "billingPage.transactions.filters.creditPoolValues",
  );
  const format = useFormatter();

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-transaction-drawer
        data-transaction-id={row?.id}
        className="flex w-[min(480px,92vw)] flex-col gap-0 border-l bg-background p-0 sm:max-w-none"
      >
        {row && (
          <>
            <SheetHeader className="flex-row items-start justify-between gap-3 space-y-0 border-b border-border/50 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <TransactionIcon
                  type={row.type}
                  billingType={row.billingType}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <SheetTitle className="truncate text-sm font-semibold">
                    {row.description ?? tType(row.type)}
                  </SheetTitle>
                  <SheetDescription
                    asChild
                    className="text-[11px] text-muted-foreground"
                  >
                    <time dateTime={new Date(row.createdAt).toISOString()}>
                      {format.dateTime(new Date(row.createdAt), {
                        dateStyle: "full",
                        timeStyle: "short",
                      })}
                    </time>
                  </SheetDescription>
                </div>
              </div>
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={t("close")}
                  data-drawer-close
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </SheetClose>
            </SheetHeader>

            <div
              data-drawer-body
              className="flex flex-1 flex-col gap-4 overflow-auto px-4 py-4"
            >
              <div
                data-drawer-section="amount"
                className="flex flex-col gap-1"
              >
                <span
                  data-drawer-amount
                  data-direction={row.direction}
                  className={cn(
                    "text-3xl font-semibold tabular-nums",
                    row.direction === "in" &&
                      "text-emerald-600 dark:text-emerald-500",
                  )}
                >
                  {row.direction === "in" ? "+" : "−"}
                  {format.number(row.amount)}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("balanceAfter", {
                    balance: format.number(row.balanceAfter),
                  })}
                </span>
              </div>

              <div
                data-drawer-section="badges"
                className="flex flex-wrap gap-1.5"
              >
                <Badge
                  variant="outline"
                  data-drawer-badge="credit-pool"
                  data-value={row.creditType}
                >
                  {tCreditPool(row.creditType)}
                </Badge>
                {row.billingType && (
                  <Badge
                    variant="outline"
                    data-drawer-badge="billing-type"
                    data-value={row.billingType}
                  >
                    {tBilling(row.billingType)}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  data-drawer-badge="type"
                  data-value={row.type}
                >
                  {tType(row.type)}
                </Badge>
              </div>

              <DrawerLinkedEntities
                jobId={row.jobId}
                paperId={row.paperId}
                resultId={row.resultId}
              />

              {row.hasStripe && (
                <DrawerStripeSection
                  invoiceId={row.stripeInvoiceId}
                  paymentIntentId={row.stripePaymentIntentId}
                  chargeId={row.stripeChargeId}
                  checkoutSessionId={row.stripeCheckoutSessionId}
                />
              )}

              <DrawerMetadataTable metadata={row.metadata} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
