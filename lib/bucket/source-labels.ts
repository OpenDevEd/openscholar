import { Clock, FolderOpen, Library, Upload, ListChecks, type AppIcon } from "@/components/icons";
import type { ComponentType } from "react";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import type { BucketSource } from "@/lib/bucket/bucketItem";

/**
 * Short human-readable label per source. Used by the cross-source
 * dedup hint ("Also staged from Library") and anywhere else the UI
 * surfaces the source of a staged paper.
 */
export const BUCKET_SOURCE_LABELS: Record<BucketSource, string> = {
  screening: "Screening",
  history: "History",
  library: "Library",
  collection: "Collections",
  zotero: "Zotero",
  upload: "Upload",
};

/**
 * CSS variable name (without `var()`) colouring each source's icon. Maps to the chart palette defined in
 * `app/globals.css:68-73`. Chart tokens are light-mode only; OKLCh
 * chroma keeps them legible in dark mode without overrides.
 */
export const SOURCE_COLOR_VAR: Record<BucketSource, string> = {
  screening: "--chart-3",
  history: "--chart-1",
  library: "--chart-2",
  collection: "--chart-3",
  zotero: "--chart-4",
  upload: "--chart-5",
};

/** Each source's icon, coloured by `SOURCE_COLOR_VAR`, the way chat sources are shown. */
export const SOURCE_ICON: Record<BucketSource, AppIcon | ComponentType<{ className?: string }>> = {
  screening: ListChecks,
  history: Clock,
  library: Library,
  collection: FolderOpen,
  zotero: ZoteroIcon,
  upload: Upload,
};
