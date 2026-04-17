/**
 * BucketItem — the canonical, cross-source shape that every source tab
 * normalises into and the bucket store keys by. One dedupe key ties
 * every source into the same set.
 */
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
  addedAt: number;
  status: BucketItemStatus;
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
};

export type ZoteroContext = {
  libraryType: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
};

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
