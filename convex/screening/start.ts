import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "../lib/functions";
import type { ChangeCall } from "../lib/userActions";
import { startHeld } from "../billing/charge";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError, readConvexErrorData } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { heldPapers } from "../paperSets/held";
import { countSearch, PAGE_SIZE, searchSnapshotValidator, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest } from "../paperSets/search";
import { checkScreening, requireMinimum, screeningHold } from "./estimate";
import { releaseDock, writeEnd } from "../assistant/jobEnds";
import { HAND_OFF_MS } from "./bookkeeping";
import { handsOn, holdOpen } from "../billing/spend";
import type { Doc } from "../_generated/dataModel";
import { paperSetValidator, saveToValidator, screeningQuestionValidator, screeningScoringConfigValidator } from "./validators";

type PaperSet = Infer<typeof paperSetValidator>;

const jobArgs = {
  questions: v.array(screeningQuestionValidator),
  scoringConfig: screeningScoringConfigValidator,
};
type Config = { questions: Infer<typeof jobArgs.questions>; scoringConfig: Infer<typeof jobArgs.scoringConfig>; saveTo?: Infer<typeof saveToValidator>; prune?: boolean };

/** Papers one count of already-answered papers reads (`screening/queries:answeredCount`). */
const ANSWERED_CHUNK = 250;

/**
 * The last paper of the job that starts at `first`, in a request that ends at `through`. A
 * search's job that another follows (`paged`) ends with one of the search's pages, so the next
 * starts on a new page: OpenAlex can return a page in another order when it's asked for again,
 * and taking up partway through one would then skip papers or repeat them.
 */
const jobEnd = (first: number, through: number, paged = false) => {
  const most = first + MAX_SCREENING_PAPERS_PER_JOB - 1;
  return through <= most ? through : paged ? Math.floor(most / PAGE_SIZE) * PAGE_SIZE : most;
};

/**
 * What the job for a request's papers from `first` takes: its papers, in the set's fixed
 * order (#341), which of the request they are, where the request goes on after them, and
 * whether the set `ended` with them, which ends the request. A search's papers come by
 * position, from the search as it was when the request began (`snapshot`), so an edit made
 * while it runs doesn't mix two searches. A held set's first job starts at its position, and
 * each job after reads on from where the last stopped (`resume`). For a search, how many of
 * the papers its page already answers is counted too, for the credit check.
 */
async function jobPapers(ctx: ActionCtx, userId: Id<"users">, { set, first, through, resume, snapshot }: { set: PaperSet; first: number; through: number; resume?: string; snapshot?: SearchSnapshot }, questions: Config["questions"]) {
  const last = jobEnd(first, through, set.kind === "search");
  if (set.kind !== "search") {
    const read = await heldPapers(ctx, userId, set, { first, last }, resume);
    return { papers: read.papers, ended: !read.resume, range: { set, first, last, ...(through > last && read.resume ? { through, resume: read.resume } : {}) } };
  }
  const searchId = set.searchId;
  const { papers, ended, snapshot: taken, resume: after } = await searchPapers(ctx, userId, { searchId, first, last }, snapshot, { resume, goesOn: through > last });
  let answered = 0;
  const asked = questions.map((q) => q.question);
  for (let from = 0; from < papers.length; from += ANSWERED_CHUNK) {
    const paperIds = papers.slice(from, from + ANSWERED_CHUNK).map((paper) => paper.openalexId);
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const count: number = await ctx.runQuery(internal.screening.queries.answeredCount, { userId, searchId, questions: asked, paperIds });
    answered += count;
  }
  return { papers, ended, range: { set, first, last, answered, snapshot: taken, ...(through > last && !ended ? { through, resume: after } : {}) } };
}

/**
 * Starts a request's first job. A search's job is made before its papers are read, and they
 * follow it (`read`): OpenAlex can take seconds over them, and nobody waits on the form for
 * that. One request first counts the search, so a query OpenAlex won't take, or a range past
 * the search's last paper, is refused here. Papers the account holds are read at once.
 */
async function start(ctx: ActionCtx, userId: Id<"users">, author: "user" | "assistant", { set, first, last: through, ...config }: Config & { set: PaperSet; first: number; last: number }, call?: ChangeCall): Promise<{ jobId: Id<"screeningJobs"> }> {
  const spendCap = call?.credits;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(through) || first < 1 || through < first) {
    throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  }
  requireMinimum(config.scoringConfig);
  // Everything the estimate checks before the person is asked, checked again by the start itself, so no path skips it.
  await ctx.runQuery(internal.screening.start.check, { userId, set, first, last: through, ...config });
  // What the person approved is the whole request's to spend, however many jobs it takes: the first job holds it, and each job after takes the hold on (`next`).
  // What the person approved is held once, and the job's papers are charged under the hold (../billing/charge.ts): the job is made with both, or not at all.
  type Made = { jobId: Id<"screeningJobs"> };
  // A job the assistant started keeps the step it started from, so its chat hears when it ends.
  const step = call?.from ? { chatStep: call.from } : {};
  const approved = (make: (spend: { spendCap?: number; spendHold?: string; chatStep?: Id<"assistantSteps"> }) => Promise<Made>): Promise<Made> =>
    spendCap === undefined ? make(step) : startHeld(ctx, { userId, credits: spendCap, kind: "screening" }, (spendHold) => make({ spendCap, spendHold, ...step }));
  if (set.kind === "search") {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: set.searchId });
    const snapshot = snapshotOf(found);
    const total = await countSearch(snapshot.request, spender(ctx, found.clerkId));
    if (first > total) throw createError("VALIDATION_ERROR", "There are no papers in that range");
    // No further than the search goes: papers past its last are never asked for.
    const end = Math.min(through, total);
    const last = jobEnd(first, end, true);
    return await approved((spend) =>
      ctx.runMutation(internal.screening.mutations.openScreeningJob, {
        userId, author, set, first, last, snapshot, ...config,
        papers: last - first + 1,
        ...(end > last ? { through: end } : {}),
        ...spend,
      }),
    );
  }
  for (let from = first; from <= through; from = jobEnd(from, through) + 1) {
    const { papers, ended, range } = await jobPapers(ctx, userId, { set, first: from, through }, config.questions);
    if (papers.length) return await approved((spend) => ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, author, papers, ...range, ...config, ...spend }));
    if (ended) break;
  }
  throw createError("VALIDATION_ERROR", "There are no papers in that range");
}

/** Whether a job that handed its request on has a job after it, under the same approval. */
async function handedOn(ctx: MutationCtx, job: Doc<"screeningJobs">) {
  const chatStep = job.chatStep;
  const later = chatStep
    ? await ctx.db.query("screeningJobs").withIndex("by_chatStep", (q) => q.eq("chatStep", chatStep)).order("desc").first()
    : await ctx.db.query("screeningJobs").withIndex("by_user", (q) => q.eq("userId", job.userId)).order("desc").first();
  return later !== null && later._id !== job._id && later._creationTime > job._creationTime && later.spendHold === job.spendHold;
}

/**
 * Ends a request that a completed job handed on (../billing/spend.ts `handsOn`) when no job
 * took it: its hold is settled, the dock row it kept for the next job goes, and with `tell`,
 * the chat that started it hears that it ended with that job, once.
 */
export async function endRequest(ctx: MutationCtx, job: Doc<"screeningJobs">, tell: boolean) {
  if (job.spendHold) await ctx.scheduler.runAfter(0, internal.screening.start.settleHold, { jobId: job._id, hold: job.spendHold, waited: 0 });
  await releaseDock(ctx, job.chatStep);
  if (tell && !(await ctx.db.query("assistantJobEnds").withIndex("by_job", (q) => q.eq("jobId", job._id)).first())) await writeEnd(ctx, "screening", job);
}

/** Ends the request after `jobId`: the set ran out of papers, so no job takes it. */
export const endedRequest = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (job) await endRequest(ctx, job, true);
    return null;
  },
});

/**
 * Looks, a while after a job handed its request on, for the job after it, and ends the request
 * without one if none came: the action starting it can stop part way, and Convex doesn't run
 * an action again. A request already ended is left alone.
 */
export const watchHandOff = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || !handsOn(job) || (await handedOn(ctx, job))) return null;
    if (job.spendHold && !(await holdOpen(ctx, job.spendHold))) return null;
    console.error(`[screening] No job took the request after ${jobId}; it ends there`);
    await endRequest(ctx, job, true);
    return null;
  },
});

/** Passes over a stretch of the set with no papers: the next stretch is looked at, and the request's wait for its next job starts again. */
export const passOver = internalMutation({
  args: { jobId: v.id("screeningJobs"), first: v.number(), resume: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.screening.start.next, args);
    await ctx.scheduler.runAfter(HAND_OFF_MS, internal.screening.start.watchHandOff, { jobId: args.jobId });
    return null;
  },
});

/** How often an ended job is looked at again while a paper of it is still being read, and for how long at most: longer than a paper's worker can run. */
const RUNNING_CHECK_MS = 15_000;
const RUNNING_WAIT_MS = 12 * 60_000;
/** How long after its last paper stopped being read a job's hold is settled: the paper's cost is recorded a moment after it's counted as done. */
const SETTLE_AFTER_MS = 30_000;

/**
 * Settles the hold of a job that has ended (../lib/triggers.ts), once none of its papers is
 * still being read: one read when the job stopped or was cancelled is recorded under the
 * hold when it ends, and every charge of the job goes through the hold's one confirm
 * (../billing/charge.ts).
 */
export const settleHold = internalMutation({
  args: { jobId: v.id("screeningJobs"), hold: v.string(), waited: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, hold, waited }) => {
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    if ((progress?.running ?? 0) > 0 && waited < RUNNING_WAIT_MS) await ctx.scheduler.runAfter(RUNNING_CHECK_MS, internal.screening.start.settleHold, { jobId, hold, waited: waited + RUNNING_CHECK_MS });
    else await ctx.scheduler.runAfter(0, internal.billing.charge.laterSpent, { chargeId: hold, attempt: 0, delay: SETTLE_AFTER_MS });
    return null;
  },
});

/**
 * Reads the papers of a job made on a search and gives them to it. The search's rating filter
 * can leave a whole stretch with no papers: the job then takes the request's first stretch
 * that has some, and the reading stops where the search's results end. A job that gets no
 * papers, or whose papers OpenAlex won't return, ends as failed with why.
 */
export const read = internalAction({
  args: {
    jobId: v.id("screeningJobs"),
    userId: v.id("users"),
    searchId: v.string(),
    first: v.number(),
    through: v.number(),
    questions: v.array(screeningQuestionValidator),
    snapshot: searchSnapshotValidator,
  },
  returns: v.null(),
  handler: async (ctx, { jobId, userId, searchId, first, through, questions, snapshot }) => {
    try {
      // Where the stretch before stopped, once one has been read.
      let resume: string | undefined;
      for (let from = first; from <= through; from = jobEnd(from, through, true) + 1) {
        const { papers, ended, range } = await jobPapers(ctx, userId, { set: { kind: "search", searchId }, first: from, through, snapshot, resume }, questions);
        if (papers.length) {
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, first: range.first, last: range.last, answered: "answered" in range ? range.answered : 0, ...("through" in range ? { through: range.through, resume: range.resume } : {}) });
          return null;
        }
        if (ended) break;
        // Cancelled meanwhile: the stretches after this one aren't read for nothing.
        const waits: boolean = await ctx.runQuery(internal.screening.queries.awaitsPapers, { jobId });
        if (!waits) return null;
        resume = range.resume;
      }
      throw createError("VALIDATION_ERROR", "None of these papers match the search's rating filter");
    } catch (error) {
      console.error(`[screening] Job ${jobId} couldn't get its papers`, error);
      await ctx.runMutation(internal.screening.mutations.failScreeningRead, { jobId, reason: readConvexErrorData(error)?.message ?? "Its papers couldn't be read. Run it again." });
    }
    return null;
  },
});

/**
 * Screen all on a set of papers: the server reads papers `first` to `last` of it (#341) and
 * starts the job, so the browser never fetches or sends them. A range bigger than one job
 * runs as several, one after another: each reads its own papers when the one before
 * completes (`next`).
 */
/** What starting a screening refuses before it reads a paper (./estimate.ts `checkScreening`). */
export const check = internalQuery({
  args: { userId: v.id("users"), set: paperSetValidator, first: v.number(), last: v.number(), ...jobArgs, saveTo: v.optional(saveToValidator), prune: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { userId, ...request }) => {
    await checkScreening(ctx, userId, request);
    return null;
  },
});

export const screenAction = defineUserAction({
  path: "screening/start:screen",
  description:
    "Screens papers `first` to `last` (from 1) of a paper set: one of the person's saved searches, in its results page's order and rating filter; one of their collections or all their saved papers, newest saved first; " +
    "or the included papers of an earlier screening. Answers the questions for each paper and scores them by the rules. A search's answers show on its page, and papers that page already answered every question for keep their answers and cost nothing. " +
    "A search's job is made at once and its papers are read after: until then the job is `reading`, and one whose papers can't be read ends `failed`, with why in its `failure`. " +
    `Included papers go to \`saveTo\`. With \`prune\`, papers of a collection that end excluded or failed leave it. More than ${MAX_SCREENING_PAPERS_PER_JOB} papers run as several jobs, one after another; returns the first. Spends credits.`,
  args: { set: paperSetValidator, first: v.number(), last: v.number(), ...jobArgs, saveTo: saveToValidator, prune: v.optional(v.boolean()) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: screeningHold,
  // The papers, the questions put to them and where the included ones go. How each answer scores is the job's own business.
  shown: ({ set, first, last, questions, saveTo, prune }) => ({
    ...(set.kind === "collection" ? { collectionId: set.collectionId } : set.kind === "search" ? { search: set.searchId } : set.kind === "screening" ? { screening: set.jobId } : { papers: "library" }),
    first,
    last,
    question: questions.map((asked) => asked.question),
    ...(saveTo.kind === "new" ? { saveTo: saveTo.name } : saveTo.kind === "collection" ? { saveTo: saveTo.collectionId } : {}),
    ...(prune ? { prune } : {}),
  }),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: (ctx, userId, args, author, call): Promise<{ jobId: Id<"screeningJobs"> }> => start(ctx, userId, author, args, call),
});
export const screen = userAction(screenAction);
export const screenForAssistant = assistantAction(screenAction);

/**
 * Starts the job for a request's next papers, from `first`, once the job before it
 * completed: the same questions, rules and destination. A stretch of a search with no papers
 * (its rating filter left none) is passed over; a set with no more papers ends the request.
 * If the job can't start, the request stops there, and the page shows a failed job in the
 * next one's place.
 */
export const next = internalAction({
  // `resume`: where a stretch with no papers stopped, when the job is looked for past one.
  args: { jobId: v.id("screeningJobs"), first: v.number(), resume: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { jobId, first, resume: past }) => {
    const job = await ctx.runQuery(internal.screening.queries.requestJob, { jobId });
    if (!job) return null;
    const { userId, set, through, resume: left, snapshot, label, ...config } = job;
    const resume = past ?? left;
    const last = jobEnd(first, through, set.kind === "search");
    try {
      const { papers, ended, range } = await jobPapers(ctx, userId, { set, first, through, resume, snapshot }, config.questions);
      if (papers.length) await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, chained: true, ...range, ...config });
      else if (!ended && through > last) await ctx.runMutation(internal.screening.start.passOver, { jobId, first: last + 1, ...(range.resume ? { resume: range.resume } : {}) });
      // The set has no more papers: the request ends with the job before.
      else await ctx.runMutation(internal.screening.start.endedRequest, { jobId });
    } catch (error) {
      console.error(`[screening] The job after ${jobId} couldn't start`, error);
      const { questions, scoringConfig } = config;
      await ctx.runMutation(internal.screening.mutations.stopRequest, { userId, set, first, last, ...(through > last ? { through } : {}), questions, scoringConfig, ...(label ? { label } : {}), after: jobId });
    }
    return null;
  },
});
