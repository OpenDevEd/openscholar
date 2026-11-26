import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { internalMutation } from "../lib/functions";
import { defaultStars, shortOf, type Answer } from "../../lib/screening/rules";
import { bookkeepLater } from "../screening/bookkeeping";
import { doiKeyOf, titleKeyOf } from "../screening/gathering";

/**
 * Brings the screenings from before a screening had reviewers into that shape (plans/screening-reviewers): the model
 * that ran each becomes its one reviewer, with a vote on every paper it read that holds its answers, and each paper
 * keeps the result it had (`kept`, which the bookkeeping worker reads until someone votes on the paper or asks for
 * its settled papers to be checked again). Its questions become its criteria, with their points and stars, and the
 * set it read its one source. It is finished, as it was, and can be reopened. One still running is left for a later
 * run. Safe to run again: a screening that has reviewers is passed over.
 *
 *   npx convex run migrations/screeningReviewers:run '{"dryRun": true}'
 *   npx convex run migrations/screeningReviewers:run
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** Papers one step brings over: each is a vote made and a paper patched. */
const STEP = 100;
const KEPT = { included: "include", unclear: "maybe", excluded: "exclude" } as const;
const answerOf = (value: boolean | null): Answer => (value === true ? "yes" : value === false ? "no" : "unclear");

/** The screening itself: its criteria, its rule, its one reviewer, its source and the look that brought its papers. Its papers follow a step at a time. */
async function bring(ctx: MutationCtx, job: Doc<"screeningJobs">) {
  const rules = new Map(job.scoringConfig.rules.map((rule) => [rule.questionKey, rule]));
  const criteria = job.questions.map(({ key, question }) => {
    const rule = rules.get(key);
    return { key, text: question, short: shortOf(question), must: rule?.required === true, terms: [], points: { yes: rule?.yesPoints ?? 1, no: rule?.noPoints ?? 0, unclear: rule?.nullPoints ?? 0 }, addedAt: job.createdAt };
  });
  const thresholds = [1, 2, 3, 4, 5].map((stars) => job.scoringConfig.starThresholds.find((one) => one.stars === stars)?.minScore);
  const stars = thresholds.every((one): one is number => one !== undefined) ? thresholds : defaultStars(criteria.length);
  const ended = job.completedAt ?? job.updatedAt;
  const model = job.serverModelId ? await ctx.db.get("models", job.serverModelId) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
  const reviewerId = await ctx.db.insert("screeningReviewers", { jobId: job._id, kind: "model", ...(model ? { modelId: model._id } : {}), ...(job.serverEffort ? { effort: job.serverEffort } : {}), addedAt: job.createdAt, addedBy: job.createdBy, dealt: 0 });
  const sourceId = job.set
    ? await ctx.db.insert("screeningSources", { jobId: job._id, set: job.set, name: job.label ?? job.name ?? "Papers", ...(job.first === undefined ? {} : { first: job.first }), ...(job.last === undefined ? {} : { last: job.last }), addedAt: job.createdAt, addedBy: job.createdBy, state: "done", read: job.totalPapers, taken: job.totalPapers, duplicates: 0, left: 0, total: job.totalPapers, checkedAt: ended })
    : undefined;
  const checkId = await ctx.db.insert("screeningChecks", { jobId: job._id, at: job.createdAt, by: job.createdBy, state: "done", from: 0, found: job.totalPapers, added: job.totalPapers, beat: ended, endedAt: ended });
  await ctx.db.patch("screeningJobs", job._id, {
    shape: 2,
    name: job.name ?? job.label ?? "Screening",
    criteria,
    stars,
    // The model's vote alone settled a paper, and still does. Conflicts, should people join and split, go to whoever ran it.
    rule: { each: 0, settle: "one", resolver: job.createdBy, blind: "after" },
    status: "completed",
    finishedAt: ended,
    activeAt: job.updatedAt,
    reading: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.migrations.screeningReviewers.papers, { jobId: job._id, reviewerId, checkId, ...(sourceId ? { sourceId } : {}), cursor: null, place: 0 });
}

/** A step of a screening's papers: each gets its place, its source and the result it keeps, and the model's vote on it. */
export const papers = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), checkId: v.id("screeningChecks"), sourceId: v.optional(v.id("screeningSources")), cursor: v.union(v.string(), v.null()), place: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId, checkId, sourceId, cursor, place }) => {
    const page = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).paginate({ cursor, numItems: STEP });
    let made = 0;
    for (const [at, paper] of page.page.entries()) {
      // A step run twice, after a retry, passes over what it brought the first time.
      if (paper.place !== undefined) continue;
      // What it was scored on: the model's answers, with whatever a person or the assistant changed among them.
      const given = paper.counted?.answers ?? paper.answers;
      const read = paper.status === "completed" && given !== undefined;
      const kept = paper.outcome && paper.outcome !== "failed" ? KEPT[paper.outcome] : undefined;
      await ctx.db.insert("screeningVotes", {
        jobId,
        resultId: paper._id,
        reviewerId,
        place: place + at,
        status: read ? "cast" : paper.status === "failed" ? "failed" : "waiting",
        ...(read ? { answers: Object.fromEntries(Object.entries(given).map(([key, value]) => [key, answerOf(value)])), ...(paper.confidences ? { confidences: paper.confidences } : {}), at: paper.completedAt ?? paper.createdAt } : {}),
        ...(paper.creditsUsed ? { credits: paper.creditsUsed } : {}),
      });
      made++;
      await ctx.db.patch("screeningResults", paper._id, {
        place: place + at,
        checkId,
        ...(sourceId ? { sourceId } : {}),
        ...(kept ? { kept } : {}),
        titleKey: titleKeyOf(paper.title, paper.publicationYear),
        ...(doiKeyOf(paper.doi) ? { doiKey: doiKeyOf(paper.doi) } : {}),
        // Stamped for the bookkeeping worker, which counts it where it stands.
        doneAt: ctx.db.vars.commitTs,
      });
    }
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer && made) await ctx.db.patch("screeningReviewers", reviewerId, { dealt: reviewer.dealt + made });
    if (made) await bookkeepLater(ctx);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.screeningReviewers.papers, { jobId, reviewerId, checkId, ...(sourceId ? { sourceId } : {}), cursor: page.continueCursor, place: place + page.page.length });
    return null;
  },
});

export const screenings = migrations.define({
  table: "screeningJobs",
  migrateOne: async (ctx, job) => {
    if (job.shape === 2 || job.status === "processing") return;
    await bring(ctx, job);
  },
});

export const run = migrations.runner(internal.migrations.screeningReviewers.screenings);
/** One screening by its ID, for a rehearsal on a single one. */
export const one = internalMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (job && job.shape !== 2 && job.status !== "processing") await bring(ctx, job);
    return null;
  },
});
