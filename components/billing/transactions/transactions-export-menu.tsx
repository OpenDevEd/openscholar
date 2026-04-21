"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadCsv, toCsv } from "@/lib/billing/transactions/export-csv";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

interface Props {
  currentView: readonly TransactionViewModel[];
  fetchAll: () => Promise<readonly TransactionViewModel[]>;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionsExportMenu({ currentView, fetchAll }: Props) {
  const t = useTranslations("billingPage.transactions.export");
  const [loading, setLoading] = useState(false);

  const exportCurrent = () => {
    if (currentView.length === 0) return;
    downloadCsv(toCsv(currentView), `transactions-${isoDate()}.csv`);
  };

  const exportAll = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const all = await fetchAll();
      downloadCsv(toCsv(all), `transactions-all-${isoDate()}.csv`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={loading}
          data-transactions-export-trigger
          data-transactions-export-loading={loading || undefined}
          aria-label={t("label")}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          {t("label")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          onSelect={exportCurrent}
          disabled={currentView.length === 0}
          data-export-mode="current"
          className="text-xs"
        >
          {t("current", { count: currentView.length })}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={exportAll}
          disabled={loading}
          data-export-mode="all"
          className="text-xs"
        >
          {t("all")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
