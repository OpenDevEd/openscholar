"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { TransactionsPanel } from "./transactions/transactions-panel";

/**
 * Thin re-export kept for one plan cycle (removed in plan 04).
 * New call sites should mount `<TransactionsPanel searchParams={...} />`
 * directly — this wrapper exists only to keep existing zero-arg
 * `<TransactionsList />` usages working during the migration.
 */
export function TransactionsList() {
  const urlSearchParams = useSearchParams();
  const searchParams = useMemo(
    () => ({ jobId: urlSearchParams.get("jobId") ?? undefined }),
    [urlSearchParams],
  );
  return <TransactionsPanel searchParams={searchParams} />;
}
