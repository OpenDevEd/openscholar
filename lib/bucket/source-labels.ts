import type { BucketSource } from "@/lib/bucket/bucketItem";

/**
 * Short human-readable label per source. Used by the cross-source
 * dedup hint ("Also staged from Library") and anywhere else the UI
 * surfaces the source of a staged paper.
 */
export const BUCKET_SOURCE_LABELS: Record<BucketSource, string> = {
  history: "History",
  library: "Library",
  collection: "Collections",
  zotero: "Zotero",
  upload: "Upload",
};
