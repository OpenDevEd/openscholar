/**
 * A screening job's papers as its page reads and changes them: a page of one outcome at a
 * time, and one answer changed by hand, which the paper's score, stars and outcome follow.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { answerPaper, paperAnswers, restoreModelAnswer } from "../research/answers";
import schema from "../schema";
import { progressRow, saveQualified } from "./bookkeeping";
import { moveResultAnswers } from "./drain";
import { outcomeOf, scorePaper, tallied } from "./scoring";
import { screeningJobPaperValidator, screeningOutcomeValidator } from "./validators";

/** Papers one page holds at most; each also reads its answers. */
const PAGE_MAX = 50;
/** Bytes of results one page reads: a result holds its paper's abstract. */
const PAGE_BYTES = 4 * 1024 * 1024;

type Answer = { key: string; answer: boolean | null; changed: boolean; confidence?: number };

/**
 * A paper's answer to each of the job's questions as it stands now: still on its result
 * while it waits to move to the job's screening, in the screening's rows after.
 */
async function answersNow(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, result: Doc<"screeningResults">): Promise<Answer[]> {
  const held = result.answers;
  if (held) {
    return job.questions.map(({ key }) => ({ key, answer: held[key] ?? null, changed: false, ...(result.confidences?.[key] === undefined ? {} : { confidence: result.confidences[key] }) }));
  }
  const screening = job.screeningId ? await ctx.db.get("screenings", job.screeningId) : null;
  const answers = screening ? await paperAnswers(ctx, screening, result.openalexId) : [];
  return job.questions.map(({ key, question }) => {
    const given = answers.find((value) => value.question === question);
    return {
      key,
      answer: given?.answer ?? null,
      changed: given?.setBy === "person" || given?.setBy === "assistant",
      ...(given?.model?.confidence === undefined ? {} : { confidence: given.model.confidence }),
    };
  });
}

export const listAction = defineUserQuery({
  path: "screening/papers:list",
  description:
    "Lists the papers of one of the person's screening jobs that landed in one outcome (included, unclear, excluded or failed), a page at a time in the order the job took them, " +
    "each with its score, stars and its answer to every question as it stands now. Given `text`, only papers whose title or authors contain it.",
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
    const answers = await Promise.all(page.page.map((result) => answersNow(ctx, job, result)));
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
    if (!job.screeningId) throw createError("VALIDATION_ERROR", "This screening kept no answers to change");

    const keys = job.questions.map((q) => q.key);
    const byKey = (answers: Answer[]) => Object.fromEntries(answers.map((value) => [value.key, value.answer]));
    const before = byKey(await answersNow(ctx, job, result));
    const now = Date.now();
    if (answer === "model") await restoreModelAnswer(ctx, job.screeningId, paperId, question.question, now);
    else await answerPaper(ctx, job.screeningId, paperId, [{ question: question.question, response: answer }], author === "assistant" ? "assistant" : "person", now);
    const after = byKey(await answersNow(ctx, job, result));

    const scored = scorePaper(after, job.scoringConfig);
    const outcome = outcomeOf(after, job.scoringConfig);
    await ctx.db.patch("screeningResults", result._id, { ...scored, outcome });
    const progress = await progressRow(ctx, jobId);
    if (progress) {
      await ctx.db.patch("screeningJobProgress", progress._id, {
        qualified: Math.max(0, progress.qualified + Number(scored.qualified) - Number(result.qualified === true)),
        // Kept from the moment a job's outcomes are; one from before has neither until migrations/screeningOutcomes.
        ...(progress.unclear === undefined ? {} : { unclear: Math.max(0, progress.unclear + Number(outcome === "unclear") - Number(result.outcome === "unclear")) }),
        ...(progress.tallies === undefined ? {} : { tallies: tallied(tallied(progress.tallies, keys, before, -1), keys, after, 1) }),
      });
    }
    if (scored.qualified && !result.libraryItemId) await saveQualified(ctx, job, { ...result, stars: scored.stars });
    return { outcome };
  },
});
export const answer = userMutation(answerAction);
export const answerForAssistant = assistantMutation(answerAction);
