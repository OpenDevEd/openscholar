"use client";

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
  const counts = useBucketStore((s) => {
    const tally: Record<BucketSource, number> = {
      history: 0,
      library: 0,
      collection: 0,
      zotero: 0,
      upload: 0,
    };
    for (const key of s.order) {
      const item = s.items[key];
      if (item && item.status === "ready") tally[item.source]++;
    }
    return tally;
  });
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
