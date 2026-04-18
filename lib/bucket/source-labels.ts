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

/**
 * CSS variable name (without `var()`) driving the colored dot on each
 * source chip. Maps to the chart palette defined in
 * `app/globals.css:68-73`. Chart tokens are light-mode only; OKLCh
 * chroma keeps them legible in dark mode without overrides.
 */
export const SOURCE_COLOR_VAR: Record<BucketSource, string> = {
  history: "--chart-1",
  library: "--chart-2",
  collection: "--chart-3",
  zotero: "--chart-4",
  upload: "--chart-5",
};
