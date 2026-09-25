/**
 * BucketItem — the canonical, cross-source shape that every source tab
 * normalises into and the bucket store keys by. One dedupe key ties
 * every source into the same set.
 */
import type { BucketSearchFilters } from "@/lib/chat/params-to-bucket-filters";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { buildDedupeKey } from "./dedupe";

export type BucketSource =
  | "history"
  | "library"
  | "collection"
  | "zotero"
  | "upload";

export type BucketItemStatus = "ready" | "uploading" | "failed";

export type BucketItem = {
  bucketKey: string;
  source: BucketSource;
  sourceRefId: string;
  sourceMeta?: Record<string, unknown>;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  openalexId?: string;
  abstract?: string;
  storageId?: Id<"_storage">;
  pdfUrl?: string;
  // Per-paper signals threaded into the chat-mode AI context. Optional —
  // zotero/upload sources cannot populate them.
  citedByCount?: number;
  venueName?: string;
  workType?: string;
  addedAt: number;
  status: BucketItemStatus;
  /**
   * How many papers this row will produce at submission time. 1 for
   * per-paper sources (library / collection / zotero / upload). N for
   * placeholder rows that expand at run time — a saved-search entry
   * stands in for `entry.count` actual papers. Cap math and the UI
   * ready-count indicator sum this rather than counting rows, so a
   * user staging three 800-paper searches sees the cap exhausted
   * before submit, not after.
   */
  paperCount?: number;
};

export type SearchHistoryPaperInput = {
  openalexId: string;
  title: string;
  authors?: string[];
  doi?: string;
  year?: number;
  abstract?: string;
  pdfUrl?: string;
};

export function fromSearchHistoryEntry(
  paper: SearchHistoryPaperInput,
  historyId: string,
  now: number = Date.now(),
): BucketItem {
  return {
    bucketKey: buildDedupeKey({
      openalexId: paper.openalexId,
      doi: paper.doi,
      title: paper.title,
      year: paper.year,
    }),
    source: "history",
    sourceRefId: historyId,
    sourceMeta: { historyId },
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.year,
    doi: paper.doi,
    openalexId: paper.openalexId,
    abstract: paper.abstract,
    pdfUrl: paper.pdfUrl,
    addedAt: now,
    status: "ready",
  };
}

export type SavedSearchInput = {
  id: string;
  query: string;
  count?: number;
  searchFilters: BucketSearchFilters;
};

/**
 * Saved-search placeholder BucketItem. Represents an entire historical
 * search query; expanded to paper rows server-side at job submit time.
 * Used by the History source tab until the tab is refactored to fetch
 * live paper results and produce per-paper bucket items.
 */
export function fromSavedSearchQuery(
  entry: SavedSearchInput,
  now: number = Date.now(),
): BucketItem {
  return {
    bucketKey: `history:${entry.id}`,
    source: "history",
    sourceRefId: entry.id,
    sourceMeta: {
      historyId: entry.id,
      searchFilters: entry.searchFilters,
      count: entry.count,
      isSavedSearch: true,
    },
    title: entry.query,
    authors: [],
    addedAt: now,
    status: "ready",
    paperCount: entry.count ?? 0,
  };
}

function splitLibraryAuthors(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fromLibraryItem(
  item: Doc<"libraryItems">,
  now: number = Date.now(),
): BucketItem {
  return {
    bucketKey: buildDedupeKey({
      openalexId: item.openalexId || undefined,
      doi: item.doi,
      title: item.title,
      year: item.publicationYear,
    }),
    source: "library",
    sourceRefId: item._id,
    title: item.title,
    authors: splitLibraryAuthors(item.authors),
    year: item.publicationYear,
    doi: item.doi,
    openalexId: item.openalexId || undefined,
    abstract: item.abstract,
    citedByCount: item.citedByCount,
    venueName: item.journal,
    workType: item.workType,
    addedAt: now,
    status: "ready",
  };
}

export function fromCollectionItem(
  item: Doc<"libraryItems">,
  collectionId: Id<"collections">,
  now: number = Date.now(),
): BucketItem {
  const base = fromLibraryItem(item, now);
  return {
    ...base,
    source: "collection",
    sourceMeta: { collectionId },
  };
}

export type ZoteroItemInput = {
  itemKey: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  abstract?: string;
  venueName?: string;
  workType?: string;
};

export type ZoteroContext = {
  libraryType: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
};

/**
 * Pure bucketKey computation for a Zotero row. `fromZoteroItem`
 * rebuilds the full BucketItem (sourceMeta, addedAt, status, etc.) —
 * useful for staging, wasteful for the `isSelected` hot path that's
 * called once per visible row per render. Keep this in sync with
 * `fromZoteroItem` below.
 */
export function zoteroBucketKeyFor(
  item: Pick<ZoteroItemInput, "doi" | "title" | "year">,
): string {
  return buildDedupeKey({
    doi: item.doi,
    title: item.title,
    year: item.year,
  });
}

export function fromZoteroItem(
  item: ZoteroItemInput,
  context: ZoteroContext,
  now: number = Date.now(),
): BucketItem {
  const meta: Record<string, unknown> = {
    libraryType: context.libraryType,
  };
  if (context.groupId !== undefined) meta.groupId = context.groupId;
  if (context.zoteroUserId !== undefined)
    meta.zoteroUserId = context.zoteroUserId;
  if (context.collectionKey !== undefined)
    meta.collectionKey = context.collectionKey;

  return {
    bucketKey: buildDedupeKey({
      doi: item.doi,
      title: item.title,
      year: item.year,
    }),
    source: "zotero",
    sourceRefId: item.itemKey,
    sourceMeta: meta,
    title: item.title,
    authors: item.authors ?? [],
    year: item.year,
    doi: item.doi,
    abstract: item.abstract,
    venueName: item.venueName,
    workType: item.workType,
    addedAt: now,
    status: "ready",
  };
}

export type UploadInput = {
  uploadId: string;
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
  abstract?: string;
  storageId?: Id<"_storage">;
  status?: BucketItemStatus;
};

export function fromUpload(
  upload: UploadInput,
  now: number = Date.now(),
): BucketItem {
  const key = upload.doi
    ? buildDedupeKey({ doi: upload.doi })
    : `upload:${upload.uploadId}`;
  return {
    bucketKey: key,
    source: "upload",
    sourceRefId: upload.uploadId,
    title: upload.title,
    authors: upload.authors ?? [],
    year: upload.year,
    doi: upload.doi,
    abstract: upload.abstract,
    storageId: upload.storageId,
    addedAt: now,
    status: upload.status ?? "uploading",
  };
}
