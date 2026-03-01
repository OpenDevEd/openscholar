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
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-b-0">
      {/* Stars placeholder */}
      <div className="flex gap-px shrink-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-3 w-3 rounded-sm bg-muted animate-pulse"
          />
        ))}
      </div>

      {/* Title */}
      <SkeletonBar className="flex-1 max-w-[300px]" />

      {/* Authors */}
      <SkeletonBar className="w-[120px] hidden sm:block" />

      {/* Year */}
      <SkeletonBar className="w-[40px] hidden sm:block" />

      {/* Journal */}
      <SkeletonBar className="w-[100px] hidden md:block" />

      {/* Menu placeholder */}
      <div className="h-6 w-6 rounded bg-muted animate-pulse shrink-0" />
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
      {/* Stars placeholder */}
      <div className="flex gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-3 w-3 rounded-sm bg-muted animate-pulse" />
        ))}
      </div>
      {/* Title */}
      <SkeletonBar className="w-full" />
      <SkeletonBar className="w-3/4" />
      {/* Authors */}
      <SkeletonBar className="w-1/2" />
      {/* Footer */}
      <div className="flex gap-2 mt-auto">
        <SkeletonBar className="w-12" />
        <SkeletonBar className="w-20" />
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
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
