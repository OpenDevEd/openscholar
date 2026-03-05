"use client";

import { cn } from "@/lib/utils";

interface LibraryItemSkeletonProps {
  count?: number;
  viewMode?: "list" | "grid";
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
            <div className="flex gap-px shrink-0">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-3.5 w-3.5 rounded-sm bg-muted animate-pulse"
                />
              ))}
            </div>
            <SkeletonBar className="h-6 w-28 rounded-full" />
            <SkeletonBar className="h-6 w-20 rounded-full" />
            <SkeletonBar className="h-6 w-32 rounded-full" />
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
        <div className="flex gap-px">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-3 w-3 rounded-sm bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
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

export function LibraryItemSkeleton({ count = 5, viewMode = "list" }: LibraryItemSkeletonProps) {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} />
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
