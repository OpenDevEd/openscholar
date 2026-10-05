import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../lib/functions";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError, readConvexErrorData } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { heldPapers } from "../paperSets/held";
import { countSearch, searchSnapshotValidator, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest } from "../paperSets/search";
import { screeningHold } from "./estimate";
import { paperSetValidator, saveToValidator, screeningQuestionValidator, screeningScoringConfigValidator } from "./validators";

type PaperSet = Infer<typeof paperSetValidator>;

const jobArgs = {
  questions: v.array(screeningQuestionValidator),
  scoringConfig: screeningScoringConfigValidator,
};
type Config = { questions: Infer<typeof jobArgs.questions>; scoringConfig: Infer<typeof jobArgs.scoringConfig>; saveTo?: Infer<typeof saveToValidator>; prune?: boolean };

/** Papers one count of already-answered papers reads (`screening/queries:answeredCount`). */
const ANSWERED_CHUNK = 250;

/** The last paper of the job that starts at `first`, in a request that ends at `through`. */
const jobEnd = (first: number, through: number) => Math.min(through, first + MAX_SCREENING_PAPERS_PER_JOB - 1);

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
  const last = jobEnd(first, through);
  if (set.kind !== "search") {
    const read = await heldPapers(ctx, userId, set, { first, last }, resume);
    return { papers: read.papers, ended: !read.resume, range: { set, first, last, ...(through > last && read.resume ? { through, resume: read.resume } : {}) } };
  }
  const searchId = set.searchId;
  const { papers, ended, snapshot: taken } = await searchPapers(ctx, userId, { searchId, first, last }, snapshot);
  let answered = 0;
  const asked = questions.map((q) => q.question);
  for (let from = 0; from < papers.length; from += ANSWERED_CHUNK) {
    const paperIds = papers.slice(from, from + ANSWERED_CHUNK).map((paper) => paper.openalexId);
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const count: number = await ctx.runQuery(internal.screening.queries.answeredCount, { userId, searchId, questions: asked, paperIds });
    answered += count;
  }
  return { papers, ended, range: { set, first, last, answered, snapshot: taken, ...(through > last && !ended ? { through } : {}) } };
}

/**
 * Starts a request's first job. A search's job is made before its papers are read, and they
 * follow it (`read`): OpenAlex can take seconds over them, and nobody waits on the form for
 * that. One request first counts the search, so a query OpenAlex won't take, or a range past
 * the search's last paper, is refused here. Papers the account holds are read at once.
 */
async function start(ctx: ActionCtx, userId: Id<"users">, author: "user" | "assistant", { set, first, last: through, ...config }: Config & { set: PaperSet; first: number; last: number }, spendCap?: number): Promise<{ jobId: Id<"screeningJobs"> }> {
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(through) || first < 1 || through < first) {
    throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  }
  // What the person approved is one job's to spend. The jobs that would follow it in a longer request start later, by themselves, with no figure of their own.
  if (spendCap !== undefined && through > jobEnd(first, through)) {
    throw createError("VALIDATION_ERROR", `A screening started here takes up to ${MAX_SCREENING_PAPERS_PER_JOB.toLocaleString("en")} papers. Screen papers ${first} to ${jobEnd(first, through)} first, then the rest.`);
  }
  if (set.kind === "search") {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, searchId: set.searchId });
    const snapshot = snapshotOf(found);
    const total = await countSearch(snapshot.request, spender(ctx, found.clerkId));
    if (first > total) throw createError("VALIDATION_ERROR", "There are no papers in that range");
    // No further than the search goes: papers past its last are never asked for.
    const end = Math.min(through, total);
    const last = jobEnd(first, end);
    return await ctx.runMutation(internal.screening.mutations.openScreeningJob, {
      userId, author, set, first, last, snapshot, ...config,
      papers: last - first + 1,
      ...(end > last ? { through: end } : {}),
      ...(spendCap === undefined ? {} : { spendCap }),
    });
  }
  for (let from = first; from <= through; from = jobEnd(from, through) + 1) {
    const { papers, ended, range } = await jobPapers(ctx, userId, { set, first: from, through }, config.questions);
    if (papers.length) return await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, author, papers, ...range, ...config, ...(spendCap === undefined ? {} : { spendCap }) });
    if (ended) break;
  }
  throw createError("VALIDATION_ERROR", "There are no papers in that range");
}

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
      for (let from = first; from <= through; from = jobEnd(from, through) + 1) {
        const { papers, ended, range } = await jobPapers(ctx, userId, { set: { kind: "search", searchId }, first: from, through, snapshot }, questions);
        if (papers.length) {
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, first: range.first, last: range.last, answered: "answered" in range ? range.answered : 0, ...("through" in range ? { through: range.through } : {}) });
          return null;
        }
        if (ended) break;
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
  run: (ctx, userId, args, author, call): Promise<{ jobId: Id<"screeningJobs"> }> => start(ctx, userId, author, args, call?.credits),
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
  args: { jobId: v.id("screeningJobs"), first: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, first }) => {
    const job = await ctx.runQuery(internal.screening.queries.requestJob, { jobId });
    if (!job) return null;
    const { userId, set, through, resume, snapshot, label, ...config } = job;
    const last = jobEnd(first, through);
    try {
      const { papers, ended, range } = await jobPapers(ctx, userId, { set, first, through, resume, snapshot }, config.questions);
      if (papers.length) await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, author: "user", papers, chained: true, ...range, ...config });
      else if (!ended && through > last) await ctx.scheduler.runAfter(0, internal.screening.start.next, { jobId, first: last + 1 });
    } catch (error) {
      console.error(`[screening] The job after ${jobId} couldn't start`, error);
      const { questions, scoringConfig } = config;
      await ctx.runMutation(internal.screening.mutations.stopRequest, { userId, set, first, last, ...(through > last ? { through } : {}), questions, scoringConfig, ...(label ? { label } : {}) });
    }
    return null;
  },
});
