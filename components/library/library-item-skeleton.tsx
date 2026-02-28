"use client";

import { cn } from "@/lib/utils";

interface LibraryItemSkeletonProps {
  count?: number;
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

export function LibraryItemSkeleton({ count = 5 }: LibraryItemSkeletonProps) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
