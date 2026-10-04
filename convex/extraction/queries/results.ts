/**
 * Job-results queries. The page query reads the projection-backed filtered
 * corpus, so counts and sorting stay full-corpus correct; an export reads it
 * page by page.
 */

import { query, type QueryCtx } from "../../_generated/server";
import { v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import type { Doc, Id } from "../../_generated/dataModel";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { PAPER_LIMIT, RESULTS_PAGE_SIZE_MAX } from "@/lib/extraction/limits";
import {
  paginatedPaperWithResultsValidator,
  resultsPageFiltersValidator,
  resultsSortByValidator,
} from "../validators";
import {
  loadResultsByPaperIds,
} from "./_shared";
import {
  buildQuestionAnswerToken,
} from "../listProjection";

const jobResultsPageOkValidator = v.object({
  status: v.literal("ok"),
  totalAll: v.number(),
  totalFiltered: v.number(),
  totalPages: v.number(),
  page: v.number(),
  pageSize: v.number(),
  items: v.array(paginatedPaperWithResultsValidator),
});

const jobResultsPageEmptyValidator = v.object({
  status: v.union(v.literal("unauthenticated"), v.literal("no_access")),
  totalAll: v.number(),
  totalFiltered: v.number(),
  totalPages: v.number(),
  page: v.number(),
  pageSize: v.number(),
  items: v.array(paginatedPaperWithResultsValidator),
});

function normalizePageNumber(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizePageSize(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(RESULTS_PAGE_SIZE_MAX, Math.max(1, Math.floor(value)));
}

type ResultsPageFilters = Infer<typeof resultsPageFiltersValidator>;
type ResultsSortBy = Infer<typeof resultsSortByValidator>;
type NormalizedResultsFilters = ReturnType<typeof normalizeResultsFilters>;

function normalizeConfidenceRange(range: ResultsPageFilters["confidenceRange"]) {
  const min = Number.isFinite(range[0]) ? range[0] : 0;
  const max = Number.isFinite(range[1]) ? range[1] : 100;
  const normalizedMin = Math.max(0, Math.min(100, Math.floor(min)));
  const normalizedMax = Math.max(0, Math.min(100, Math.floor(max)));
  return normalizedMin <= normalizedMax
    ? ([normalizedMin, normalizedMax] as const)
    : ([normalizedMax, normalizedMin] as const);
}

function normalizeResultsFilters(filters: ResultsPageFilters) {
  const [minConfidence, maxConfidence] = normalizeConfidenceRange(
    filters.confidenceRange,
  );

  return {
    searchQuery: filters.searchQuery.trim(),
    confidenceRange: [minConfidence / 100, maxConfidence / 100] as const,
    statusFilters: [...new Set(filters.statusFilters)],
    questionFilters: filters.questionFilters.flatMap((filter) => {
      const token = buildQuestionAnswerToken(filter.questionKey, filter.value);
      return token ? [{ questionKey: filter.questionKey, token }] : [];
    }),
  };
}

function getMissingProjectionFields(paper: Doc<"extractionPapers">) {
  const missing: string[] = [];
  if (typeof paper.sortTitle !== "string") missing.push("sortTitle");
  if (typeof paper.avgConfidence !== "number" || !Number.isFinite(paper.avgConfidence)) {
    missing.push("avgConfidence");
  }
  if (typeof paper.hasErrors !== "boolean") missing.push("hasErrors");
  if (typeof paper.hasPdfSource !== "boolean") missing.push("hasPdfSource");
  if (!Array.isArray(paper.questionAnswerTokens)) {
    missing.push("questionAnswerTokens");
  }
  if (typeof paper.searchText !== "string") missing.push("searchText");
  return missing;
}

function assertProjectionReady(
  jobId: Id<"extractionJobs">,
  papers: ReadonlyArray<Doc<"extractionPapers">>,
) {
  const stalePaper = papers.find((paper) => getMissingProjectionFields(paper).length > 0);
  if (!stalePaper) return;

  const missing = getMissingProjectionFields(stalePaper).join(", ");
  throw new Error(
    `Extraction results projection missing for job ${jobId} on paper ${stalePaper._id} (${missing}). Run internal.extraction.mutations.internal.admin.rebuildJobListProjection({ jobId }) and retry.`,
  );
}

function getPaperAvgConfidence(paper: Doc<"extractionPapers">) {
  return paper.avgConfidence as number;
}

function getPaperHasPdfSource(paper: Doc<"extractionPapers">) {
  return paper.hasPdfSource as boolean;
}

function getPaperHasErrors(paper: Doc<"extractionPapers">) {
  return paper.hasErrors as boolean;
}

function getPaperSortTitle(paper: Doc<"extractionPapers">) {
  return paper.sortTitle as string;
}

function matchesStatusFilters(
  paper: Doc<"extractionPapers">,
  statusFilters: ReadonlyArray<string>,
) {
  if (statusFilters.length === 0) return true;

  const avgConfidence = getPaperAvgConfidence(paper);
  return statusFilters.some((statusFilter) => {
    if (statusFilter === "has-pdf") return getPaperHasPdfSource(paper);
    if (statusFilter === "abstract-only") return !paper.pdfContentUsed;
    if (statusFilter === "open-access") return Boolean(paper.isOpenAccess);
    if (statusFilter === "has-errors") return getPaperHasErrors(paper);
    if (statusFilter === "high-confidence") return avgConfidence >= 0.8;
    if (statusFilter === "low-confidence") return avgConfidence < 0.5;
    return false;
  });
}

function matchesQuestionFilters(
  paper: Doc<"extractionPapers">,
  questionFilters: ReadonlyArray<{ questionKey: string; token: string }>,
) {
  if (questionFilters.length === 0) return true;
  const tokenSet = new Set(paper.questionAnswerTokens ?? []);
  return questionFilters.every((filter) => tokenSet.has(filter.token));
}

function matchesProjectionFilters(
  paper: Doc<"extractionPapers">,
  filters: NormalizedResultsFilters,
) {
  const avgConfidence = getPaperAvgConfidence(paper);
  if (
    avgConfidence < filters.confidenceRange[0] ||
    avgConfidence > filters.confidenceRange[1]
  ) {
    return false;
  }

  if (!matchesStatusFilters(paper, filters.statusFilters)) {
    return false;
  }

  return matchesQuestionFilters(paper, filters.questionFilters);
}

async function readFilteredJobPapers(
  ctx: QueryCtx,
  args: {
    job: Doc<"extractionJobs">;
    filters: NormalizedResultsFilters;
    sortBy: ResultsSortBy;
    limit: number;
  },
) {
  const jobId = args.job._id;
  // A search reads only its matches: reading every paper as well would take a
  // 1,000-paper job's page of 200 past the 16 MiB a query may read. The job's
  // processable paper count, set when its papers were saved, stands in for the total.
  const searched = Boolean(args.filters.searchQuery);
  const candidatePapers = searched
    ? await ctx.db
        .query("extractionPapers")
        .withSearchIndex("search_by_job_text", (q) =>
          q
            .search("searchText", args.filters.searchQuery)
            .eq("jobId", jobId)
            .eq("processable", true),
        )
        .take(args.limit)
    : await ctx.db
        .query("extractionPapers")
        .withIndex("by_job_processable", (q) =>
          q.eq("jobId", jobId).eq("processable", true),
        )
        .order("asc")
        .take(args.limit);

  assertProjectionReady(jobId, candidatePapers);

  const filteredPapers = sortFilteredPapers(
    candidatePapers.filter((paper) => matchesProjectionFilters(paper, args.filters)),
    args.sortBy,
  );

  return {
    totalAll: searched ? (args.job.totalPapers ?? 0) : candidatePapers.length,
    totalFiltered: filteredPapers.length,
    filteredPapers,
  };
}

async function loadPaginatedPaperResults(
  ctx: QueryCtx,
  papers: ReadonlyArray<Doc<"extractionPapers">>,
) {
  const paperIds = papers.map((paper) => paper._id as Id<"extractionPapers">);
  const resultsByPaper = await loadResultsByPaperIds(ctx, paperIds);

  return papers.map((paper) => {
    return {
      ...paper,
      results: resultsByPaper.get(paper._id) ?? [],
    };
  });
}

function sortFilteredPapers(
  papers: Doc<"extractionPapers">[],
  sortBy: ResultsSortBy,
) {
  if (sortBy === "default") {
    return papers;
  }

  const sorted = [...papers];
  if (sortBy === "title-asc") {
    return sorted.sort((a, b) => getPaperSortTitle(a).localeCompare(getPaperSortTitle(b)));
  }
  if (sortBy === "title-desc") {
    return sorted.sort((a, b) => getPaperSortTitle(b).localeCompare(getPaperSortTitle(a)));
  }
  if (sortBy === "confidence-high") {
    return sorted.sort(
      (a, b) => getPaperAvgConfidence(b) - getPaperAvgConfidence(a),
    );
  }
  return sorted.sort(
    (a, b) => getPaperAvgConfidence(a) - getPaperAvgConfidence(b),
  );
}

export const getJobResultsPage = query({
  args: {
    jobId: v.id("extractionJobs"),
    page: v.number(),
    pageSize: v.number(),
    filters: resultsPageFiltersValidator,
    sortBy: resultsSortByValidator,
  },
  returns: v.union(jobResultsPageOkValidator, jobResultsPageEmptyValidator),
  handler: async (ctx, args) => {
    const requestedPage = normalizePageNumber(args.page);
    const pageSize = normalizePageSize(args.pageSize);
    const filters = normalizeResultsFilters(args.filters);
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") {
      return {
        status: access.status,
        totalAll: 0,
        totalFiltered: 0,
        totalPages: 0,
        page: requestedPage,
        pageSize,
        items: [],
      };
    }
    const { user } = access;
    await requireFeature(ctx, "extraction.enabled");
    const limit = PAPER_LIMIT;
    const { totalAll, totalFiltered, filteredPapers } = await readFilteredJobPapers(
      ctx,
      {
        job: access.job,
        filters,
        sortBy: args.sortBy,
        limit,
      },
    );
    const totalPages = totalFiltered === 0 ? 0 : Math.ceil(totalFiltered / pageSize);
    const page =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const sliceStart = (page - 1) * pageSize;
    const pagePapers = filteredPapers.slice(sliceStart, sliceStart + pageSize);
    const items = await loadPaginatedPaperResults(ctx, pagePapers);

    return {
      status: "ok" as const,
      totalAll,
      totalFiltered,
      totalPages,
      page,
      pageSize,
      items,
    };
  },
});

/** Bytes of papers one page of results may read while it looks for matches. */
const RESULTS_PAGE_BYTES = 4 * 1024 * 1024;

/** The index and direction each order of the results reads a job's processable papers in. */
const RESULTS_ORDER = {
  default: ["by_job_processable", "asc"],
  "title-asc": ["by_job_processable_and_sortTitle", "asc"],
  "title-desc": ["by_job_processable_and_sortTitle", "desc"],
  "confidence-high": ["by_job_processable_and_avgConfidence", "desc"],
  "confidence-low": ["by_job_processable_and_avgConfidence", "asc"],
} as const;

const resultsViewArgs = { jobId: v.id("extractionJobs"), filters: resultsPageFiltersValidator };

/** The person's job, or null when it isn't theirs. */
async function ownJob(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"extractionJobs">) {
  const job = await ctx.db.get("extractionJobs", jobId);
  return job?.userId === userId ? job : null;
}

export const listJobResultsAction = defineUserQuery({
  path: "extraction/queries:listJobResults",
  description:
    "Lists an extraction job's papers with their answers, a page at a time: in the order they were added, by title, or by confidence. " +
    "Filters keep papers by search text, confidence range, status and the answer to a question.",
  args: { ...resultsViewArgs, sortBy: resultsSortByValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(paginatedPaperWithResultsValidator),
  run: async (ctx, userId, args) => {
    const job = await ownJob(ctx, userId, args.jobId);
    if (!job) return { page: [], isDone: true, continueCursor: "" };
    await requireFeature(ctx, "extraction.enabled", userId);
    const filters = normalizeResultsFilters(args.filters);
    const numItems = normalizePageSize(args.paginationOpts.numItems);
    const { cursor } = args.paginationOpts;

    if (filters.searchQuery) {
      // A search reads its matches by relevance, at most PAPER_LIMIT of them, so they are
      // sorted here and the cursor is how many came before.
      const { filteredPapers } = await readFilteredJobPapers(ctx, { job, filters, sortBy: args.sortBy, limit: PAPER_LIMIT });
      const start = Math.max(0, Math.floor(Number(cursor ?? 0)) || 0);
      const papers = filteredPapers.slice(start, start + numItems);
      return { page: await loadPaginatedPaperResults(ctx, papers), isDone: start + papers.length >= filteredPapers.length, continueCursor: String(start + papers.length) };
    }

    const [index, order] = RESULTS_ORDER[args.sortBy];
    const read = await stream(ctx.db, schema)
      .query("extractionPapers")
      .withIndex(index, (q) => q.eq("jobId", job._id).eq("processable", true))
      .order(order)
      .filterWith(async (paper) => {
        assertProjectionReady(job._id, [paper]);
        return matchesProjectionFilters(paper, filters);
      })
      // A job holds at most PAPER_LIMIT papers, so a filter reads each once at most.
      .paginate({ cursor, numItems, maximumRowsRead: PAPER_LIMIT, maximumBytesRead: RESULTS_PAGE_BYTES });
    return { page: await loadPaginatedPaperResults(ctx, read.page), isDone: read.isDone, continueCursor: read.continueCursor };
  },
});
export const listJobResults = userQuery(listJobResultsAction);
export const listJobResultsForAssistant = assistantQuery(listJobResultsAction);

export const countJobResultsAction = defineUserQuery({
  path: "extraction/queries:countJobResults",
  description: "Counts an extraction job's papers, and how many of them a set of filters keeps.",
  args: resultsViewArgs,
  returns: v.object({ all: v.number(), matching: v.number() }),
  run: async (ctx, userId, args) => {
    const job = await ownJob(ctx, userId, args.jobId);
    if (!job) return { all: 0, matching: 0 };
    await requireFeature(ctx, "extraction.enabled", userId);
    const { totalAll, totalFiltered } = await readFilteredJobPapers(ctx, { job, filters: normalizeResultsFilters(args.filters), sortBy: "default", limit: PAPER_LIMIT });
    return { all: totalAll, matching: totalFiltered };
  },
});
export const countJobResults = userQuery(countJobResultsAction);
export const countJobResultsForAssistant = assistantQuery(countJobResultsAction);
