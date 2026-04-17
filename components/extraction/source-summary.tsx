"use client";

import { useMemo } from "react";
import { useBucketStore } from "@/lib/store/bucket";
import type { BucketSource } from "@/lib/bucket/bucketItem";

const SOURCE_KEYS: BucketSource[] = [
  "history",
  "library",
  "collection",
  "zotero",
  "upload",
];

export function SourceSummary() {
  const order = useBucketStore((s) => s.order);
  const items = useBucketStore((s) => s.items);

  const counts = useMemo(() => {
    const tally: Record<BucketSource, number> = {
      history: 0,
      library: 0,
      collection: 0,
      zotero: 0,
      upload: 0,
    };
    for (const key of order) {
      const item = items[key];
      if (!item || item.status !== "ready") continue;
      // Per-source tally sums paperCount (default 1) rather than row
      // count, so a saved-search entry of N papers shows up as N, not 1.
      tally[item.source] += item.paperCount ?? 1;
    }
    return tally;
  }, [order, items]);

  const total = SOURCE_KEYS.reduce((n, k) => n + counts[k], 0);

  if (total === 0) return null;

  const pieces = SOURCE_KEYS.filter((k) => counts[k] > 0).map(
    (k) => `${counts[k]} ${k}`,
  );

  return (
    <div className="text-sm text-muted-foreground">
      {total} papers staged · {pieces.join(" · ")}
    </div>
  );
}
