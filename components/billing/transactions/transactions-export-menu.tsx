"use client";

import { useEffect, useRef, useState, type Ref } from "react";
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
  fetchAll: (opts?: {
    signal?: AbortSignal;
    applyCurrentFilters?: boolean;
  }) => Promise<readonly TransactionViewModel[]>;
  /** Imperative handle so Cmd/Ctrl+E can click the trigger. */
  triggerRef?: Ref<HTMLButtonElement>;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionsExportMenu({
  currentView,
  fetchAll,
  triggerRef,
}: Props) {
  const t = useTranslations("billingPage.transactions.export");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const exportCurrent = () => {
    if (currentView.length === 0) return;
    downloadCsv(toCsv(currentView), `transactions-${isoDate()}.csv`);
  };

  const runDrain = (
    mode: "filtered" | "all",
    applyCurrentFilters: boolean,
  ) => {
    if (loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    fetchAll({ signal: controller.signal, applyCurrentFilters })
      .then((all) => {
        if (controller.signal.aborted) return;
        downloadCsv(
          toCsv(all),
          `transactions-${mode}-${isoDate()}.csv`,
        );
      })
      .catch((err: unknown) => {
        const name =
          err && typeof err === "object" && "name" in err
            ? (err as { name: unknown }).name
            : undefined;
        if (name === "AbortError") return;
        // Swallow — network errors don't need drawer-level surfacing here.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
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
          onSelect={() => runDrain("filtered", true)}
          disabled={loading}
          data-export-mode="filtered"
          className="text-xs"
        >
          {t("filtered")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => runDrain("all", false)}
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
