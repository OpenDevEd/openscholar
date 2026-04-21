"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface Props {
  onRetry: () => void;
  message?: string;
}

export function TransactionsErrorBanner({ onRetry, message }: Props) {
  const t = useTranslations("billingPage.transactions.error");
  return (
    <div
      role="alert"
      data-transactions-error
      className="m-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{message ?? t("message")}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onRetry}
        data-transactions-error-retry
      >
        <RefreshCw className="size-3" aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
