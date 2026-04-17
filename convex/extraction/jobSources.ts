/**
 * extractionJobSources helpers
 *
 * The per-row source payloads (history entries, Zotero items, manual items)
 * used to live inline on `extractionJobs`, which put a hard ceiling on how
 * many papers a single job could accept. They now live in their own child
 * table; callers go through the helpers below so the write / read shape
 * stays consistent across startExtraction, duplicateExtraction,
 * startExtractionFromTemplate, saveWorkflowTemplateFromJob, and the
 * workflow itself.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type JobSourceSearchFilters = NonNullable<
  Doc<"extractionJobSources">["searchFilters"]
>;

export type JobSourceHistoryEntry = {
  historyId: string;
  searchFilters: JobSourceSearchFilters;
};

export type JobSourceZoteroItem = {
  itemKey: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
};

export type JobSourceZoteroSelection = {
  libraryType: "user" | "group";
  groupId?: string;
  zoteroUserId?: string;
  collectionKey?: string;
  includeDescendants?: boolean;
  items: JobSourceZoteroItem[];
};

export type JobSourceManualItem = {
  id: string;
  title: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  pdfUrl?: string;
  storageId?: Id<"_storage">;
};

export type JobSourcesInput = {
  historyEntries?: JobSourceHistoryEntry[];
  zoteroSelection?: JobSourceZoteroSelection;
  manualItems?: JobSourceManualItem[];
};

export async function writeJobSources(
  ctx: MutationCtx,
  jobId: Id<"extractionJobs">,
  sources: JobSourcesInput,
): Promise<void> {
  let position = 0;

  for (const entry of sources.historyEntries ?? []) {
    await ctx.db.insert("extractionJobSources", {
      jobId,
      position: position++,
      kind: "history",
      historyId: entry.historyId,
      searchFilters: entry.searchFilters,
    });
  }

  if (sources.zoteroSelection) {
    const {
      libraryType,
      groupId,
      zoteroUserId,
      collectionKey,
      includeDescendants,
      items,
    } = sources.zoteroSelection;
    for (const item of items) {
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: position++,
        kind: "zotero",
        libraryType,
        groupId,
        zoteroUserId,
        collectionKey,
        includeDescendants,
        itemKey: item.itemKey,
        title: item.title,
        abstract: item.abstract,
        authors: item.authors,
        year: item.year,
        doi: item.doi,
      });
    }
  }

  for (const item of sources.manualItems ?? []) {
    await ctx.db.insert("extractionJobSources", {
      jobId,
      position: position++,
      kind: "manual",
      itemId: item.id,
      title: item.title,
      abstract: item.abstract,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
      pdfUrl: item.pdfUrl,
      storageId: item.storageId,
    });
  }
}

/**
 * Reconstruct the original {historyEntries, zoteroSelection, manualItems}
 * shape from `extractionJobSources` rows. Used by duplicateExtraction and
 * saveWorkflowTemplateFromJob.
 */
export async function readJobSources(
  ctx: QueryCtx | MutationCtx,
  jobId: Id<"extractionJobs">,
  limit: number,
): Promise<Required<Omit<JobSourcesInput, "zoteroSelection">> & {
  zoteroSelection?: JobSourceZoteroSelection;
}> {
  const rows = await ctx.db
    .query("extractionJobSources")
    .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
    .take(limit);

  const historyEntries: JobSourceHistoryEntry[] = [];
  const zoteroItems: JobSourceZoteroItem[] = [];
  let zoteroContext:
    | Omit<JobSourceZoteroSelection, "items">
    | undefined;
  const manualItems: JobSourceManualItem[] = [];

  for (const row of rows) {
    if (row.kind === "history") {
      if (!row.historyId || !row.searchFilters) continue;
      historyEntries.push({
        historyId: row.historyId,
        searchFilters: row.searchFilters,
      });
    } else if (row.kind === "zotero") {
      if (!row.itemKey || !row.libraryType || !row.title) continue;
      if (!zoteroContext) {
        zoteroContext = {
          libraryType: row.libraryType,
          groupId: row.groupId,
          zoteroUserId: row.zoteroUserId,
          collectionKey: row.collectionKey,
          includeDescendants: row.includeDescendants,
        };
      }
      zoteroItems.push({
        itemKey: row.itemKey,
        title: row.title,
        abstract: row.abstract,
        authors: row.authors ?? [],
        year: row.year,
        doi: row.doi,
      });
    } else if (row.kind === "manual") {
      if (!row.itemId || !row.title) continue;
      manualItems.push({
        id: row.itemId,
        title: row.title,
        abstract: row.abstract,
        authors: row.authors,
        year: row.year,
        doi: row.doi,
        pdfUrl: row.pdfUrl,
        storageId: row.storageId,
      });
    }
  }

  return {
    historyEntries,
    zoteroSelection: zoteroContext
      ? { ...zoteroContext, items: zoteroItems }
      : undefined,
    manualItems,
  };
}
