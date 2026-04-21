/**
 * Job-results queries. `getJobResults` still batch-loads the whole job for
 * export, while `getJobResultsPage` reads only the visible page's child rows
 * for the UI surface.
 */

import { query } from "../../_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { ok, statusResultValidator } from "../../lib/query_states";
import { resolveOwnedJob } from "../access";
import { requireFeature } from "../../featureFlags/guard";
import { getPaperLimit } from "../bucket/limits";
import {
  extractionJobValidator,
  extractionPaperValidator,
  extractionQuestionValidator,
  extractionResultWithReviewValidator,
  paginatedPaperWithResultsValidator,
  resultsPageFiltersValidator,
  resultsSortByValidator,
} from "../validators";
import {
  applyReviewMetadata,
  loadResultsByJob,
  loadResultsByPaperIds,
  loadReviewsByJob,
  loadReviewsByPaperIds,
} from "./_shared";
import {
  buildQuestionAnswerToken,
  normalizeProjectionText,
} from "../listProjection";

export const getJobResults = query({
  args: { jobId: v.id("extractionJobs") },
  returns: statusResultValidator({
    job: extractionJobValidator,
    questions: v.array(extractionQuestionValidator),
    papers: v.record(
      v.string(),
      v.object({
        paper: extractionPaperValidator,
        results: v.array(extractionResultWithReviewValidator),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const access = await resolveOwnedJob(ctx, args.jobId);
    if (access.status !== "ok") return access;
    const { job, user } = access;
    await requireFeature(ctx, "extraction.enabled");

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();

    const limit = await getPaperLimit(ctx, user._id);
    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(limit);

    const [reviewMap, resultsByPaper] = await Promise.all([
      loadReviewsByJob(ctx, args.jobId),
      loadResultsByJob(ctx, args.jobId),
    ]);

    const allResults: Record<
      string,
      { paper: Doc<"extractionPapers">; results: Doc<"extractionResults">[] }
    > = {};
    for (const paper of papers) {
      const rawResults = resultsByPaper.get(paper._id) ?? [];
      allResults[paper._id] = {
        paper,
        results: applyReviewMetadata(rawResults, reviewMap),
      };
    }

    return ok({
      job,
      questions,
      papers: allResults,
    });
  },
});

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
  return Math.max(1, Math.floor(value));
}

type ResultsPageFilters = Infer<typeof resultsPageFiltersValidator>;
type ResultsSortBy = Infer<typeof resultsSortByValidator>;

const ERROR_STATUSES = new Set(["download_failed", "indexing_failed", "failed"]);

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

function getPaperAvgConfidence(paper: Doc<"extractionPapers">) {
  return typeof paper.avgConfidence === "number" && Number.isFinite(paper.avgConfidence)
    ? paper.avgConfidence
    : 0;
}

function getPaperHasPdfSource(paper: Doc<"extractionPapers">) {
  return (
    paper.hasPdfSource ??
    Boolean(paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed)
  );
}

function getPaperHasErrors(paper: Doc<"extractionPapers">) {
  return (
    paper.hasErrors ??
    (ERROR_STATUSES.has(paper.status) || paper.lastError !== undefined)
  );
}

function getPaperReviewedCount(paper: Doc<"extractionPapers">) {
  return typeof paper.reviewedCount === "number" && Number.isFinite(paper.reviewedCount)
    ? paper.reviewedCount
    : 0;
}

function getPaperNeedsFollowupCount(paper: Doc<"extractionPapers">) {
  return typeof paper.needsFollowupCount === "number" &&
    Number.isFinite(paper.needsFollowupCount)
    ? paper.needsFollowupCount
    : 0;
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
    if (statusFilter === "reviewed") return getPaperReviewedCount(paper) > 0;
    if (statusFilter === "needs-followup") {
      return getPaperNeedsFollowupCount(paper) > 0;
    }
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
  filters: ReturnType<typeof normalizeResultsFilters>,
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

function sortFilteredPapers(
  papers: Doc<"extractionPapers">[],
  sortBy: ResultsSortBy,
) {
  if (sortBy === "default") {
    return papers;
  }

  const sorted = [...papers];
  if (sortBy === "title-asc") {
    return sorted.sort((a, b) =>
      (a.sortTitle ?? normalizeProjectionText(a.title)).localeCompare(
        b.sortTitle ?? normalizeProjectionText(b.title),
      ),
    );
  }
  if (sortBy === "title-desc") {
    return sorted.sort((a, b) =>
      (b.sortTitle ?? normalizeProjectionText(b.title)).localeCompare(
        a.sortTitle ?? normalizeProjectionText(a.title),
      ),
    );
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
    const limit = await getPaperLimit(ctx, user._id);

    const processableQuery = ctx.db
      .query("extractionPapers")
      .withIndex("by_job_processable", (q) =>
        q.eq("jobId", args.jobId).eq("processable", true),
      )
      .order("asc");

    const allPapers = await processableQuery.take(limit);
    const candidatePapers = filters.searchQuery
      ? await ctx.db
          .query("extractionPapers")
          .withSearchIndex("search_by_job_text", (q) =>
            q
              .search("searchText", filters.searchQuery)
              .eq("jobId", args.jobId)
              .eq("processable", true),
          )
          .take(limit)
      : allPapers;

    const totalAll = allPapers.length;
    const filteredPapers = sortFilteredPapers(
      candidatePapers.filter((paper) => matchesProjectionFilters(paper, filters)),
      args.sortBy,
    );
    const totalFiltered = filteredPapers.length;
    const totalPages = totalFiltered === 0 ? 0 : Math.ceil(totalFiltered / pageSize);
    const page =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const sliceStart = (page - 1) * pageSize;
    const pagePapers = filteredPapers.slice(sliceStart, sliceStart + pageSize);
    const pagePaperIds = pagePapers.map(
      (paper) => paper._id as Id<"extractionPapers">,
    );

    const [reviewMap, resultsByPaper] = await Promise.all([
      loadReviewsByPaperIds(ctx, pagePaperIds),
      loadResultsByPaperIds(ctx, pagePaperIds),
    ]);

    const items = pagePapers.map((paper) => {
      const rawResults = resultsByPaper.get(paper._id) ?? [];
      return {
        ...paper,
        results: applyReviewMetadata(rawResults, reviewMap),
      };
    });

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
