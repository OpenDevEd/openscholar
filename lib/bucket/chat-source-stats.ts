import type { BucketItem, BucketSource } from "@/lib/bucket/bucketItem";

type ReadyBucketItem = BucketItem & { status: "ready" };

function isSavedSearchPlaceholder(item: BucketItem): boolean {
  const meta = item.sourceMeta as { isSavedSearch?: boolean } | undefined;
  return meta?.isSavedSearch === true;
}

function paperCount(item: BucketItem): number {
  return item.paperCount ?? 1;
}

export type ChatSourceStats = {
  totalPapers: number;
  concretePapers: number;
  unresolvedPapers: number;
  withAbstractPapers: number;
  missingAbstractPapers: number;
};

export function summarizeChatSources(
  items: ReadonlyArray<BucketItem>,
): ChatSourceStats {
  let totalPapers = 0;
  let concretePapers = 0;
  let unresolvedPapers = 0;
  let withAbstractPapers = 0;
  let missingAbstractPapers = 0;

  for (const item of items) {
    if (item.status !== "ready") continue;

    const count = paperCount(item);
    totalPapers += count;

    if (isSavedSearchPlaceholder(item)) {
      unresolvedPapers += count;
      continue;
    }

    concretePapers += count;
    if (item.abstract && item.abstract.trim().length > 0) {
      withAbstractPapers += count;
    } else {
      missingAbstractPapers += count;
    }
  }

  return {
    totalPapers,
    concretePapers,
    unresolvedPapers,
    withAbstractPapers,
    missingAbstractPapers,
  };
}

/**
 * Grouped breakdown by (source, isSavedSearch). Each row tracks both
 * rowCount (how many bucket items) and paperCount (how many papers they
 * represent) — the two diverge only for saved-search placeholders, where
 * 1 row expands to N papers at submit.
 */
export type ChatSourceBreakdownRow = {
  source: BucketSource;
  isSavedSearch: boolean;
  rowCount: number;
  paperCount: number;
};

export function breakdownChatSources(
  items: ReadonlyArray<BucketItem>,
): ChatSourceBreakdownRow[] {
  const byKey = new Map<string, ChatSourceBreakdownRow>();

  for (const item of items) {
    if (item.status !== "ready") continue;
    const savedSearch = isSavedSearchPlaceholder(item);
    const key = `${item.source}:${savedSearch ? "saved" : "concrete"}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.rowCount += 1;
      existing.paperCount += paperCount(item);
    } else {
      byKey.set(key, {
        source: item.source,
        isSavedSearch: savedSearch,
        rowCount: 1,
        paperCount: paperCount(item),
      });
    }
  }

  return Array.from(byKey.values());
}
