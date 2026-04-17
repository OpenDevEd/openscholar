"use client";

import type { Ref } from "react";
import { useQuery } from "convex/react";
import { Package } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBucketStore } from "@/lib/store/bucket";

export function BucketIndicator({
  ref,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
}) {
  const limit = useQuery(api.extraction.bucket.queries.getMyPaperLimit) ?? 1000;
  // Sum `paperCount` (default 1) rather than row count — a staged
  // saved-search entry contributes its expansion size, not 1.
  const readyCount = useBucketStore((s) =>
    s.order.reduce((n, k) => {
      const item = s.items[k];
      return item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
    }, 0),
  );
  const atCap = readyCount >= limit;
  const nearCap = !atCap && readyCount >= Math.floor(limit * 0.9);
  return (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("gap-2", atCap && "border-destructive text-destructive")}
      aria-label={`Open bucket — ${readyCount} of ${limit} papers staged`}
    >
      <Package className="h-4 w-4" />
      <span className="font-medium" aria-hidden="true">
        {readyCount} / {limit}
      </span>
      {/*
        Screen readers get a live region on every count change so staging
        a paper isn't a silent UI update. `polite` (not `assertive`) so
        rapid bulk selects don't flood the assistive-tech queue.
      */}
      <span className="sr-only" aria-live="polite">
        {readyCount} of {limit} papers staged
      </span>
      {nearCap && !atCap && (
        <Badge variant="outline" className="bg-amber-500/10">
          near cap
        </Badge>
      )}
      {atCap && (
        <Badge variant="outline" className="bg-destructive/10">
          at cap
        </Badge>
      )}
    </Button>
  );
}
