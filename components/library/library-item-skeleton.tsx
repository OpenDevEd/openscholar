"use client";

import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types";

interface LibraryItemSkeletonProps {
  count?: number;
  viewMode?: ViewMode;
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-3 rounded bg-muted animate-pulse",
        className,
      )}
    />
  );
}

function SkeletonRow() {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        "bg-background/80 dark:bg-background/60",
        "border-border/40 shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SkeletonBar className="h-8 w-24" />
            <SkeletonBar className="h-6 w-28 rounded-full" />
            <SkeletonBar className="h-6 w-20 rounded-full" />
          </div>
          <div className="space-y-2">
            <SkeletonBar className="h-4 w-full max-w-xl" />
            <SkeletonBar className="h-4 w-2/3" />
            <SkeletonBar className="h-3 w-1/2" />
          </div>
          <div className="space-y-2">
            <SkeletonBar className="h-3 w-full" />
            <SkeletonBar className="h-3 w-full" />
            <SkeletonBar className="h-3 w-4/5" />
          </div>
        </div>
        <div className="h-9 w-9 rounded-lg bg-muted animate-pulse shrink-0" />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className={cn(
      "rounded-2xl border p-4 flex flex-col gap-2",
      "bg-background/80 dark:bg-background/60",
      "border-border/40"
    )}>
      <div className="flex justify-between gap-3">
        <SkeletonBar className="h-6 w-14 rounded-md" />
        <div className="flex gap-1">
          <SkeletonBar className="h-7 w-7 rounded-md" />
          <SkeletonBar className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <SkeletonBar className="h-4 w-full" />
      <SkeletonBar className="h-4 w-4/5" />
      <SkeletonBar className="h-3 w-3/5" />
      <div className="flex flex-wrap gap-2 mt-1">
        <SkeletonBar className="h-5 w-24 rounded-full" />
        <SkeletonBar className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-2 mt-auto">
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-2/3" />
      </div>
    </div>
  );
}

function SkeletonSimple() {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        "bg-background/80 dark:bg-background/60",
        "border-border/40",
      )}
    >
      <div className="flex items-center gap-3">
        <SkeletonBar className="h-7 w-20" />
        <SkeletonBar className="h-4 w-full max-w-md" />
        <SkeletonBar className="h-6 w-14 rounded-full shrink-0" />
      </div>
    </div>
  );
}

export function LibraryItemSkeleton({ count = 5, viewMode = "list-detail" }: LibraryItemSkeletonProps) {
  if (viewMode === "grid-2" || viewMode === "grid-3") {
    const cols = viewMode === "grid-2" ? "grid-cols-2" : "grid-cols-3";
    return (
      <div className={cn("grid gap-3", cols)}>
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (viewMode === "list-simple") {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonSimple key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
