/**
 * An extraction over a paper set (#341) the server reads, as the assistant starts one from a
 * chat. The person approves it up to a figure (#328): that figure is held once, the job's
 * papers are charged under the hold, and the job reads no more once it's reached
 * (./paperWorker.ts). The page's own start sends its bucket (./mutations/jobs.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../lib/functions";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError } from "../lib/errors";
import { getFlag } from "../featureFlags/guard";
import { holdSpend } from "../billing/charge";
import { heldPapers } from "../paperSets/held";
import { filtersOf } from "../paperSets/search";
import { screeningRevision } from "../screening/accounting";
import { papersIn } from "../screening/estimate";
import { paperSetValidator } from "../screening/validators";
import { currentSearch } from "../../lib/research/records";
import { isRatingFilterActive } from "../../lib/utils";
import { buildDedupeKey } from "../../lib/bucket/dedupe";
import { estimatePaperCredits } from "../../lib/extraction/cost-estimate";
import { PAPER_LIMIT } from "../../lib/extraction/limits";
import { startJobFor } from "./mutations/jobs";
import { checkScreeningSelection } from "./sources/screening";
import { MAX_QUESTIONS_PER_JOB, bucketItemInputValidator, questionInputValidator, questionTypeValidator, searchFiltersValidator } from "./validators";

type PaperSet = Infer<typeof paperSetValidator>;
/** A source as a start is given it. */
type Source = Infer<typeof bucketItemInputValidator>;

const askedValidator = v.object({ question: v.string(), type: questionTypeValidator, description: v.optional(v.string()) });
const extractArgs = { name: v.string(), set: paperSetValidator, first: v.number(), last: v.number(), questions: v.array(askedValidator), usePdfs: v.optional(v.boolean()) };

/** Library papers looked up in one read. */
const ITEMS_A_READ = 200;

const invalid = (message: string) => createError("VALIDATION_ERROR", message);

/** Full texts are read only where they're turned on: a job asked for them otherwise would be approved at their price and read abstracts. */
async function checkPdfs(ctx: QueryCtx, usePdfs: boolean | undefined) {
  if (usePdfs && (await getFlag(ctx, "extraction.pdf"))?.enabled === false) throw invalid("Full texts are turned off here. Start it without `usePdfs`, from abstracts.");
}

/** How many papers a request is for. A screening is all its included papers; a search is read from its first paper. */
async function papersOf(ctx: QueryCtx, userId: Id<"users">, { set, first, last }: { set: PaperSet; first: number; last: number }) {
  const held = await papersIn(ctx, userId, set);
  if (set.kind === "screening") return held ?? 0;
  return Math.min(PAPER_LIMIT, Math.max(0, Math.min(last, held ?? last) - first + 1));
}

/**
 * The most an extraction of these papers holds: every paper at its worst case, as each paper
 * holds its own in a job started from the page (../../lib/extraction/cost-estimate.ts).
 */
async function extractionHold(ctx: QueryCtx, userId: Id<"users">, { questions, usePdfs, ...range }: { set: PaperSet; first: number; last: number; questions: unknown[]; usePdfs?: boolean }) {
  await checkPdfs(ctx, usePdfs);
  return (await papersOf(ctx, userId, range)) * estimatePaperCredits({ questionCount: questions.length, pdf: usePdfs === true });
}

/** A saved search as an extraction's source: its query, for the source's name, and the request its results page makes. */
export const searchSource = internalQuery({
  args: { userId: v.id("users"), searchId: v.string() },
  returns: searchFiltersValidator,
  handler: async (ctx, { userId, searchId }) => {
    const row = await ctx.db.query("searches").withIndex("by_user_and_localId", (q) => q.eq("userId", userId).eq("localId", searchId)).unique();
    if (!row) throw createError("NOT_FOUND", "Search not found");
    const { params, filters } = await filtersOf(ctx, userId, currentSearch(row.data));
    if (!filters) throw invalid("This search's query isn't one OpenAlex can read. Check its brackets and quotes.");
    // Which papers a person rated is theirs, not OpenAlex's: the job reads the search from OpenAlex, and would read the papers the filter leaves out.
    if (isRatingFilterActive([params.rmin, params.rmax], params.rated)) throw invalid("This search keeps papers by the person's ratings, which an extraction can't read from the search. Put its papers in a collection first, then extract from the collection.");
    return filters;
  },
});

/** A screening as an extraction's source: its included papers as they are now, how many, and what it's called. */
export const screeningSource = internalQuery({
  args: { userId: v.id("users"), jobId: v.id("screeningJobs") },
  returns: v.object({ revision: v.string(), count: v.number(), label: v.string() }),
  handler: async (ctx, { userId, jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.userId !== userId) throw createError("NOT_FOUND", "Screening not found");
    const revision = await screeningRevision(ctx, job);
    return { revision, count: await checkScreeningSelection(ctx, userId, jobId, revision), label: job.label ?? "Screening" };
  },
});

/** The person's library papers among these, by paper ID, as an extraction's sources name them. */
export const libraryItems = internalQuery({
  args: { userId: v.id("users"), openalexIds: v.array(v.string()) },
  returns: v.array(v.object({ id: v.id("libraryItems"), openalexId: v.string(), title: v.string(), doi: v.optional(v.string()), year: v.optional(v.number()) })),
  handler: async (ctx, { userId, openalexIds }) => {
    if (openalexIds.length > ITEMS_A_READ) throw new Error(`Library papers are read ${ITEMS_A_READ} at a time`);
    const found = await Promise.all(openalexIds.map((openalexId) => ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", openalexId)).first()));
    return found.flatMap((item) => (item ? [{ id: item._id, openalexId: item.openalexId, title: item.title, ...(item.doi ? { doi: item.doi } : {}), ...(item.publicationYear == null ? {} : { year: item.publicationYear }) }] : []));
  },
});

/**
 * The set as the sources an extraction starts from (./expandSources.ts), which the job reads
 * when it's set up: a saved search as its request and how many papers to read of it, a
 * screening as its included papers at their revision, and a collection's or the library's
 * papers one by one, each as the library holds it.
 */
async function sourcesOf(ctx: ActionCtx, userId: Id<"users">, { set, first, last }: { set: PaperSet; first: number; last: number }): Promise<Source[]> {
  if (set.kind === "screening") {
    const picked: { revision: string; count: number; label: string } = await ctx.runQuery(internal.extraction.start.screeningSource, { userId, jobId: set.jobId });
    return [{ bucketKey: `screening:${set.jobId}`, source: "screening", sourceRefId: set.jobId, title: picked.label, authors: [], screeningSelection: { jobId: set.jobId, revision: picked.revision, count: picked.count } }];
  }
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw invalid("Pick papers from 1 up, with the first before the last");
  if (last - first + 1 > PAPER_LIMIT) throw invalid(`An extraction takes up to ${PAPER_LIMIT.toLocaleString("en")} papers.`);
  if (set.kind === "search") {
    // The job reads a search's papers itself, from the first.
    if (first !== 1) throw invalid("An extraction reads a search from its first paper: give `first` as 1.");
    const filters: Infer<typeof searchFiltersValidator> = await ctx.runQuery(internal.extraction.start.searchSource, { userId, searchId: set.searchId });
    return [{ bucketKey: `history:${set.searchId}`, source: "history", sourceRefId: set.searchId, title: filters.query, authors: [], searchFilters: { ...filters, limit: last } }];
  }
  const { papers } = await heldPapers(ctx, userId, set, { first, last });
  const items: Source[] = [];
  for (let from = 0; from < papers.length; from += ITEMS_A_READ) {
    const found: Array<{ id: Id<"libraryItems">; openalexId: string; title: string; doi?: string; year?: number }> = await ctx.runQuery(internal.extraction.start.libraryItems, { userId, openalexIds: papers.slice(from, from + ITEMS_A_READ).map((paper) => paper.openalexId) });
    // The job reads each paper from the library again, so a source says only which it is.
    items.push(...found.map(({ id, ...paper }) => ({ bucketKey: buildDedupeKey(paper), source: set.kind === "collection" ? ("collection" as const) : ("library" as const), sourceRefId: id, title: paper.title, authors: [], openalexId: paper.openalexId })));
  }
  if (!items.length) throw invalid("There are no papers in that range");
  return items;
}

/** Starts the job from the sources the action read, as the page's start does, with the hold it's charged under when it has one. */
export const begin = internalMutation({
  args: { userId: v.id("users"), name: v.string(), bucketItems: v.array(bucketItemInputValidator), questions: v.array(questionInputValidator), usePdfs: v.boolean(), spend: v.optional(v.object({ hold: v.string(), cap: v.number() })) },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, { userId, spend, ...args }) => {
    await checkPdfs(ctx, args.usePdfs);
    return await startJobFor(ctx, userId, { ...args, mode: "extraction" }, spend);
  },
});

/**
 * Reads the set's sources and starts the job. With the figure the person approved, it is
 * held first: a balance that can't cover it starts nothing, and a job that can't start
 * gives it back.
 */
async function start(ctx: ActionCtx, userId: Id<"users">, { name, questions, usePdfs, ...range }: { name: string; set: PaperSet; first: number; last: number; questions: Array<Infer<typeof askedValidator>>; usePdfs?: boolean }, cap?: number): Promise<{ jobId: Id<"extractionJobs"> }> {
  if (!questions.length) throw invalid("Give at least one question to answer for each paper.");
  if (questions.length > MAX_QUESTIONS_PER_JOB) throw invalid(`An extraction takes up to ${MAX_QUESTIONS_PER_JOB} questions.`);
  const job = { userId, name, bucketItems: await sourcesOf(ctx, userId, range), questions: questions.map((asked, at) => ({ ...asked, key: `q_${at}` })), usePdfs: usePdfs === true };
  if (cap === undefined) return await ctx.runMutation(internal.extraction.start.begin, job);
  const hold = `extraction-job:${crypto.randomUUID()}`;
  if (!(await holdSpend(ctx, { userId, chargeId: hold, credits: cap }))) throw createError("INSUFFICIENT_CREDITS", `This extraction holds up to ${cap.toLocaleString("en")} credits, more than the balance has.`);
  try {
    return await ctx.runMutation(internal.extraction.start.begin, { ...job, spend: { hold, cap } });
  } catch (error) {
    // Given back by a function that tries again if Autumn doesn't answer: there's no job to settle it.
    await ctx.scheduler.runAfter(0, internal.billing.charge.releaseLock, { userId, chargeId: hold, attempt: 0 });
    throw error;
  }
}

export const extractAction = defineUserAction({
  path: "extraction/start:extract",
  description:
    "Starts an extraction: answers each question for each paper of a paper set, with the passage each answer rests on. The set is one of the person's collections or all their saved papers, newest saved first, papers `first` to `last` (from 1); " +
    "one of their saved searches, its first `last` papers in its results page's order (`first` is 1); or a finished screening, all its included papers, whatever `first` and `last` say. " +
    "It reads abstracts, or with `usePdfs` the full text of papers that have one, which costs about ten times as much. A question's `type` is string, number, boolean or array, and `description` says what counts as an answer. " +
    `Up to ${PAPER_LIMIT.toLocaleString("en")} papers and ${MAX_QUESTIONS_PER_JOB} questions. Spends credits. Returns the job, which runs after the reply: read its results later with extraction/queries:listJobResults.`,
  args: extractArgs,
  returns: v.object({ jobId: v.id("extractionJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: extractionHold,
  // The papers and the questions put to them.
  shown: ({ name, set, first, last, questions, usePdfs }) => ({
    name,
    ...(set.kind === "collection" ? { collectionId: set.collectionId, first, last } : set.kind === "search" ? { search: set.searchId, first, last } : set.kind === "screening" ? { screening: set.jobId } : { papers: "library", first, last }),
    question: questions.map((asked) => asked.question),
    ...(usePdfs ? { usePdfs } : {}),
  }),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: (ctx, userId, args, _author, call): Promise<{ jobId: Id<"extractionJobs"> }> => start(ctx, userId, args, call?.credits),
});
export const extract = userAction(extractAction);
export const extractForAssistant = assistantAction(extractAction);
