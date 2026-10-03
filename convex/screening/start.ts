import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../lib/functions";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { heldPapers } from "../paperSets/held";
import { searchPapers } from "../paperSets/search";
import { paperSetValidator, saveToValidator, screeningQuestionValidator, screeningScoringConfigValidator } from "./validators";

type PaperSet = Infer<typeof paperSetValidator>;

/** Papers `first` to `last` (from 1) of a set, in its fixed order (#341). */
function papersOf(ctx: ActionCtx, userId: Id<"users">, set: PaperSet, range: { first: number; last: number }) {
  return set.kind === "search" ? searchPapers(ctx, userId, { searchId: set.searchId, ...range }) : heldPapers(ctx, userId, set, range);
}

/** The last paper of the job that starts at `first`, in a request that ends at `through`. */
const jobEnd = (first: number, through: number) => Math.min(through, first + MAX_SCREENING_PAPERS_PER_JOB - 1);

const jobArgs = {
  questions: v.array(screeningQuestionValidator),
  scoringConfig: screeningScoringConfigValidator,
};
type Start = { set: PaperSet; first: number; last: number; questions: Infer<typeof jobArgs.questions>; scoringConfig: Infer<typeof jobArgs.scoringConfig>; saveTo?: Infer<typeof saveToValidator>; prune?: boolean };

/** Reads the request's first job's papers and starts it. */
async function start(ctx: ActionCtx, userId: Id<"users">, author: "user" | "assistant", { set, first, last: through, ...job }: Start): Promise<{ jobId: Id<"screeningJobs"> }> {
  const last = jobEnd(first, through);
  const papers = await papersOf(ctx, userId, set, { first, last });
  if (papers.length === 0) throw createError("VALIDATION_ERROR", set.kind === "search" ? "None of these papers match the search's rating filter" : "There are no papers in that range");
  return await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, author, papers, set, first, last, ...(through > last ? { through } : {}), ...job });
}

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
    `Included papers go to \`saveTo\`. With \`prune\`, papers of a collection that end excluded or failed leave it. More than ${MAX_SCREENING_PAPERS_PER_JOB} papers run as several jobs, one after another; returns the first. Spends credits.`,
  args: { set: paperSetValidator, first: v.number(), last: v.number(), ...jobArgs, saveTo: saveToValidator, prune: v.optional(v.boolean()) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: (ctx, userId, args, author): Promise<{ jobId: Id<"screeningJobs"> }> => start(ctx, userId, author, args),
});
export const screen = userAction(screenAction);
export const screenForAssistant = assistantAction(screenAction);

/**
 * Screen all from the results page's dialog, on a saved search: included papers are saved to
 * the library, and to `targetCollectionId` when given. The screening page starts jobs
 * through `screen`; this goes with the dialog.
 */
export const screenSearchAction = defineUserAction({
  path: "screening/start:screenSearch",
  description:
    "Screens papers `first` to `last` (from 1) of one of the person's saved searches, in its results page's order and rating filter, " +
    "answering the questions for each paper and scoring them by the rules. Answers show on that search's page. Spends credits.",
  args: { searchId: v.string(), first: v.number(), last: v.number(), ...jobArgs, targetCollectionId: v.optional(v.id("collections")) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  run: (ctx, userId, { searchId, targetCollectionId, ...job }, author): Promise<{ jobId: Id<"screeningJobs"> }> =>
    start(ctx, userId, author, { set: { kind: "search", searchId }, ...job, ...(targetCollectionId ? { saveTo: { kind: "collection" as const, collectionId: targetCollectionId } } : {}) }),
});
export const screenSearch = userAction(screenSearchAction);
export const screenSearchForAssistant = assistantAction(screenSearchAction);

/**
 * Starts the job for a request's next papers, from `first`, once the job before it
 * completed: the same questions, rules and destination. A stretch with no papers (a search's
 * rating filter left none) is passed over. If the job can't start, the request stops there,
 * and the page shows a failed job in the next one's place.
 */
export const next = internalAction({
  args: { jobId: v.id("screeningJobs"), first: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, first }) => {
    const job = await ctx.runQuery(internal.screening.queries.requestJob, { jobId });
    if (!job) return null;
    const { userId, set, through, label, questions, scoringConfig, ...destination } = job;
    const last = jobEnd(first, through);
    const stretch = { userId, set, first, last, ...(through > last ? { through } : {}), questions, scoringConfig };
    try {
      const papers = await papersOf(ctx, userId, set, { first, last });
      if (papers.length) await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { author: "user", papers, chained: true, ...stretch, ...destination });
      else if (through > last) await ctx.scheduler.runAfter(0, internal.screening.start.next, { jobId, first: last + 1 });
    } catch (error) {
      console.error(`[screening] The job after ${jobId} couldn't start`, error);
      await ctx.runMutation(internal.screening.mutations.stopRequest, { ...stretch, ...(label ? { label } : {}) });
    }
    return null;
  },
});
