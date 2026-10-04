/**
 * A screening job's papers as its page reads and changes them: a page of one outcome at a
 * time, and one answer changed by hand, which the paper's score, stars and outcome follow.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { stream } from "convex-helpers/server/stream";
import { createError } from "../lib/errors";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, reversedBy, userMutation, userQuery } from "../lib/userActions";
import { answerAt, answerPaper, paperAnswers, restoreAnswer, restoreModelAnswer } from "../research/answers";
import schema from "../schema";
import { account, answersNow, jobAnswers, shown, stood, withDeltas } from "./accounting";
import { progressOf, shelve, withMoved } from "./bookkeeping";
import { moveResultAnswers } from "./drain";
import { screeningJobPaperValidator, screeningOutcomeValidator } from "./validators";

/** Papers one page holds at most; each also reads its answers. */
const PAGE_MAX = 50;
/** Bytes of results one page reads: a result holds its paper's abstract. */
const PAGE_BYTES = 4 * 1024 * 1024;

/** A paper as a job's list shows it. */
async function paperOf(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, result: Doc<"screeningResults">, outcome: Infer<typeof screeningOutcomeValidator>) {
  return {
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
    answers: await shown(ctx, job, result),
  };
}

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
    return { ...page, page: await Promise.all(page.page.map((result) => paperOf(ctx, job, result, outcome))) };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const getAction = defineUserQuery({
  path: "screening/papers:get",
  description: "One screened paper of one of the person's screening jobs, as the job's list shows it: where it landed, its score, stars and the answer to every question it was scored on.",
  args: { jobId: v.id("screeningJobs"), paperId: v.string() },
  returns: v.union(v.null(), screeningJobPaperValidator),
  run: async (ctx, userId, { jobId, paperId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.userId !== userId) return null;
    const result = await ctx.db.query("screeningResults").withIndex("by_job_openalexId", (q) => q.eq("jobId", jobId).eq("openalexId", paperId)).unique();
    return result?.outcome ? await paperOf(ctx, job, result, result.outcome) : null;
  },
});
export const get = userQuery(getAction);
export const getForAssistant = assistantQuery(getAction);

const answerOf = { jobId: v.id("screeningJobs"), paperId: v.string(), questionKey: v.string() };
/** The answer as it was at a version of the screening's answers: how an undo puts one back, with who set it. */
const asItWas = v.object({ asOf: v.number() });
/** An answer as a change left it: what it is and when it was set. An undo is refused once either differs. */
const answerAsLeft = v.object({ answer: v.union(v.boolean(), v.null()), at: v.number() });

export const answerAction = defineUserMutation({
  path: "screening/papers:answer",
  description:
    "Changes one answer of a screened paper in one of the person's screening jobs: yes (true), no (false) or unclear (null), \"model\" to put back the model's own answer, or { asOf } to put it back as it was at that version of the screening's answers, with who set it. " +
    "The paper's score, stars and outcome follow, and a paper that becomes included is saved the way the job saves included papers. " +
    "A change returns `undo`: the action to run and the arguments to run it with to put the answer back. It is refused if the answer changed again in between.",
  args: { ...answerOf, answer: v.union(v.boolean(), v.null(), v.literal("model"), asItWas), expect: v.optional(answerAsLeft) },
  returns: v.object({ outcome: screeningOutcomeValidator, undo: reversedBy("screening/papers:answer", { ...answerOf, answer: asItWas, expect: answerAsLeft }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { jobId, paperId, questionKey, answer, expect }, author) => {
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

    // The change goes to the job's screening, which a job on a search shares with the search's page.
    const now = Date.now();
    // The model's own answer is the one this job got, even if the screening has lost it since.
    const original = answer === "model" ? ((await jobAnswers(ctx, job, result))?.[questionKey] ?? null) : null;
    const screening = (await ctx.db.get("screenings", screeningId))!;
    const stands = async () => (await paperAnswers(ctx, (await ctx.db.get("screenings", screeningId))!, paperId)).find((value) => value.question === question.question);
    const kept = await stands();
    if (expect && (kept?.answer !== expect.answer || kept.updatedAt !== expect.at)) throw createError("CONFLICT", "This answer has changed since then, so it was left as it is.");
    // The history's copy of the answer as it stands, which is what an undo goes back to.
    const recorded = await answerAt(ctx, screening, paperId, question.question, screening.version);
    if (answer !== null && typeof answer === "object") {
      if (!(await restoreAnswer(ctx, screeningId, paperId, question.question, answer.asOf, now))) throw createError("NOT_FOUND", "This answer has no such version to go back to.");
    } else if (answer === "model") {
      // Cleared from the screening since: the model's answer goes back in before it's restored.
      if (!kept?.model && kept?.setBy !== "model") await answerPaper(ctx, screeningId, paperId, [{ question: question.question, response: original }], "model", now);
      await restoreModelAnswer(ctx, screeningId, paperId, question.question, now);
    } else {
      await answerPaper(ctx, screeningId, paperId, [{ question: question.question, response: answer }], author === "assistant" ? "assistant" : "person", now);
    }
    const left = await stands();
    const bySomeone = (value: typeof kept) => value?.setBy === "person" || value?.setBy === "assistant";
    // What the job's own record of the answer becomes: the answer given, the model's own, or the one put back.
    const mine = answer !== null && typeof answer === "object" ? { answer: left?.answer ?? null, changed: bySomeone(left) }
      : answer === "model" ? { answer: original, changed: false }
      : { answer, changed: true };

    // A counted paper keeps the answers it was scored on, with this one changed; one not
    // counted yet, or counted before papers kept theirs, is scored on its answers as they stand.
    const was = result.counted?.answers;
    const scoredOn = was
      ? { answers: { ...was, [questionKey]: mine.answer }, changed: [...(result.counted?.changed ?? []).filter((key) => key !== questionKey), ...(mine.changed ? [questionKey] : [])] }
      : stood(await answersNow(ctx, job, result));

    const { patch: { counted, ...scored }, delta, move } = account(job, result, scoredOn);
    const outcome = scored.outcome;

    // What puts it back: the answer as the history has it from before this change, with who set
    // it. None where nothing changed or the history has no copy of what stood. None where the
    // job's own record of the answer differed from the screening's, as it does once the
    // search's page changes the answer after the job counted the paper: one step can't put
    // both back. And none where the change, or its undo, moves the paper in or out of what
    // the job saves or prunes: an answer put back doesn't put the library back.
    const agreed = !was || ((was[questionKey] ?? null) === kept?.answer && (result.counted?.changed ?? []).includes(questionKey) === bySomeone(kept));
    const [wasQualified, wasExcluded] = [(result.counted?.qualified ?? result.qualified) === true, (result.counted?.outcome ?? result.outcome) === "excluded"];
    const shelves = (!job.unsaved && wasQualified !== scored.qualified)
      || (job.prune === true && job.set?.kind === "collection" && (wasQualified !== scored.qualified || wasExcluded !== (outcome === "excluded")));
    // An undo that would itself move the paper is refused, which takes back everything above:
    // the paper's place changed after the answer did, and saving it again would write over its rating.
    if (expect && shelves) throw createError("CONFLICT", "Putting this answer back would move the paper in or out of what the screening saves, so it was left as it is.");
    const changed = kept && left && (kept.answer !== left.answer || kept.setBy !== left.setBy || kept.updatedAt !== left.updatedAt);
    const undo = changed && agreed && !shelves && recorded?.answer === kept.answer && recorded.setBy === kept.setBy && recorded.updatedAt === kept.updatedAt
      ? { undo: { path: "screening/papers:answer" as const, args: { jobId, paperId, questionKey, answer: { asOf: screening.version }, expect: { answer: left.answer, at: left.updatedAt } } } }
      : {};
    // A paper the bookkeeping worker hasn't reached is counted there, on its answers as they stand then.
    if (result.doneAt !== undefined) {
      await ctx.db.patch("screeningResults", result._id, scored);
      return { outcome, ...undo };
    }
    const progress = await progressOf(ctx, jobId);
    await ctx.db.patch("screeningResults", result._id, { ...scored, counted });
    // Saved again even if it was saved before: the person may have removed it since.
    const moved = await shelve(ctx, job, { ...result, ...scored }, move);
    await ctx.db.patch("screeningJobProgress", progress._id, { ...withDeltas(progress, job, [delta]), ...withMoved(progress, moved) });
    return { outcome, ...undo };
  },
});
export const answer = userMutation(answerAction);
export const answerForAssistant = assistantMutation(answerAction);
