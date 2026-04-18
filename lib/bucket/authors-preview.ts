import type { BucketItem } from "@/lib/bucket/bucketItem";

/**
 * Subtitle shown below a bucket item's title in sidebar + drawer rows.
 *
 * Three cases:
 * 1. Saved-search placeholder (History source): there are no per-paper
 *    authors because the item represents a whole query. Render the
 *    expansion size (`"42 papers"`) — far more useful than "Unknown".
 * 2. Per-paper item with authors: first three joined by ", ", followed
 *    by year if present.
 * 3. Per-paper item with no authors (e.g. a bare Upload): year only, or
 *    empty — never "Unknown", which reads as a data bug to the user.
 */
export function authorsPreview(item: BucketItem): string {
  const meta = item.sourceMeta as { isSavedSearch?: boolean } | undefined;
  if (meta?.isSavedSearch) {
    const count = item.paperCount ?? 0;
    return `${count} ${count === 1 ? "paper" : "papers"}`;
  }

  const authors = item.authors.slice(0, 3).join(", ");
  const parts: string[] = [];
  if (authors) parts.push(authors);
  if (item.year) parts.push(String(item.year));
  return parts.join(" · ");
}
