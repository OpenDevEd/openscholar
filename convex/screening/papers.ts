/**
 * A screening job's papers as its page reads and changes them: a page of one outcome at a
 * time, and one answer changed by hand, which the paper's score, stars and outcome follow.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { answerPaper, paperAnswers, restoreModelAnswer } from "../research/answers";
import schema from "../schema";
import { account, answersNow, jobAnswers, shown, stood, withDeltas } from "./accounting";
import { progressOf, shelve } from "./bookkeeping";
import { moveResultAnswers } from "./drain";
import { screeningJobPaperValidator, screeningOutcomeValidator } from "./validators";

/** Papers one page holds at most; each also reads its answers. */
const PAGE_MAX = 50;
/** Bytes of results one page reads: a result holds its paper's abstract. */
const PAGE_BYTES = 4 * 1024 * 1024;

export const listAction = defineUserQuery({
  path: "screening/papers:list",
  description:
    "Lists the papers of one of the person's screening jobs that landed in one outcome (included, unclear, excluded or failed), a page at a time in the order the job took them, " +
    "each with its score, stars and the answer to every question it was scored on. Given `text`, only papers whose title or authors contain it.",
  args: { jobId: v.id("screeningJobs"), outcome: screeningOutcomeValidator, text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(screeningJobPaperValidator),
  run: async (ctx, userId, { jobId, outcome, text, paginationOpts }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.userId !== userId) return { page: [], isDone: true, continueCursor: "" };
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX), maximumBytesRead: PAGE_BYTES };
    const needle = text?.trim().toLowerCase();
    const page = await (needle
      ? stream(ctx.db, schema).query("screeningResults").withIndex("by_job_and_outcome", (q) => q.eq("jobId", jobId).eq("outcome", outcome))
          .filterWith(async (row) => row.title.toLowerCase().includes(needle) || (row.authors ?? []).some((author) => author.toLowerCase().includes(needle)))
          // A job holds at most this many papers, so a search looks through all of them.
          .paginate({ ...opts, maximumRowsRead: MAX_SCREENING_PAPERS_PER_JOB })
      : ctx.db.query("screeningResults").withIndex("by_job_and_outcome", (q) => q.eq("jobId", jobId).eq("outcome", outcome)).paginate(opts));
    const answers = await Promise.all(page.page.map((result) => shown(ctx, job, result)));
    return {
      ...page,
      page: page.page.map((result, i) => ({
        openalexId: result.openalexId,
        title: result.title,
        abstract: result.abstract,
        authors: result.authors,
        publicationYear: result.publicationYear,
        doi: result.doi,
        venue: result.venue,
        citedByCount: result.citedByCount,
        outcome,
        score: result.score,
        stars: result.stars,
        answers: answers[i],
      })),
    };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const answerAction = defineUserMutation({
  path: "screening/papers:answer",
  description:
    "Changes one answer of a screened paper in one of the person's screening jobs: yes (true), no (false) or unclear (null), or \"model\" to put back the model's own answer. " +
    "The paper's score, stars and outcome follow, and a paper that becomes included is saved the way the job saves included papers.",
  args: { jobId: v.id("screeningJobs"), paperId: v.string(), questionKey: v.string(), answer: v.union(v.boolean(), v.null(), v.literal("model")) },
  returns: v.object({ outcome: screeningOutcomeValidator }),
  spendsCredits: false,
  outsideEffect: false,
  // "model" puts an answer back, but nothing hands the assistant the command that reverses a change yet (#342).
  undoable: false,
  run: async (ctx, userId, { jobId, paperId, questionKey, answer }, author) => {
    let job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.userId !== userId) throw createError("SCREENING_JOB_NOT_FOUND", "Screening job not found");
    const question = job.questions.find((q) => q.key === questionKey);
    if (!question) throw createError("VALIDATION_ERROR", "This screening doesn't ask that question");
    let result = await ctx.db.query("screeningResults").withIndex("by_job_openalexId", (q) => q.eq("jobId", jobId).eq("openalexId", paperId)).unique();
    if (!result || result.status !== "completed") throw createError("VALIDATION_ERROR", "Only a screened paper's answers can be changed");
    // Answers still waiting on the result move to the job's screening first: that's where they change.
    if (result.answers) {
      await moveResultAnswers(ctx, result);
      [job, result] = [(await ctx.db.get("screeningJobs", jobId))!, (await ctx.db.get("screeningResults", result._id))!];
    }
    const screeningId = job.screeningId;
    if (!screeningId) throw createError("VALIDATION_ERROR", "This screening kept no answers to change");

    // The change goes to the job's screening, which a job on a search shares with the search's page.
    const now = Date.now();
    // The model's own answer is the one this job got, even if the screening has lost it since.
    const original = answer === "model" ? ((await jobAnswers(ctx, job, result))?.[questionKey] ?? null) : null;
    if (answer === "model") {
      const kept = (await paperAnswers(ctx, (await ctx.db.get("screenings", screeningId))!, paperId)).find((value) => value.question === question.question);
      // Cleared from the screening since: the model's answer goes back in before it's restored.
      if (!kept?.model && kept?.setBy !== "model") await answerPaper(ctx, screeningId, paperId, [{ question: question.question, response: original }], "model", now);
      await restoreModelAnswer(ctx, screeningId, paperId, question.question, now);
    } else {
      await answerPaper(ctx, screeningId, paperId, [{ question: question.question, response: answer }], author === "assistant" ? "assistant" : "person", now);
    }

    // A counted paper keeps the answers it was scored on, with this one changed; one not
    // counted yet, or counted before papers kept theirs, is scored on its answers as they stand.
    const was = result.counted?.answers;
    const scoredOn = was
      ? { answers: { ...was, [questionKey]: answer === "model" ? original : answer }, changed: [...(result.counted?.changed ?? []).filter((key) => key !== questionKey), ...(answer === "model" ? [] : [questionKey])] }
      : stood(await answersNow(ctx, job, result));
    const { patch: { counted, ...scored }, delta, move } = account(job, result, scoredOn);
    const outcome = scored.outcome;
    // A paper the bookkeeping worker hasn't reached is counted there, on its answers as they stand then.
    if (result.doneAt !== undefined) {
      await ctx.db.patch("screeningResults", result._id, scored);
      return { outcome };
    }
    const progress = await progressOf(ctx, jobId);
    await ctx.db.patch("screeningResults", result._id, { ...scored, counted });
    await ctx.db.patch("screeningJobProgress", progress._id, withDeltas(progress, job, [delta]));
    // Saved again even if it was saved before: the person may have removed it since.
    await shelve(ctx, job, { ...result, ...scored }, move);
    return { outcome };
  },
});
export const answer = userMutation(answerAction);
export const answerForAssistant = assistantMutation(answerAction);
