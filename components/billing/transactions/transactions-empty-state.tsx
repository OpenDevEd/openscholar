"use client";

import Link from "next/link";
import { Filter, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface Props {
  kind: "no-data" | "no-matches";
  onClearFilters?: () => void;
}

export function TransactionsEmptyState({ kind, onClearFilters }: Props) {
  const t = useTranslations("billingPage.transactions.empty");
  const Icon = kind === "no-data" ? Wallet : Filter;

  return (
    <div
      data-transactions-empty={kind}
      role="status"
      className="flex flex-col items-center gap-3 p-8 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">
          {kind === "no-data" ? t("no-data.title") : t("no-matches.title")}
        </p>
        <p className="max-w-[320px] text-xs text-muted-foreground">
          {kind === "no-data"
            ? t("no-data.description")
            : t("no-matches.description")}
        </p>
      </div>
      {kind === "no-data" ? (
        <Button asChild variant="default" size="sm">
          <Link href="/settings/billing#topup">{t("no-data.cta")}</Link>
        </Button>
      ) : (
        onClearFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            data-transactions-empty-clear
          >
            {t("no-matches.cta")}
          </Button>
        )
      )}
    </div>
  );
}
