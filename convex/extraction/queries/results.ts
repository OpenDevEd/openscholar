/**
 * Job-results queries, for a job of any size (#634). An unfiltered page reads the index of
 * its order. A filtered one reads the papers its narrowest filter keeps when they're few,
 * from the job's counts (../facets.ts), and sorts them; when they're many, it reads its
 * order's index and applies the filters as it goes, which fills a page quickly. A search
 * reads its matches, at most the search engine's limit, and sorts them. A filtered count is
 * exact from the counts for one filter, and read along the narrowest for several; a summary
 * reads each question's tallies (../tallies.ts).
 */

import { getStatusFilterOptionIds } from "../../../lib/extraction/status-filter-options";
import type { QueryCtx } from "../../_generated/server";
import { compareValues, getDocumentSize, v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { JoinStream } from "../../lib/joinStream";
import schema from "../../schema";
import { assistantQuery, defineUserQuery, userQuery } from "../../lib/userActions";
import type { Doc, Id } from "../../_generated/dataModel";
import { ownJob } from "../access";
import { exportRevision } from "../counts";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { RESULTS_PAGE_SIZE_MAX } from "@/lib/extraction/limits";
import { answerOf, confidenceOf, countIn, idsIn, tagOf, type PaperTag, type Range } from "../facets";
import { largestGroups } from "../tallies";
import {
  paginatedPaperWithResultsValidator,
  resultsSummaryValidator,
  SUMMARY_GROUPS,
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

/** What the page's filters read of a paper: a paper, or its facts row (validators.ts `extractionPaperFactFields`). */
type FilterFields = Pick<Doc<"extractionPapers">, "avgConfidence" | "hasPdfSource" | "hasErrors" | "pdfContentUsed" | "isOpenAccess" | "questionAnswerTokens">;

function getPaperAvgConfidence(paper: FilterFields) {
  return paper.avgConfidence as number;
}

function getPaperHasPdfSource(paper: FilterFields) {
  return paper.hasPdfSource as boolean;
}

function getPaperHasErrors(paper: FilterFields) {
  return paper.hasErrors as boolean;
}

function getPaperSortTitle(paper: Doc<"extractionPapers">) {
  return paper.sortTitle as string;
}

function matchesStatusFilters(
  paper: FilterFields,
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
  paper: FilterFields,
  questionFilters: ReadonlyArray<{ questionKey: string; token: string | null }>,
) {
  if (questionFilters.length === 0) return true;
  const tokenSet = new Set(paper.questionAnswerTokens ?? []);
  return questionFilters.every((filter) => filter.token !== null && tokenSet.has(filter.token));
}

function matchesProjectionFilters(
  paper: FilterFields,
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

/** The search engine's limit: a search reads at most this many matches, and says so when it reaches it. */
const SEARCH_RESULTS_MAX = 1_024;
/** Papers a filtered page reads of its narrowest filter, to sort them itself, when that filter keeps at most this many. */
const IN_MEMORY_PAPERS = 1_000;
/** Rows a filtered page reads along its order when its filters keep more papers than that: they then fill a page well within it. */
const FILTERED_PAGE_ROWS = 4_000;
/** Papers of the narrowest filter a count of several filters, or a summary with filters, reads at most. */
const READ_PAPERS = 8_000;
/** Ids read from the counts at a time. */
const IDS_PAGE = 1_000;

/**
 * One of the filters a view's papers must all meet, with how many papers it keeps (a moment
 * behind the writes) and the ids of those papers. Status tags are one filter: a paper meets
 * it with any of them, so its count adds up theirs and its ids are theirs together.
 */
type Part = { ranges: Array<{ namespace: string; range: Range }> };

function partsOf(jobId: Id<"extractionJobs">, filters: NormalizedResultsFilters): Part[] {
  const [min, max] = filters.confidenceRange;
  const confidence: Part[] = min > 0 || max < 1 ? [{ ranges: [{ namespace: confidenceOf(jobId), range: { lower: min, upper: max } }] }] : [];
  const status = filters.statusFilters.length
    ? [{ ranges: filters.statusFilters.flatMap((tag): Part["ranges"] => {
        if (tag === "high-confidence") return [{ namespace: confidenceOf(jobId), range: { lower: 0.8 } }];
        if (tag === "low-confidence") return [{ namespace: confidenceOf(jobId), range: { below: 0.5 } }];
        return [{ namespace: tagOf(jobId), range: { eq: tag as PaperTag } }];
      }) }]
    : [];
  // An answer no paper can give (one with no token) matches nothing: an empty part.
  const answers = filters.questionFilters.map((filter): Part => ({ ranges: filter.token === null ? [] : [{ namespace: answerOf(jobId, filter.questionKey), range: { eq: filter.token } }] }));
  return [...confidence, ...status, ...answers];
}

const countOf = async (ctx: QueryCtx, part: Part) => (await Promise.all(part.ranges.map(({ namespace, range }) => countIn(ctx, namespace, range)))).reduce((sum, count) => sum + count, 0);

/** The ids a part keeps, up to `most` of them: whether it read them all. A paper under two of its tags is read once. */
async function idsOf(ctx: QueryCtx, part: Part, most: number) {
  const ids = new Set<string>();
  for (const { namespace, range } of part.ranges) {
    for (let cursor: string | undefined; ;) {
      const page = await idsIn(ctx, namespace, range, cursor, IDS_PAGE);
      // A tag's entry is "paper:tag"; every other entry's id is the paper's.
      for (const id of page.ids) ids.add(id.split(":")[0]);
      if (ids.size > most) return { ids: [...ids].slice(0, most), all: false };
      if (page.isDone) break;
      cursor = page.cursor;
    }
  }
  return { ids: [...ids], all: true };
}

/** The view's narrowest part and how many papers it keeps, or null for a view with no filters. */
async function narrowestOf(ctx: QueryCtx, parts: Part[]) {
  if (!parts.length) return null;
  const counts = await Promise.all(parts.map((part) => countOf(ctx, part)));
  const at = counts.indexOf(Math.min(...counts));
  return { part: parts[at], count: counts[at], counts };
}

/** A search's matches, at most the search engine's limit, and whether it reached it. */
async function searchMatches(ctx: QueryCtx, jobId: Id<"extractionJobs">, searchQuery: string) {
  const found = await ctx.db
    .query("extractionPapers")
    .withSearchIndex("search_by_job_text", (q) => q.search("searchText", searchQuery).eq("jobId", jobId).eq("processable", true))
    .take(SEARCH_RESULTS_MAX);
  return { papers: found, capped: found.length === SEARCH_RESULTS_MAX };
}

/** The papers picked, as they stand: each of the job's processable ones once, in the order they were added. */
async function pickedPapers(ctx: QueryCtx, jobId: Id<"extractionJobs">, ids: Id<"extractionPapers">[]) {
  return (await Promise.all([...new Set(ids)].map((id) => ctx.db.get(id))))
    .filter((paper): paper is Doc<"extractionPapers"> => paper !== null && paper.jobId === jobId && paper.processable === true)
    .sort((a, b) => compareValues([a._creationTime, a._id], [b._creationTime, b._id]));
}

/** A page of papers read in full and sorted here, from `cursor`: how many came before it. */
async function pageInMemory(ctx: QueryCtx, papers: Doc<"extractionPapers">[], cursor: string | null, numItems: number) {
  const start = Math.max(0, Math.floor(Number(cursor ?? 0)) || 0);
  const page: Infer<typeof paginatedPaperWithResultsValidator>[] = [];
  let bytes = 0;
  for (const paper of papers.slice(start, start + numItems)) {
    const item = await loadPaperResults(ctx, paper);
    page.push(item);
    bytes += getDocumentSize(item);
    if (bytes >= RESULTS_PAGE_BYTES) break;
  }
  return { page, isDone: start + page.length >= papers.length, continueCursor: String(start + page.length) };
}

/** A sorted page cursor carries this mark; a cursor along the order's index doesn't. */
const SORTED = "sorted:";

async function loadPaperResults(ctx: QueryCtx, paper: Doc<"extractionPapers">) {
  const results = await loadResultsByPaperIds(ctx, [paper._id]);
  return { ...paper, results: results.get(paper._id) ?? [] };
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

/**
 * What each of the results page's filters takes, for the assistant: guessing, it read confidence as
 * 0 to 1 and gave a status of "completed", and every paper was filtered out.
 */
const FILTERS_HELP =
  `\`filters\`: \`searchQuery\` is text to find in the papers, "" for none; \`confidenceRange\` is [least, most] in percent, [0, 100] for every paper; ` +
  `\`statusFilters\` keeps papers with any of these tags: ${getStatusFilterOptionIds(true).join(", ")}, [] for every paper; \`questionFilters\` keeps papers by their answer to a question, [] for none.`;

const resultsViewArgs = { jobId: v.id("extractionJobs"), filters: resultsPageFiltersValidator, selectedPaperIds: v.optional(paperSelectionValidator(v.id("extractionPapers"))) };

export const listJobResultsAction = defineUserQuery({
  path: "extraction/queries:listJobResults",
  description:
    "Lists an extraction job's papers with their answers, a page at a time: in the order they were added, by title, or by confidence. " +
    "Filters keep papers by search text, confidence range, status and the answer to a question. " +
    FILTERS_HELP,
  args: { ...resultsViewArgs, sortBy: resultsSortByValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(paginatedPaperWithResultsValidator),
  run: async (ctx, userId, args) => {
    const job = await ownJob(ctx, userId, args.jobId);
    if (!job) return { page: [], isDone: true, continueCursor: "" };
    await requireFeature(ctx, "extraction.enabled", userId);
    const filters = await normalizeResultsFilters(args.filters);
    const numItems = normalizePageSize(args.paginationOpts.numItems);
    const { cursor } = args.paginationOpts;
    if (filters.emptySearch) return { page: [], isDone: true, continueCursor: "" };

    if (filters.searchQuery || args.selectedPaperIds !== undefined) {
      // A search's matches or the papers picked: few enough to read whole and sort here.
      const candidates = filters.searchQuery ? (await searchMatches(ctx, job._id, filters.searchQuery)).papers : await pickedPapers(ctx, job._id, args.selectedPaperIds!);
      const picked = args.selectedPaperIds === undefined ? null : new Set<string>(args.selectedPaperIds);
      const kept = sortFilteredPapers(candidates.filter((paper) => (!picked || picked.has(paper._id)) && matchesProjectionFilters(paper, filters)), args.sortBy);
      return await pageInMemory(ctx, kept, cursor, numItems);
    }

    const [index, order] = RESULTS_ORDER[args.sortBy];
    const along = () => stream(ctx.db, schema)
      .query("extractionPapers")
      .withIndex(index, (q) => q.eq("jobId", job._id).eq("processable", true))
      .order(order);
    const parts = partsOf(job._id, filters);
    if (!parts.length) return await new JoinStream(along(), (paper) => loadPaperResults(ctx, paper), (item) => getDocumentSize({ results: item.results })).paginate({ ...args.paginationOpts, numItems, maximumBytesRead: RESULTS_PAGE_BYTES });

    // A view whose narrowest filter keeps few papers reads them and sorts them here; it says so in its cursor.
    const sorted = cursor?.startsWith(SORTED) ?? false;
    const narrowest = cursor === null ? await narrowestOf(ctx, parts) : null;
    if (sorted || (narrowest && narrowest.count <= IN_MEMORY_PAPERS)) {
      const part = narrowest?.part ?? (await narrowestOf(ctx, parts))!.part;
      const { ids } = await idsOf(ctx, part, Number.MAX_SAFE_INTEGER);
      const papers = (await Promise.all(ids.map((id) => ctx.db.get(id as Id<"extractionPapers">))))
        .filter((paper): paper is Doc<"extractionPapers"> => paper !== null && paper.processable === true && matchesProjectionFilters(paper, filters));
      const read = await pageInMemory(ctx, sortFilteredPapers(papers.sort((a, b) => compareValues([a._creationTime, a._id], [b._creationTime, b._id])), args.sortBy), sorted ? cursor!.slice(SORTED.length) : null, numItems);
      return { ...read, continueCursor: SORTED + read.continueCursor };
    }
    // Its filters keep many papers: along the order's index, applying them as it reads.
    const kept = along().filterWith(async (paper) => matchesProjectionFilters(paper, filters));
    return await new JoinStream(kept, (paper) => loadPaperResults(ctx, paper), (item) => getDocumentSize({ results: item.results }))
      .paginate({ ...args.paginationOpts, numItems, maximumRowsRead: FILTERED_PAGE_ROWS, maximumBytesRead: RESULTS_PAGE_BYTES });
  },
});
export const listJobResults = userQuery(listJobResultsAction);
export const listJobResultsForAssistant = assistantQuery(listJobResultsAction);

/**
 * How many papers a view keeps: exact from the job's counts for one filter (status tags
 * together are one); several are counted by reading the papers the narrowest keeps, and
 * `atLeast` says when it stopped short of them all, as a search that reached the search
 * engine's limit does.
 */
async function countView(ctx: QueryCtx, job: Doc<"extractionJobs">, filters: NormalizedResultsFilters, selectedPaperIds?: Id<"extractionPapers">[]) {
  const all = job.totalPapers ?? 0;
  if (filters.emptySearch) return { all, matching: 0, atLeast: false };
  if (filters.searchQuery) {
    const { papers, capped } = await searchMatches(ctx, job._id, filters.searchQuery);
    const picked = selectedPaperIds === undefined ? null : new Set<string>(selectedPaperIds);
    return { all, matching: papers.filter((paper) => (!picked || picked.has(paper._id)) && matchesProjectionFilters(paper, filters)).length, atLeast: capped };
  }
  if (selectedPaperIds !== undefined) return { all, matching: (await pickedPapers(ctx, job._id, selectedPaperIds)).filter((paper) => matchesProjectionFilters(paper, filters)).length, atLeast: false };
  const parts = partsOf(job._id, filters);
  const narrowest = await narrowestOf(ctx, parts);
  if (!narrowest) return { all, matching: all, atLeast: false };
  // One filter, with one range: its count. Status tags together overlap, so they're read.
  if (parts.length === 1 && narrowest.part.ranges.length <= 1) return { all, matching: narrowest.count, atLeast: false };
  const { ids, all: readAll } = await idsOf(ctx, narrowest.part, READ_PAPERS);
  const facts = await Promise.all(ids.map((id) => ctx.db.query("extractionPaperFacts").withIndex("by_paper", (q) => q.eq("paperId", id as Id<"extractionPapers">)).unique()));
  return { all, matching: facts.filter((fact) => fact !== null && matchesProjectionFilters(fact, filters)).length, atLeast: !readAll };
}

export const countJobResultsAction = defineUserQuery({
  path: "extraction/queries:countJobResults",
  description: `Counts an extraction job's papers, and how many of them a set of filters keeps. A count that stopped short of them all comes with \`atLeast\`. ${FILTERS_HELP}`,
  args: { ...resultsViewArgs, includeRevision: v.optional(v.boolean()) },
  returns: v.object({ all: v.number(), matching: v.number(), atLeast: v.optional(v.literal(true)), revision: v.union(v.number(), v.null()) }),
  run: async (ctx, userId, args) => {
    const job = await ownJob(ctx, userId, args.jobId);
    if (!job) return { all: 0, matching: 0, revision: -1 };
    await requireFeature(ctx, "extraction.enabled", userId);
    const { all, matching, atLeast } = await countView(ctx, job, await normalizeResultsFilters(args.filters), args.selectedPaperIds);
    return { all, matching, ...(atLeast ? { atLeast: true as const } : {}), revision: args.includeRevision ? await exportRevision(ctx, job._id) : null };
  },
});
export const countJobResults = userQuery(countJobResultsAction);
export const countJobResultsForAssistant = assistantQuery(countJobResultsAction);

type Counted = { shown: string; papers: Set<string> };
/** Counts a paper under a key, once however often it says it. */
const count = (groups: Map<string, Counted>, key: string, shown: string, paperId: string) => {
  const group = groups.get(key) ?? { shown, papers: new Set<string>() };
  group.papers.add(paperId);
  groups.set(key, group);
};
/** Groups, most papers first: the first SUMMARY_GROUPS of them, and how many more there are. */
const largest = (groups: Map<string, Counted>) => {
  const sorted = [...groups.values()].sort((a, b) => b.papers.size - a.papers.size || a.shown.localeCompare(b.shown));
  return { top: sorted.slice(0, SUMMARY_GROUPS), more: Math.max(0, sorted.length - SUMMARY_GROUPS) };
};

export const summarizeJobResultsAction = defineUserQuery({
  path: "extraction/queries:summarizeJobResults",
  description:
    "Groups and counts an extraction job's answers to one question across every paper that has finished it: how many papers, how many answered, each answer with how many papers gave it, most first, and for a question answered with a list, each item with how many papers name it. " +
    "The filters listJobResults takes narrow it, by status, confidence and other questions' answers (a paper's answer to that question, as listJobResults shows it); its text search isn't one. Use it to compare, tally or describe a job's answers, never pages of its results. `questionKey` is the question's `key` in the job.",
  args: { jobId: v.id("extractionJobs"), questionKey: v.string(), filters: v.optional(resultsPageFiltersValidator) },
  returns: resultsSummaryValidator,
  run: async (ctx, userId, { jobId, questionKey, filters }) => {
    const job = await ownJob(ctx, userId, jobId);
    if (!job) throw createError("NOT_FOUND", "There's no extraction job of yours with that ID.");
    await requireFeature(ctx, "extraction.enabled", userId);
    if (filters?.searchQuery.trim()) throw createError("VALIDATION_ERROR", "A summary can't be narrowed by text search: narrow it by status, confidence or other questions' answers.");
    const question = await ctx.db.query("extractionQuestions").withIndex("by_job_key", (q) => q.eq("jobId", jobId).eq("key", questionKey)).unique();
    if (!question) throw createError("VALIDATION_ERROR", `This job has no question with the key ${questionKey}.`);
    const normalized = filters ? await normalizeResultsFilters(filters) : null;
    const parts = normalized ? partsOf(jobId, normalized) : [];

    if (!parts.length) {
      // Every paper: the question's tallies, largest first, and its counts.
      const [answers, items, papers, unanswered] = await Promise.all([
        largestGroups(ctx, jobId, questionKey, "answer", SUMMARY_GROUPS),
        largestGroups(ctx, jobId, questionKey, "item", SUMMARY_GROUPS),
        countIn(ctx, answerOf(jobId, questionKey), {}).then(async (answered) => answered + (await countIn(ctx, answerOf(jobId, questionKey), { eq: null }))),
        countIn(ctx, answerOf(jobId, questionKey), { eq: null }),
      ]);
      return {
        question: question.question,
        papers,
        answered: papers - unanswered,
        answers: answers.top.map((group) => ({ answer: group.shown, papers: group.papers })),
        moreAnswers: Math.max(0, answers.groups - answers.top.length),
        items: items.top.map((group) => ({ item: group.shown, papers: group.papers })),
      };
    }

    // The papers the filters keep, read from the narrowest, each with its answer to this question.
    const { ids, all } = await idsOf(ctx, (await narrowestOf(ctx, parts))!.part, READ_PAPERS);
    const rows: Doc<"extractionAnswerRows">[] = [];
    for (const id of ids) {
      const paperId = id as Id<"extractionPapers">;
      const fact = await ctx.db.query("extractionPaperFacts").withIndex("by_paper", (q) => q.eq("paperId", paperId)).unique();
      if (!fact || !matchesProjectionFilters(fact, normalized!)) continue;
      const row = await ctx.db.query("extractionAnswerRows").withIndex("by_paper_question", (q) => q.eq("paperId", paperId).eq("questionKey", questionKey)).unique();
      if (row) rows.push(row);
    }
    const answers = new Map<string, Counted>();
    const items = new Map<string, Counted>();
    for (const row of rows) {
      if (row.token === null) continue;
      count(answers, row.token, row.shown, row.paperId);
      for (const item of row.items) count(items, item.key, item.shown, row.paperId);
    }
    const grouped = largest(answers);
    return {
      question: question.question,
      papers: rows.length,
      answered: rows.filter((row) => row.token !== null).length,
      answers: grouped.top.map((group) => ({ answer: group.shown, papers: group.papers.size })),
      moreAnswers: grouped.more,
      items: largest(items).top.map((group) => ({ item: group.shown, papers: group.papers.size })),
      ...(all ? {} : { partial: true as const }),
    };
  },
});
export const summarizeJobResults = userQuery(summarizeJobResultsAction);
export const summarizeJobResultsForAssistant = assistantQuery(summarizeJobResultsAction);
