import type { BucketItem } from "./bucketItem";

export function bucketItemPaperCount(item: BucketItem): number {
  return item.paperCount ?? 1;
}

export function readyBucketPaperCount(
  items: ReadonlyArray<BucketItem>,
): number {
  let total = 0;
  for (const item of items) {
    if (item.status !== "ready") continue;
    total += bucketItemPaperCount(item);
  }
  return total;
}
