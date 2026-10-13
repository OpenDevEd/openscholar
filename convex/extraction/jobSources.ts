/**
 * extractionJobSources helpers — bucket-native.
 *
 * Every row is a frozen BucketItem. writeJobSources and the setup's step read are
 * the only callers that touch the table outside the schema-level index
 * queries in queries/internal.ts. Consumers (queue setup, duplicate,
 * templates, fixtures) work exclusively with BucketItemInput[].
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { MAX_AUTHORS } from "../lib/listCaps";
import { sourceMetadata, type PaperSourceMetadata } from "../../lib/library/paper-metadata";
/** Where a job's source came from. */
export type BucketSource = "screening" | "history" | "library" | "collection" | "zotero" | "upload" | "evidenceLibrary";

export type JobSourceSearchFilters = NonNullable<
  Doc<"extractionJobSources">["searchFilters"]
>;

export const OLD_SEARCH_MESSAGE =
  "This search was saved before chat and extraction kept its exact request. Add it again from your search history.";

/**
 * Most sources one job has: what one start's arguments can hold, Convex's 8,192 items an
 * array may have. A source that brings many papers, a search or a screening, is one.
 */
export const MAX_JOB_SOURCES = 8_192;

/**
 * Server-side BucketItem shape. Mirrors `lib/bucket/bucketItem.ts::BucketItem`
 * minus the client-only `addedAt` / `status` fields.
 */
export type BucketItemInput = PaperSourceMetadata & {
  bucketKey: string;
  source: BucketSource;
  sourceRefId: string;
  screeningSelection?: Doc<"extractionJobSources">["screeningSelection"];
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  openalexId?: string;
  abstract?: string;
  pdfUrl?: string;
  storageId?: Id<"_storage">;
  citedByCount?: number;
  venueName?: string;
  workType?: string;
  searchFilters?: JobSourceSearchFilters;
  libraryType?: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
  includeDescendants?: boolean;
  librarySet?: Doc<"extractionJobSources">["librarySet"];
  zoteroSet?: Doc<"extractionJobSources">["zoteroSet"];
  evidenceLibrarySet?: Doc<"extractionJobSources">["evidenceLibrarySet"];
};

export function rowFromBucketItem(
  jobId: Id<"extractionJobs">,
  position: number,
  item: BucketItemInput,
) {
  return {
    ...sourceMetadata(item),
    jobId,
    position,
    bucketKey: item.bucketKey,
    source: item.source,
    sourceRefId: item.sourceRefId,
    screeningSelection: item.screeningSelection,
    title: item.title,
    // A source stores its first authors; OpenAlex lists stop at 100 anyway (#426).
    authors: item.authors.slice(0, MAX_AUTHORS),
    year: item.year,
    doi: item.doi,
    openalexId: item.openalexId,
    abstract: item.abstract,
    pdfUrl: item.pdfUrl,
    storageId: item.storageId,
    citedByCount: item.citedByCount,
    venueName: item.venueName,
    workType: item.workType,
    searchFilters: item.searchFilters,
    libraryType: item.libraryType,
    groupId: item.groupId,
    zoteroUserId: item.zoteroUserId,
    collectionKey: item.collectionKey,
    includeDescendants: item.includeDescendants,
    librarySet: item.librarySet,
    zoteroSet: item.zoteroSet,
    evidenceLibrarySet: item.evidenceLibrarySet,
  };
}

export function bucketItemFromRow(row: Doc<"extractionJobSources">): BucketItemInput {
  return {
    ...sourceMetadata(row),
    bucketKey: row.bucketKey,
    source: row.source,
    sourceRefId: row.sourceRefId,
    screeningSelection: row.screeningSelection,
    title: row.title,
    authors: row.authors,
    year: row.year,
    doi: row.doi,
    openalexId: row.openalexId,
    abstract: row.abstract,
    pdfUrl: row.pdfUrl,
    storageId: row.storageId,
    citedByCount: row.citedByCount,
    venueName: row.venueName,
    workType: row.workType,
    searchFilters: row.searchFilters,
    libraryType: row.libraryType,
    groupId: row.groupId,
    zoteroUserId: row.zoteroUserId,
    collectionKey: row.collectionKey,
    includeDescendants: row.includeDescendants,
    librarySet: row.librarySet,
    zoteroSet: row.zoteroSet,
    evidenceLibrarySet: row.evidenceLibrarySet,
  };
}

export async function writeJobSources(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
  items: ReadonlyArray<BucketItemInput>,
): Promise<Id<"extractionJobSources">[]> {
  // Searches saved in the old shape are only read, never written again, so
  // no new job (a duplicate included) carries one.
  if (
    items.some(
      (item) => item.searchFilters && !("openAlexQuery" in item.searchFilters),
    )
  ) {
    throw createError("VALIDATION_ERROR", OLD_SEARCH_MESSAGE);
  }
  // A job reads its sources up to MAX_JOB_SOURCES; one argument array holds no more anyway.
  if (items.length > MAX_JOB_SOURCES) throw createError("VALIDATION_ERROR", `A job takes up to ${MAX_JOB_SOURCES.toLocaleString("en")} sources.`);
  const inserted: Id<"extractionJobSources">[] = [];
  let position = 0;
  for (const item of items) {
    const id = await ctx.db.insert(
      "extractionJobSources",
      rowFromBucketItem(jobId, position++, item),
    );
    inserted.push(id);
  }
  return inserted;
}
