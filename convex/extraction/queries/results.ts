/**
 * Job-results queries. The page query reads the projection-backed filtered
 * corpus, so counts and sorting stay full-corpus correct; an export reads it
 * page by page.
 */

import { query, type QueryCtx } from "../../_generated/server";
import { v, type Infer } from "convex/values";
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
    jobId: Id<"extractionJobs">;
    filters: NormalizedResultsFilters;
    sortBy: ResultsSortBy;
    limit: number;
  },
) {
  const allPapers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job_processable", (q) =>
      q.eq("jobId", args.jobId).eq("processable", true),
    )
    .order("asc")
    .take(args.limit);

  assertProjectionReady(args.jobId, allPapers);

  const candidatePapers = args.filters.searchQuery
    ? await ctx.db
        .query("extractionPapers")
        .withSearchIndex("search_by_job_text", (q) =>
          q
            .search("searchText", args.filters.searchQuery)
            .eq("jobId", args.jobId)
            .eq("processable", true),
        )
        .take(args.limit)
    : allPapers;

  const filteredPapers = sortFilteredPapers(
    candidatePapers.filter((paper) => matchesProjectionFilters(paper, args.filters)),
    args.sortBy,
  );

  return {
    totalAll: allPapers.length,
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
        jobId: args.jobId,
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
