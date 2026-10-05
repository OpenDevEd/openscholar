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
import { SERVER_MODEL_SLUG } from "../ai/config";
import { extractionStamp } from "../ai/serverModel";
import { getFlag } from "../featureFlags/guard";
import { startHeld } from "../billing/charge";
import { heldPapers } from "../paperSets/held";
import { filtersOf } from "../paperSets/search";
import { screeningRevision } from "../screening/accounting";
import { papersIn } from "../screening/estimate";
import { paperSetValidator } from "../screening/validators";
import { currentSearch } from "../../lib/research/records";
import { isRatingFilterActive } from "../../lib/utils";
import { buildDedupeKey } from "../../lib/bucket/dedupe";
import { estimatePaperCredits, priceScale } from "../../lib/extraction/cost-estimate";
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
/** How often an ended job is looked at again while a paper of it is still being read, and for how long at most: longer than a paper's worker can run. */
const RUNNING_CHECK_MS = 15_000;
const RUNNING_WAIT_MS = 12 * 60_000;
/** How long after its last paper stopped being read a job's hold is settled: the paper's cost is recorded a moment after its row says it's done. */
const SETTLE_AFTER_MS = 30_000;

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
 * How many times the measured rates a question of the job costs, on the models the job sends
 * its questions to (../ai/serverModel.ts `extractionStamp`): the one the person's extractions
 * run on, or the server's when they picked none, and for yes/no questions the decision model,
 * when they screen with one. The rates were measured on a small model, and a job on Claude
 * Sonnet cost twelve times them: its approval would have been for a twelfth of the job.
 */
async function scaleOf(ctx: QueryCtx, userId: Id<"users">, questions: Array<{ type: string }>) {
  const stamp: { serverModelId?: Id<"models">; decisionModelId?: Id<"models"> } = await extractionStamp(ctx, userId);
  const scaleAt = async (modelId: Id<"models"> | undefined) => {
    const model = modelId ? await ctx.db.get("models", modelId) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).first();
    return priceScale(model && { input: model.inputPricePerMillion, output: model.outputPricePerMillion });
  };
  const own = await scaleAt(stamp.serverModelId);
  const yesNo = stamp.decisionModelId ? questions.filter((asked) => asked.type === "boolean").length : 0;
  return yesNo ? (own * (questions.length - yesNo) + (await scaleAt(stamp.decisionModelId)) * yesNo) / questions.length : own;
}

/** The most an extraction of these papers holds: every paper at its worst case, at the price of the models it runs on. */
async function extractionHold(ctx: QueryCtx, userId: Id<"users">, { questions, usePdfs, ...range }: { set: PaperSet; first: number; last: number; questions: Array<{ type: string }>; usePdfs?: boolean }) {
  await checkPdfs(ctx, usePdfs);
  return (await papersOf(ctx, userId, range)) * estimatePaperCredits({ questionCount: questions.length, pdf: usePdfs === true, scale: await scaleOf(ctx, userId, questions) });
}

/** The same figure, for the start to check what was approved against (see `start`). */
export const figure = internalQuery({
  args: { userId: v.id("users"), ...extractArgs },
  returns: v.number(),
  handler: (ctx, { userId, ...args }) => extractionHold(ctx, userId, args),
});

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
    // The job keeps the price its figure was worked out at, read in the transaction that stamps its models: its papers are measured against the figure at that price, whatever the person picks later.
    return await startJobFor(ctx, userId, { ...args, mode: "extraction" }, spend && { ...spend, scale: await scaleOf(ctx, userId, args.questions) });
  },
});

/**
 * Settles the hold of a job that has ended (../lib/triggers.ts), once none of its papers is
 * still being read: one read when the job stopped or was cancelled is recorded under the
 * hold when it ends, and every charge of the job goes through the hold's one confirm. A job
 * the person has carried on meanwhile left the hold behind, and it is settled as it stands.
 */
export const settleHold = internalMutation({
  args: { jobId: v.id("extractionJobs"), hold: v.string(), waited: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, hold, waited }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    const reading = job?.spendHold === hold && (await ctx.db.query("extractionPaperQueue").withIndex("by_job_and_status", (q) => q.eq("jobId", jobId).eq("status", "running")).first()) !== null;
    if (reading && waited < RUNNING_WAIT_MS) await ctx.scheduler.runAfter(RUNNING_CHECK_MS, internal.extraction.start.settleHold, { jobId, hold, waited: waited + RUNNING_CHECK_MS });
    else await ctx.scheduler.runAfter(0, internal.billing.charge.laterSpent, { chargeId: hold, attempt: 0, delay: SETTLE_AFTER_MS });
    return null;
  },
});

/**
 * Reads the set's sources and starts the job. With the figure the person approved, it is
 * held first (billing/charge.ts `startHeld`).
 */
async function start(ctx: ActionCtx, userId: Id<"users">, { name, questions, usePdfs, ...range }: { name: string; set: PaperSet; first: number; last: number; questions: Array<Infer<typeof askedValidator>>; usePdfs?: boolean }, cap?: number): Promise<{ jobId: Id<"extractionJobs"> }> {
  if (!questions.length) throw invalid("Give at least one question to answer for each paper.");
  if (questions.length > MAX_QUESTIONS_PER_JOB) throw invalid(`An extraction takes up to ${MAX_QUESTIONS_PER_JOB} questions.`);
  const job = { userId, name, bucketItems: await sourcesOf(ctx, userId, range), questions: questions.map((asked, at) => ({ ...asked, key: `q_${at}` })), usePdfs: usePdfs === true };
  if (cap === undefined) return await ctx.runMutation(internal.extraction.start.begin, job);
  // What was approved is what the job holds now, or more: the papers or the model may have changed since the person was asked, and a job that holds more than they said yes to is asked about again.
  const now: number = await ctx.runQuery(internal.extraction.start.figure, { userId, name, questions, ...(usePdfs === undefined ? {} : { usePdfs }), ...range });
  if (now > cap) throw invalid(`This extraction now holds up to ${Math.ceil(now).toLocaleString("en")} credits, more than the ${cap.toLocaleString("en")} approved: its papers or the model it runs on changed since. Call it again, and the person is asked with the new figure.`);
  return await startHeld(ctx, { userId, credits: cap, kind: "extraction" }, (hold) => ctx.runMutation(internal.extraction.start.begin, { ...job, spend: { hold, cap } }));
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
