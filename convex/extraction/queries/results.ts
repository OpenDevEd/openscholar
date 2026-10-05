/**
 * Job-results queries. A page is read by cursor through the index of its order, with the
 * filters applied from each paper's projection as it reads; a search reads its matches and
 * sorts them. A filtered view is counted apart, and an export reads the pages one by one.
 */

import type { QueryCtx } from "../../_generated/server";
import { compareValues, getDocumentSize, v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { QueryStream, stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import type { Doc, Id } from "../../_generated/dataModel";
import { ownJob } from "../access";
import { exportRevision } from "../counts";
import { requireFeature } from "../../featureFlags/guard";
import { PAPER_LIMIT, RESULTS_PAGE_SIZE_MAX } from "@/lib/extraction/limits";
import {
  paginatedPaperWithResultsValidator,
  resultsPageFiltersValidator,
  resultsSortByValidator,
  paperSelectionValidator,
} from "../validators";
import {
  loadResultsByPaperIds,
} from "./_shared";
import {
  buildQuestionAnswerToken,
  normalizeProjectionText,
} from "../listProjection";

function normalizePageSize(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(RESULTS_PAGE_SIZE_MAX, Math.max(1, Math.floor(value)));
}

type ResultsPageFilters = Infer<typeof resultsPageFiltersValidator>;
type ResultsSortBy = Infer<typeof resultsSortByValidator>;
type NormalizedResultsFilters = Awaited<ReturnType<typeof normalizeResultsFilters>>;

function normalizeConfidenceRange(range: ResultsPageFilters["confidenceRange"]) {
  const min = Number.isFinite(range[0]) ? range[0] : 0;
  const max = Number.isFinite(range[1]) ? range[1] : 100;
  const normalizedMin = Math.max(0, Math.min(100, Math.floor(min)));
  const normalizedMax = Math.max(0, Math.min(100, Math.floor(max)));
  return normalizedMin <= normalizedMax
    ? ([normalizedMin, normalizedMax] as const)
    : ([normalizedMax, normalizedMin] as const);
}

async function normalizeResultsFilters(filters: ResultsPageFilters) {
  const [minConfidence, maxConfidence] = normalizeConfidenceRange(
    filters.confidenceRange,
  );

  const searchQuery = normalizeProjectionText(filters.searchQuery);
  return {
    searchQuery,
    emptySearch: Boolean(filters.searchQuery.trim()) && !searchQuery,
    confidenceRange: [minConfidence / 100, maxConfidence / 100] as const,
    statusFilters: [...new Set(filters.statusFilters)],
    questionFilters: await Promise.all(filters.questionFilters.map(async (filter) => ({
      questionKey: filter.questionKey,
      token: await buildQuestionAnswerToken(filter.questionKey, filter.value),
    }))),
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
  questionFilters: ReadonlyArray<{ questionKey: string; token: string | null }>,
) {
  if (questionFilters.length === 0) return true;
  const tokenSet = new Set(paper.questionAnswerTokens ?? []);
  return questionFilters.every((filter) => filter.token !== null && tokenSet.has(filter.token));
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
    selectedPaperIds?: Id<"extractionPapers">[];
  },
) {
  const jobId = args.job._id;
  if (args.filters.emptySearch) {
    return { totalAll: args.job.totalPapers ?? 0, totalFiltered: 0, filteredPapers: [] };
  }
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
    : args.selectedPaperIds !== undefined
    ? (await Promise.all([...new Set(args.selectedPaperIds)].map(id => ctx.db.get(id))))
        .filter((paper): paper is Doc<"extractionPapers"> => paper !== null && paper.jobId === jobId && paper.processable === true)
        .sort((a, b) => compareValues([a._creationTime, a._id], [b._creationTime, b._id]))
    : await ctx.db
        .query("extractionPapers")
        .withIndex("by_job_processable", (q) =>
          q.eq("jobId", jobId).eq("processable", true),
        )
        .order("asc")
        .take(args.limit);

  assertProjectionReady(jobId, candidatePapers);
  const selected = args.selectedPaperIds === undefined ? null : new Set(args.selectedPaperIds);

  const filteredPapers = sortFilteredPapers(
    candidatePapers.filter((paper) => (!selected || selected.has(paper._id)) && matchesProjectionFilters(paper, args.filters)),
    args.sortBy,
  );

  return {
    totalAll: searched || args.selectedPaperIds !== undefined ? (args.job.totalPapers ?? 0) : candidatePapers.length,
    totalFiltered: filteredPapers.length,
    filteredPapers,
  };
}

async function loadPaginatedPaperResults(
  ctx: QueryCtx,
  papers: ReadonlyArray<Doc<"extractionPapers">>,
) {
  const page: Infer<typeof paginatedPaperWithResultsValidator>[] = [];
  let bytes = 0;
  for (const paper of papers) {
    const item = await loadPaperResults(ctx, paper);
    page.push(item);
    bytes += getDocumentSize(item);
    if (bytes >= RESULTS_PAGE_BYTES) break;
  }
  return page;
}

async function loadPaperResults(ctx: QueryCtx, paper: Doc<"extractionPapers">) {
  const results = await loadResultsByPaperIds(ctx, [paper._id]);
  return { ...paper, results: results.get(paper._id) ?? [] };
}

/** Keep joined-answer bytes in the existing stream's cursor and split handling. */
class ResultStream extends QueryStream<Infer<typeof paginatedPaperWithResultsValidator>> {
  constructor(private ctx: QueryCtx, private papers: QueryStream<Doc<"extractionPapers">>) { super(); }
  getOrder() { return this.papers.getOrder(); }
  getIndexFields() { return this.papers.getIndexFields(); }
  getEqualityIndexFilter() { return this.papers.getEqualityIndexFilter(); }
  narrow(bounds: Parameters<QueryStream<Doc<"extractionPapers">>["narrow"]>[0]): ResultStream {
    return new ResultStream(this.ctx, this.papers.narrow(bounds));
  }
  iterWithKeys(trackBandwidth = false): ReturnType<QueryStream<Infer<typeof paginatedPaperWithResultsValidator>>["iterWithKeys"]> {
    const { ctx, papers } = this;
    return {
      [Symbol.asyncIterator]() {
        const iterator = papers.iterWithKeys(trackBandwidth)[Symbol.asyncIterator]();
        return {
          async next() {
            const next = await iterator.next();
            if (next.done) return { done: true as const, value: undefined };
            const [paper, key, bytes] = next.value;
            const item = paper ? await loadPaperResults(ctx, paper) : null;
            return { done: false as const, value: [item, key, bytes + (item && trackBandwidth ? getDocumentSize({ results: item.results }) : 0)] as const };
          },
        };
      },
    };
  }
}

function sortFilteredPapers(
  papers: Doc<"extractionPapers">[],
  sortBy: ResultsSortBy,
) {
  if (sortBy === "default") {
    return papers;
  }

  const key = (paper: Doc<"extractionPapers">) => [
    sortBy.startsWith("title-") ? getPaperSortTitle(paper) : getPaperAvgConfidence(paper),
    paper._creationTime,
    paper._id,
  ];
  const direction = sortBy === "title-desc" || sortBy === "confidence-high" ? -1 : 1;
  return [...papers].sort((a, b) => direction * compareValues(key(a), key(b)));
}

/** Target bytes per page, including joined answers and their saved quotations. */
const RESULTS_PAGE_BYTES = 4 * 1024 * 1024;

/** The index and direction each order of the results reads a job's processable papers in. */
const RESULTS_ORDER = {
  default: ["by_job_processable", "asc"],
  "title-asc": ["by_job_processable_and_sortTitle", "asc"],
  "title-desc": ["by_job_processable_and_sortTitle", "desc"],
  "confidence-high": ["by_job_processable_and_avgConfidence", "desc"],
  "confidence-low": ["by_job_processable_and_avgConfidence", "asc"],
} as const;

const resultsViewArgs = { jobId: v.id("extractionJobs"), filters: resultsPageFiltersValidator, selectedPaperIds: v.optional(paperSelectionValidator(v.id("extractionPapers"))) };

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
    const filters = await normalizeResultsFilters(args.filters);
    const numItems = normalizePageSize(args.paginationOpts.numItems);
    const { cursor } = args.paginationOpts;

    if (filters.searchQuery || filters.emptySearch || args.selectedPaperIds !== undefined) {
      // A search reads its matches by relevance, at most PAPER_LIMIT of them, so they are
      // sorted here and the cursor is how many came before.
      const { filteredPapers } = await readFilteredJobPapers(ctx, { job, filters, sortBy: args.sortBy, limit: PAPER_LIMIT, selectedPaperIds: args.selectedPaperIds });
      const start = Math.max(0, Math.floor(Number(cursor ?? 0)) || 0);
      const page = await loadPaginatedPaperResults(ctx, filteredPapers.slice(start, start + numItems));
      return { page, isDone: start + page.length >= filteredPapers.length, continueCursor: String(start + page.length) };
    }

    const [index, order] = RESULTS_ORDER[args.sortBy];
    const papers = stream(ctx.db, schema)
      .query("extractionPapers")
      .withIndex(index, (q) => q.eq("jobId", job._id).eq("processable", true))
      .order(order)
      .filterWith(async (paper) => {
        assertProjectionReady(job._id, [paper]);
        return matchesProjectionFilters(paper, filters);
      });
      // A job holds at most PAPER_LIMIT papers, so a filter reads each once at most.
    const read = await new ResultStream(ctx, papers).paginate({ ...args.paginationOpts, numItems, maximumRowsRead: PAPER_LIMIT, maximumBytesRead: RESULTS_PAGE_BYTES });
    return read;
  },
});
export const listJobResults = userQuery(listJobResultsAction);
export const listJobResultsForAssistant = assistantQuery(listJobResultsAction);

export const countJobResultsAction = defineUserQuery({
  path: "extraction/queries:countJobResults",
  description: "Counts an extraction job's papers, and how many of them a set of filters keeps.",
  args: { ...resultsViewArgs, includeRevision: v.optional(v.boolean()) },
  returns: v.object({ all: v.number(), matching: v.number(), revision: v.union(v.number(), v.null()) }),
  run: async (ctx, userId, args) => {
    const job = await ownJob(ctx, userId, args.jobId);
    if (!job) return { all: 0, matching: 0, revision: -1 };
    await requireFeature(ctx, "extraction.enabled", userId);
    const { totalAll, totalFiltered } = await readFilteredJobPapers(ctx, { job, filters: await normalizeResultsFilters(args.filters), sortBy: "default", limit: PAPER_LIMIT, selectedPaperIds: args.selectedPaperIds });
    return { all: totalAll, matching: totalFiltered, revision: args.includeRevision ? await exportRevision(ctx, job._id) : null };
  },
});
export const countJobResults = userQuery(countJobResultsAction);
export const countJobResultsForAssistant = assistantQuery(countJobResultsAction);
