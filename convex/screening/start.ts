import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError } from "../lib/errors";
import { searchPapers } from "../paperSets/search";
import { screeningQuestionValidator, screeningScoringConfigValidator } from "./validators";

/**
 * Screen all on a saved search: the server reads papers `first` to `last` of its results
 * (#341) and starts the job, so the browser never fetches or sends them.
 */
export const screenSearchAction = defineUserAction({
  path: "screening/start:screenSearch",
  description:
    "Screens papers `first` to `last` (from 1) of one of the person's saved searches, in its results page's order and rating filter, " +
    "answering the questions for each paper and scoring them by the rules. Answers show on that search's page. Spends credits.",
  args: {
    searchId: v.string(),
    first: v.number(),
    last: v.number(),
    questions: v.array(screeningQuestionValidator),
    scoringConfig: screeningScoringConfigValidator,
    targetCollectionId: v.optional(v.id("collections")),
  },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: async (ctx, userId, { searchId, first, last, ...job }): Promise<{ jobId: Id<"screeningJobs"> }> => {
    const papers = await searchPapers(ctx, userId, { searchId, first, last });
    if (papers.length === 0) throw createError("VALIDATION_ERROR", "None of these papers match the search's rating filter");
    return await ctx.runMutation(internal.screening.mutations.createScreeningJobForUser, { userId, papers, searchId, ...job });
  },
});

export const screenSearch = userAction(screenSearchAction);
export const screenSearchForAssistant = assistantAction(screenSearchAction);
