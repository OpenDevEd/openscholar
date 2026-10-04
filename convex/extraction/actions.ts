/**
 * Extraction Actions — fetch papers from OpenAlex.
 *
 * No `"use node"` directive: this action uses only global `fetch` +
 * `URLSearchParams` (available in the default Convex runtime) and pure
 * helpers lifted to `lib/openalex/`.
 */

import { internalAction, type ActionCtx } from "../_generated/server";
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { storedSearchFiltersValidator } from "./validators";
import { sourceMetadataFields } from "../lib/paperMetadata";
import {
  mapOpenAlexWorkToPaperData,
  type OpenAlexWork,
  type PaperDataOut,
} from "../../lib/openalex/work-mapper";
import { readSearchWorks } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { dedupeExpandedSources, expandJobSources, readLibraryInBatches } from "./expandSources";
import { LIBRARY_READ_BATCH } from "./queries/internal";
import { OLD_SEARCH_MESSAGE } from "./jobSources";
import { createError } from "../lib/errors";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
  EXTRACTION_QUEUE_LEASE_MS,
  PAPER_LIMIT,
  PAPER_PULL_CAP,
} from "../../lib/extraction/limits";
import { OPENALEX_WORK_SELECT_FIELDS } from "../../lib/openalex/search-params";
import {
  classifyUnknownError,
  type ClassifiedError,
} from "@/lib/errors/taxonomy";


// Bound each paper-writing transaction; titles and abstracts dominate its size.
const CREATE_PAPER_CHUNK_SIZE = 100;

type StoredSearchFilters = Infer<typeof storedSearchFiltersValidator>;

type FetchAndPersistPapersResult = {
  paperIds: Array<Id<"extractionPapers">>;
  totalPapers: number;
  processableCount: number;
};

type SetupRuntime = {
  pdfEnabled: boolean;
  paperConcurrency: number;
  questionConcurrency: number;
};

type ActiveSetupControl = {
  job: Doc<"extractionJobs">;
  pdfEnabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function toStringNumberArrayRecord(
  value: unknown,
): Record<string, number[]> | undefined {
  if (!isRecord(value)) return undefined;
  const entries: Array<[string, number[]]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    if (
      Array.isArray(entryValue) &&
      entryValue.every((position): position is number => typeof position === "number")
    ) {
      entries.push([key, entryValue]);
    }
  }
  return Object.fromEntries(entries);
}

function toOpenAlexWork(value: unknown): OpenAlexWork {
  if (!isRecord(value)) return {};

  const openAccess = isRecord(value.open_access)
    ? {
        oa_url: optionalString(value.open_access, "oa_url"),
        is_oa: optionalBoolean(value.open_access, "is_oa"),
        oa_status: optionalString(value.open_access, "oa_status"),
      }
    : undefined;

  const primaryLocation = isRecord(value.primary_location)
    ? {
        pdf_url: optionalString(value.primary_location, "pdf_url"),
        source: isRecord(value.primary_location.source)
          ? {
              display_name: optionalString(
                value.primary_location.source,
                "display_name",
              ),
            }
          : undefined,
      }
    : undefined;

  const authorships = Array.isArray(value.authorships)
    ? value.authorships
        .filter(isRecord)
        .map((authorship) => ({
          author: isRecord(authorship.author)
            ? {
                display_name: optionalString(authorship.author, "display_name"),
              }
            : undefined,
        }))
    : undefined;

  return {
    id: optionalString(value, "id"),
    display_name: optionalString(value, "display_name"),
    doi: optionalString(value, "doi"),
    publication_year: optionalNumber(value, "publication_year"),
    abstract_inverted_index: toStringNumberArrayRecord(
      value.abstract_inverted_index,
    ),
    authorships,
    open_access: openAccess,
    cited_by_count: optionalNumber(value, "cited_by_count"),
    primary_location: primaryLocation,
    best_oa_location: isRecord(value.best_oa_location) ? { pdf_url: optionalString(value.best_oa_location, "pdf_url") } : undefined,
    type: optionalString(value, "type"),
  };
}

function toStructuredJobError(error: ClassifiedError) {
  return {
    code: error.code,
    message: error.message,
    ...(error.context !== undefined ? { context: error.context } : {}),
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerName !== undefined
      ? { providerName: error.providerName }
      : {}),
    at: Date.now(),
  };
}

function canContinueSetup(
  job: Doc<"extractionJobs"> | null,
  expectedEpoch: number,
): job is Doc<"extractionJobs"> {
  if (!job || job.mode !== "extraction") return false;
  if ((job.runEpoch ?? 0) !== expectedEpoch) return false;
  return (
    job.status !== "cancelled" &&
    job.status !== "failed" &&
    job.status !== "completed" &&
    job.status !== "paused" &&
    job.status !== "creditsExhausted"
  );
}

async function loadActiveSetupControl(
  ctx: ActionCtx,
  {
    jobId,
    expectedEpoch,
  }: { jobId: Id<"extractionJobs">; expectedEpoch: number },
): Promise<ActiveSetupControl | null> {
  const { job, pdfEnabled } = await ctx.runQuery(
    internal.extraction.queries.internal.getJobAndFlagsInternal,
    { jobId },
  );
  if (!canContinueSetup(job, expectedEpoch)) return null;
  return { job, pdfEnabled };
}

function setupRuntime(pdfEnabled: boolean): SetupRuntime {
  return {
    pdfEnabled,
    paperConcurrency: EXTRACTION_PAPER_CONCURRENCY,
    questionConcurrency: EXTRACTION_QUESTION_CONCURRENCY,
  };
}

/**
 * A saved search's papers for extraction or chat: the first `limit` of them, in its results
 * page's order (convex/paperSets/openalex.ts), spending the person's OpenAlex allowance.
 */
export async function runFetchPapersFromHistory(
  ctx: ActionCtx,
  userId: Id<"users">,
  searchFilters: StoredSearchFilters,
): Promise<PaperDataOut[]> {
  if (!("openAlexQuery" in searchFilters)) {
    throw createError("VALIDATION_ERROR", OLD_SEARCH_MESSAGE);
  }
  // An unset limit pulls the cap, as the bucket's limits count it (lib/bucket/effective-paper-count.ts).
  const last = Math.min(PAPER_PULL_CAP, Math.floor(searchFilters.limit ?? PAPER_PULL_CAP));
  if (last < 1) return [];
  // Typed here: the generated API's types depend on this module, so inference would loop.
  const user: Doc<"users"> | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
  if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
  const works = await readSearchWorks<unknown>(searchFilters.openAlexQuery, { first: 1, last, select: OPENALEX_WORK_SELECT_FIELDS.join(",") }, spender(ctx, user.clerkId));
  return works.map((work) => mapOpenAlexWorkToPaperData(toOpenAlexWork(work)));
}

export const fetchPapersFromHistory = internalAction({
  args: {
    userId: v.id("users"),
    searchFilters: storedSearchFiltersValidator,
  },
  returns: v.array(
    v.object({
      ...sourceMetadataFields,
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
      publicationYear: v.optional(v.number()),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      citedByCount: v.optional(v.number()),
      venueName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args): Promise<PaperDataOut[]> => {
    return await runFetchPapersFromHistory(ctx, args.userId, args.searchFilters);
  },
});

/**
 * Expands job bucket sources, dedupes papers, persists paper rows, and
 * returns only inserted IDs plus small counts. Paper payloads stay in the
 * database so the setup action never carries a large in-memory handoff.
 */
export async function runFetchAndPersistPapers(
  ctx: ActionCtx,
  { jobId }: { jobId: Id<"extractionJobs"> },
): Promise<FetchAndPersistPapersResult> {
  const bucketItems = await ctx.runQuery(
    internal.extraction.queries.internal.getJobSourcesInternal,
    { jobId },
  );
  const job: Doc<"extractionJobs"> | null = await ctx.runQuery(internal.extraction.queries.internal.getJobInternal, { jobId });
  if (!job) throw createError("NOT_FOUND", "Job not found");

  let cachedZoteroUserId: string | undefined;
  const expandedSources = await expandJobSources(bucketItems, {
    fetchPapersFromHistory: (searchFilters) => runFetchPapersFromHistory(ctx, job.userId, searchFilters),
    readLibraryItems: (ids) =>
      readLibraryInBatches(ids, LIBRARY_READ_BATCH, (batch) => ctx.runQuery(internal.extraction.queries.internal.ownedLibraryItems, { userId: job.userId, ids: batch })),
    resolveZoteroUserId: async () => {
      if (cachedZoteroUserId !== undefined) return cachedZoteroUserId;
      try {
        const resolved = await ctx.runQuery(
          internal.zotero.queries.getZoteroUserIdInternal,
          {},
        );
        cachedZoteroUserId = resolved ?? undefined;
      } catch {
        cachedZoteroUserId = undefined;
      }
      return cachedZoteroUserId;
    },
  });

  if (expandedSources.length === 0) {
    throw createError("VALIDATION_ERROR", "No sources selected");
  }

  const dedupedPapers = dedupeExpandedSources(expandedSources).map(
    ({ paper, sourceType, sourceId }) => {
      return {
        ...paper,
        storageId: paper.storageId as Id<"_storage"> | undefined,
        sourceType,
        sourceId,
      };
    },
  );

  console.log(
    `[fetchAndPersistPapers] Fetched ${expandedSources.length} papers (${dedupedPapers.length} deduped); persisting in chunks of ${CREATE_PAPER_CHUNK_SIZE}`,
  );

  const allPaperIds: Array<Id<"extractionPapers">> = [];
  let processableCount = 0;
  for (let i = 0; i < dedupedPapers.length; i += CREATE_PAPER_CHUNK_SIZE) {
    const batch = dedupedPapers.slice(i, i + CREATE_PAPER_CHUNK_SIZE);
    const result = await ctx.runMutation(
      internal.extraction.mutations.papers.createPaperRecords,
      { jobId, papers: batch },
    );
    allPaperIds.push(...result.paperIds);
    processableCount += result.processableCount;
  }

  console.log(
    `[fetchAndPersistPapers] Persisted ${allPaperIds.length} papers (${processableCount} processable)`,
  );

  return {
    paperIds: allPaperIds,
    totalPapers: dedupedPapers.length,
    processableCount,
  };
}

export const fetchAndPersistPapers = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
  },
  returns: v.object({
    paperIds: v.array(v.id("extractionPapers")),
    totalPapers: v.number(),
    processableCount: v.number(),
  }),
  handler: async (ctx, args): Promise<FetchAndPersistPapersResult> => {
    return await runFetchAndPersistPapers(ctx, args);
  },
});

export async function runSetupExtractionQueueJob(
  ctx: ActionCtx,
  {
    jobId,
    expectedEpoch,
  }: {
    jobId: Id<"extractionJobs">;
    expectedEpoch: number;
  },
): Promise<void> {
  const initialControl = await loadActiveSetupControl(ctx, {
    jobId,
    expectedEpoch,
  });
  if (!initialControl) return;

  try {
    const runtime = setupRuntime(initialControl.pdfEnabled);
    const persisted = await runFetchAndPersistPapers(ctx, { jobId });

    if (persisted.totalPapers > PAPER_LIMIT) {
      throw createError(
        "VALIDATION_ERROR",
        `Job would produce ${persisted.totalPapers} papers, exceeding the limit of ${PAPER_LIMIT}`,
      );
    }

    const afterExpansionControl = await loadActiveSetupControl(ctx, {
      jobId,
      expectedEpoch,
    });
    if (!afterExpansionControl) return;

    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: runtime.pdfEnabled ? "downloading_pdfs" : "indexing",
        totalPapers: persisted.processableCount,
      },
    );

    if (persisted.paperIds.length === 0 || persisted.processableCount === 0) {
      await ctx.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId, expectedEpoch },
      );
      return;
    }

    const beforeDispatchControl = await loadActiveSetupControl(ctx, {
      jobId,
      expectedEpoch,
    });
    if (!beforeDispatchControl) return;

    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: "extracting",
      },
    );

    const queued = await ctx.runMutation(
      internal.extraction.queue.mutations.enqueueInitialPapersForJob,
      {
        jobId,
        paperIds: persisted.paperIds,
        expectedEpoch,
        priority: 0,
      },
    );

    if (queued.enqueued + queued.existing === 0) {
      await ctx.runMutation(
        internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob,
        { jobId, expectedEpoch },
      );
      return;
    }

    await ctx.runMutation(
      internal.extraction.queue.mutations.dispatchPaperQueueWindow,
      {
        jobId,
        expectedEpoch,
        paperConcurrency: runtime.paperConcurrency,
        leaseOwner: `setup:${jobId}:${expectedEpoch}`,
        leaseMs: EXTRACTION_QUEUE_LEASE_MS,
        questionConcurrency: runtime.questionConcurrency,
        pdfEnabled: runtime.pdfEnabled,
      },
    );
  } catch (error) {
    const classified = classifyUnknownError(error);
    await ctx.runMutation(
      internal.extraction.mutations.results.updateJobStatus,
      {
        jobId,
        expectedEpoch,
        status: "failed",
        error: toStructuredJobError(classified),
      },
    );
  }
}

export const setupExtractionQueueJob = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await runSetupExtractionQueueJob(ctx, args);
    return null;
  },
});
