"use client";

import { useQuery } from "convex/react";
import { Package } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBucketStore } from "@/lib/store/bucket";

export function BucketIndicator({
  onClick,
}: {
  onClick: () => void;
}) {
  const limit = useQuery(api.extraction.bucket.queries.getMyPaperLimit) ?? 1000;
  const readyCount = useBucketStore((s) =>
    s.order.reduce(
      (n, k) => n + (s.items[k]?.status === "ready" ? 1 : 0),
      0,
    ),
  );
  const atCap = readyCount >= limit;
  const nearCap = !atCap && readyCount >= Math.floor(limit * 0.9);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("gap-2", atCap && "border-destructive text-destructive")}
    >
      <Package className="h-4 w-4" />
      <span className="font-medium">
        {readyCount} / {limit}
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
