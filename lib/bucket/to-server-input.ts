/**
 * Client → server BucketItem mapping.
 *
 * Normalises a `BucketItem` (which stores source-specific metadata on
 * `sourceMeta`) to the flat shape consumed by the
 * `bucketItemInputValidator` — top-level `searchFilters` + flat zotero
 * fields.
 *
 * Also the single injection point for the P7 CountChip's chosen N:
 * when the source is `"history"`, `paperCount` lands on
 * `searchFilters.limit`, which `fetchPapersFromHistory` reads that many
 * papers of. Without it, the server pulls the cap and the user's choice is
 * cosmetic.
 */
import type { BucketItem } from "./bucketItem";

export type BucketItemServerInput = {
  bucketKey: string;
  source: BucketItem["source"];
  sourceRefId: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  openalexId?: string;
  abstract?: string;
  storageId?: BucketItem["storageId"];
  pdfUrl?: string;
  citedByCount?: number;
  venueName?: string;
  workType?: string;
  searchFilters?: Record<string, unknown>;
  libraryType?: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
};

export function bucketItemToServerInput(
  item: BucketItem,
): BucketItemServerInput {
  const meta = (item.sourceMeta ?? {}) as Record<string, unknown>;

  let searchFilters: Record<string, unknown> | undefined;
  if (item.source === "history") {
    const stored = (meta.searchFilters as Record<string, unknown>) ?? {};
    searchFilters =
      item.paperCount !== undefined
        ? { ...stored, limit: item.paperCount }
        : { ...stored };
  }

  return {
    bucketKey: item.bucketKey,
    source: item.source,
    sourceRefId: item.sourceRefId,
    title: item.title,
    authors: item.authors,
    year: item.year,
    doi: item.doi,
    openalexId: item.openalexId,
    abstract: item.abstract,
    storageId: item.storageId,
    pdfUrl: item.pdfUrl,
    citedByCount: item.citedByCount,
    venueName: item.venueName,
    workType: item.workType,
    searchFilters,
    libraryType:
      item.source === "zotero"
        ? (meta.libraryType as "user" | "group" | undefined)
        : undefined,
    groupId:
      item.source === "zotero"
        ? (meta.groupId as string | undefined)
        : undefined,
    zoteroUserId:
      item.source === "zotero"
        ? (meta.zoteroUserId as string | undefined)
        : undefined,
    collectionKey:
      item.source === "zotero"
        ? (meta.collectionKey as string | undefined)
        : undefined,
  };
}
