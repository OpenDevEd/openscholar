/**
 * extractionJobSources helpers — bucket-native.
 *
 * Every row is a frozen BucketItem. writeJobSources / readJobSources are
 * the only callers that touch the table outside the schema-level index
 * queries in queries/internal.ts. Consumers (queue setup, duplicate,
 * templates, fixtures) work exclusively with BucketItemInput[].
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { MAX_AUTHORS } from "../lib/listCaps";
import { PAPER_LIMIT } from "../../lib/extraction/limits";

export type JobSourceSearchFilters = NonNullable<
  Doc<"extractionJobSources">["searchFilters"]
>;

export const OLD_SEARCH_MESSAGE =
  "This search was saved before chat and extraction kept its exact request. Add it again from your search history.";

export type BucketSource =
  | "history"
  | "library"
  | "collection"
  | "zotero"
  | "upload";

/**
 * Server-side BucketItem shape. Mirrors `lib/bucket/bucketItem.ts::BucketItem`
 * minus the client-only `addedAt` / `status` fields.
 */
export type BucketItemInput = {
  bucketKey: string;
  source: BucketSource;
  sourceRefId: string;
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
};

export function rowFromBucketItem(
  jobId: Id<"extractionJobs">,
  position: number,
  item: BucketItemInput,
) {
  return {
    jobId,
    position,
    bucketKey: item.bucketKey,
    source: item.source,
    sourceRefId: item.sourceRefId,
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
  };
}

function bucketItemFromRow(row: Doc<"extractionJobSources">): BucketItemInput {
  return {
    bucketKey: row.bucketKey,
    source: row.source,
    sourceRefId: row.sourceRefId,
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
  // Every source brings at least one paper, and a job holds PAPER_LIMIT papers, so it holds
  // no more sources than that; its source rows then read in one query.
  if (items.length > PAPER_LIMIT) {
    throw createError("VALIDATION_ERROR", `A job can have up to ${PAPER_LIMIT.toLocaleString("en")} sources.`);
  }
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

export async function replaceJobSources(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
  items: ReadonlyArray<BucketItemInput>,
): Promise<Id<"extractionJobSources">[]> {
  const existing = await ctx.db
    .query("extractionJobSources")
    .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
    .take(PAPER_LIMIT);

  for (const row of existing) {
    await ctx.db.delete(row._id);
  }

  return await writeJobSources(ctx, jobId, items);
}

export async function readJobSources(
  ctx: QueryCtx | MutationCtx,
  jobId: Id<"extractionJobs">,
  limit: number,
): Promise<BucketItemInput[]> {
  const rows = await ctx.db
    .query("extractionJobSources")
    .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
    .take(limit);
  return rows.map(bucketItemFromRow);
}
