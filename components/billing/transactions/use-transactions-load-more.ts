"use client";

import { useEffect, type RefObject } from "react";

export type PaginatedStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted"
  | "Deferred";

interface UseTransactionsLoadMoreOpts {
  sentinelRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  status: PaginatedStatus;
  loadMore: (numItems: number) => void;
  batchSize?: number;
  rootMargin?: string;
}

export function useTransactionsLoadMore({
  sentinelRef,
  scrollRef,
  status,
  loadMore,
  batchSize = 25,
  rootMargin = "0px 0px 400px 0px",
}: UseTransactionsLoadMoreOpts): void {
  useEffect(() => {
    if (status !== "CanLoadMore") return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMore(batchSize);
            return;
          }
        }
      },
      { root, rootMargin, threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinelRef, scrollRef, status, loadMore, batchSize, rootMargin]);
}
