/**
 * extractionJobSources helpers — bucket-native.
 *
 * Every row is a frozen BucketItem. writeJobSources / readJobSources are
 * the only callers that touch the table outside the schema-level index
 * queries in queries/internal.ts. Consumers (workflow, duplicate,
 * templates, fixtures) work exclusively with BucketItemInput[].
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type JobSourceSearchFilters = NonNullable<
  Doc<"extractionJobSources">["searchFilters"]
>;

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
    authors: item.authors,
    year: item.year,
    doi: item.doi,
    openalexId: item.openalexId,
    abstract: item.abstract,
    pdfUrl: item.pdfUrl,
    storageId: item.storageId,
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
    .collect();

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
