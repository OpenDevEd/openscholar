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
import type { PaperData } from "./types";
import { searchFiltersValidator } from "./validators";
import {
  buildOpenAlexSearchParams,
  type OpenAlexSearchFilters,
} from "../../lib/openalex/search-params";
import {
  mapOpenAlexWorkToPaperData,
  type OpenAlexWork,
} from "../../lib/openalex/work-mapper";
import { dedupeExpandedSources, expandJobSources } from "./expandSources";
import { createError } from "../lib/errors";
import { normalizeBatchSize, resolveBoundedConcurrency } from "./batching";
import { EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP } from "./bucket/limits";
import {
  classifyUnknownError,
  type ClassifiedError,
} from "@/lib/errors/taxonomy";

const OPENALEX_WORKS_URL = "https://api.openalex.org/works";

// Per-mutation chunk size for createPaperRecords. The per-paper payload
// after the citedByCount/venueName/workType strip is roughly 1.5–2 KB
// (title + abstract dominate), so 100 papers stays comfortably under the
// 1 MiB single-document limit even on the upper-end of abstract size.
const CREATE_PAPER_CHUNK_SIZE = 100;
const QUEUE_LEASE_MS = 60_000;

type SearchFilters = Infer<typeof searchFiltersValidator>;

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

function toOpenAlexSearchFilters(filters: SearchFilters): OpenAlexSearchFilters {
  return {
    query: filters.query ?? "",
    ...(filters.field !== undefined ? { field: filters.field } : {}),
    ...(filters.searchField !== undefined
      ? { searchField: filters.searchField }
      : {}),
    ...(filters.sortBy !== undefined ? { sortBy: filters.sortBy } : {}),
    ...(filters.yearRange !== undefined && filters.yearRange.length >= 2
      ? { yearRange: [filters.yearRange[0], filters.yearRange[1]] }
      : {}),
    ...(filters.dateRange !== undefined ? { dateRange: filters.dateRange } : {}),
    ...(filters.selectedRegions !== undefined
      ? { selectedRegions: filters.selectedRegions }
      : {}),
    ...(filters.selectedCountryFocus !== undefined
      ? { selectedCountryFocus: filters.selectedCountryFocus }
      : {}),
    ...(filters.reviewFilter !== undefined
      ? { reviewFilter: filters.reviewFilter }
      : {}),
    ...(filters.researchAreas !== undefined ? { researchAreas: filters.researchAreas } : {}),
    ...(filters.sdgs !== undefined ? { sdgs: filters.sdgs } : {}),
    ...(filters.openAccessOnly !== undefined ? { openAccessOnly: filters.openAccessOnly } : {}),
    ...(filters.workTypes !== undefined ? { workTypes: filters.workTypes } : {}),
    ...(filters.workLanguages !== undefined ? { workLanguages: filters.workLanguages } : {}),
    ...(filters.institutionTypes !== undefined ? { institutionTypes: filters.institutionTypes } : {}),
    ...(filters.funders !== undefined ? { funders: filters.funders } : {}),
    ...(filters.minCitations !== undefined ? { minCitations: filters.minCitations } : {}),
    ...(filters.hasAbstract !== undefined ? { hasAbstract: filters.hasAbstract } : {}),
    ...(filters.includeRetracted !== undefined ? { includeRetracted: filters.includeRetracted } : {}),
    ...(filters.citesItemId !== undefined ? { citesItemId: filters.citesItemId } : {}),
    ...(filters.citedByItemId !== undefined
      ? { citedByItemId: filters.citedByItemId }
      : {}),
    ...(filters.relatedToItemId !== undefined
      ? { relatedToItemId: filters.relatedToItemId }
      : {}),
    ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
  };
}

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
      }
    : undefined;

  const primaryLocation = isRecord(value.primary_location)
    ? {
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

async function resolveSetupRuntime(
  ctx: ActionCtx,
  job: Doc<"extractionJobs">,
  pdfEnabled: boolean,
): Promise<SetupRuntime> {
  const executionLimits = await ctx.runQuery(
    internal.extraction.bucket.limits.getExtractionExecutionLimitsForUser,
    { userId: job.userId },
  );
  return {
    pdfEnabled,
    paperConcurrency: normalizeBatchSize(executionLimits.paperConcurrency),
    questionConcurrency: resolveBoundedConcurrency(
      executionLimits.questionConcurrencyPerPaper,
      EXTRACTION_QUESTION_CONCURRENCY_INFRA_CLAMP,
    ),
  };
}

export async function runFetchPapersFromHistory(
  searchFilters: SearchFilters,
): Promise<PaperData[]> {
  const searchParams = buildOpenAlexSearchParams(
    toOpenAlexSearchFilters(searchFilters),
  );

  // CORR-02: fail loudly when OPENALEX_CONTACT_EMAIL isn't configured —
  // OpenAlex polite-pool requires a contact address in the UA header.
  const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
  if (!contactEmail) {
    throw new Error(
      "OPENALEX_CONTACT_EMAIL is not configured. Set this env var in the Convex dashboard.",
    );
  }

  const url = `${OPENALEX_WORKS_URL}?${searchParams.toString()}`;
  console.log(`[fetchPapersFromHistory] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": `OpenAlex-Count/1.0 (mailto:${contactEmail})`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `OpenAlex API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const papers = isRecord(data) && Array.isArray(data.results)
    ? data.results.map((work) => mapOpenAlexWorkToPaperData(toOpenAlexWork(work)))
    : [];

  console.log(`[fetchPapersFromHistory] Fetched ${papers.length} papers`);
  const withAbstracts = papers.filter((p) => p.abstract).length;
  console.log(
    `[fetchPapersFromHistory] Papers with abstracts: ${withAbstracts}/${papers.length}`,
  );

  return papers;
}

export const fetchPapersFromHistory = internalAction({
  args: {
    searchFilters: searchFiltersValidator,
  },
  returns: v.array(
    v.object({
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
      publicationYear: v.optional(v.number()),
      abstract: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      pdfUrl: v.optional(v.string()),
      isOpenAccess: v.optional(v.boolean()),
      citedByCount: v.optional(v.number()),
      venueName: v.optional(v.string()),
      workType: v.optional(v.string()),
    }),
  ),
  handler: async (_ctx, args): Promise<PaperData[]> => {
    return await runFetchPapersFromHistory(args.searchFilters);
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

  let cachedZoteroUserId: string | undefined;
  const expandedSources = await expandJobSources(bucketItems, {
    fetchPapersFromHistory: runFetchPapersFromHistory,
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
      // OpenAlex enrichment fields (citedByCount/venueName/workType) are
      // populated for extractionJobSources in chat mode and are NOT
      // persisted on extractionPapers, so strip them at the boundary.
      const { citedByCount: _c, venueName: _v, workType: _w, ...rest } = paper;
      return {
        ...rest,
        storageId: rest.storageId as Id<"_storage"> | undefined,
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
    const runtime = await resolveSetupRuntime(
      ctx,
      initialControl.job,
      initialControl.pdfEnabled,
    );
    const persisted = await runFetchAndPersistPapers(ctx, { jobId });

    const paperLimit = await ctx.runQuery(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId: initialControl.job.userId },
    );
    if (persisted.totalPapers > paperLimit) {
      throw createError(
        "VALIDATION_ERROR",
        `Job would produce ${persisted.totalPapers} papers, exceeding plan limit of ${paperLimit}`,
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
        leaseMs: QUEUE_LEASE_MS,
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
