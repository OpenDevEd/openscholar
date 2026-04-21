"use client";

import { memo } from "react";

interface Props {
  count?: number;
}

function SkeletonRowImpl() {
  return (
    <div
      aria-hidden="true"
      data-txn-row-skeleton=""
      className="flex items-center gap-3 border-b border-border/30 px-3 py-2.5"
    >
      <div className="size-8 shrink-0 rounded-md bg-muted motion-safe:animate-pulse" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-[60%] rounded bg-muted motion-safe:animate-pulse" />
        <div className="h-2.5 w-[40%] rounded bg-muted/70 motion-safe:animate-pulse" />
      </div>
      <div className="h-4 w-16 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  );
}

const SkeletonRow = memo(SkeletonRowImpl);

export function TransactionsListSkeleton({ count = 6 }: Props) {
  return (
    <div
      aria-hidden="true"
      data-transactions-skeleton=""
      data-transactions-skeleton-count={count}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
