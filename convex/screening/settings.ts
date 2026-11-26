/**
 * Changing a running screening (plans/screening-reviewers): its name, criteria, rule, sources, reviewers, schedule
 * and where its included papers go, in one save. A change applies from now on: the papers that were settled keep
 * their result, unless the save asks for them to be checked again. What the save would do is counted first, for the
 * same change, by ./effects.ts.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { newCollection } from "../library/collections";
import { workspaceMutation } from "../lib/userActions";
import { actorIn } from "../workspaces/actor";
import type { Criterion } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { bookkeepLater, saveQualified } from "./bookkeeping";
import { dealable, modelRow, nameOf, readingModel, reviewersOf, sourcesOf, touched, votesOf } from "./dealing";
import { startCheck } from "./gathering";
import { check } from "./living";
import { logChange, type Line } from "./log";
import { destination } from "./mutations";
import { addModel, addPerson, takeOff } from "./reviewers";
import { addSource, criteriaFrom, criterionInput, EVERY_MS, legacyOf, MAX_SOURCES, modelInput, NEEDS_CRITERIA, ruleInput, sourceInput, starsFrom } from "./screenings";
import { startWaitingVotes } from "./slots";
import { everyValidator, prunable, saveToValidator, SCREENING_TEXT } from "./validators";

/** What one save changes: only the parts named are touched. */
export const changeValidator = v.object({
  name: v.optional(v.string()),
  question: v.optional(v.string()),
  criteria: v.optional(v.array(criterionInput)),
  stars: v.optional(v.array(v.number())),
  rule: v.optional(ruleInput),
  // How often it looks in its sources again, or null to stop.
  living: v.optional(v.union(everyValidator, v.null())),
  saveTo: v.optional(saveToValidator),
  prune: v.optional(v.boolean()),
  addSources: v.optional(v.array(sourceInput)),
  removeSources: v.optional(v.array(v.id("screeningSources"))),
  // Which of a source's papers are taken, counting from 1; all of them without a range. A wider range brings the papers it adds.
  ranges: v.optional(v.array(v.object({ sourceId: v.id("screeningSources"), first: v.optional(v.number()), last: v.optional(v.number()) }))),
  addPeople: v.optional(v.array(v.id("users"))),
  addModels: v.optional(v.array(modelInput)),
  remove: v.optional(v.array(v.object({ reviewerId: v.id("screeningReviewers"), discard: v.optional(v.boolean()) }))),
  // The settled papers are checked again under the settings as the save leaves them, and none keeps its result for having had it.
  recheck: v.optional(v.boolean()),
});
export type Change = Infer<typeof changeValidator>;

/**
 * A screening's settings as a change would leave them, checked as a save checks them, with what the change does to who
 * is on it. Nothing is written: the save and the preview both start from this.
 */
export async function planned(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, change: Change) {
  const reviewers = await reviewersOf(ctx, job._id);
  const before = job.criteria ?? [];
  const criteria = change.criteria ? criteriaFrom(change.criteria, before) : before;
  const stars = change.criteria || change.stars ? starsFrom(change.stars ?? (job.stars?.length === 5 ? job.stars : undefined), criteria.length) : (job.stars ?? []);
  const leaving = (change.remove ?? []).flatMap(({ reviewerId, discard }) => { const reviewer = reviewers.find((one) => one._id === reviewerId && one.left === undefined); return reviewer ? [{ reviewer, discard: discard === true }] : []; });
  const gone = new Set(leaving.map(({ reviewer }) => reviewer._id));
  if (!criteria.length && (change.addModels?.length || reviewers.some((one) => readingModel(one) && !gone.has(one._id)))) throw createError("VALIDATION_ERROR", NEEDS_CRITERIA);
  const staying = reviewers.filter((one) => !gone.has(one._id));
  const people = staying.filter(dealable);
  // Each person who joins, with how many people there were before them: what their even share is counted from.
  const joining = [...new Set(change.addPeople ?? [])].filter((userId) => !people.some((one) => one.userId === userId)).map((userId, at) => ({ userId, before: people.length + at }));
  const rule = { ...job.rule!, ...(change.rule ? { each: change.rule.each === "all" ? ("all" as const) : Math.max(0, Math.floor(change.rule.each)), settle: change.rule.settle, blind: change.rule.blind, ...(change.rule.resolver ? { resolver: change.rule.resolver } : {}) } : {}) };
  // Conflicts always have someone to settle them: when that person is taken off, they go to whoever started the screening, or failing that the first person still on it.
  const resolverLeft = leaving.some(({ reviewer }) => reviewer.kind === "person" && reviewer.userId === rule.resolver) && !change.rule?.resolver;
  const settles = resolverLeft ? ((people.find((one) => one.userId === job.createdBy) ?? people[0])?.userId ?? job.createdBy) : rule.resolver;
  const was = new Map(before.map((criterion) => [criterion.key, criterion]));
  const keys = new Set(criteria.map((criterion) => criterion.key));
  return {
    reviewers,
    criteria,
    stars,
    rule: { ...rule, resolver: settles },
    leaving,
    joining,
    models: change.addModels ?? [],
    // Criteria the change adds, drops, and turns into must-haves: what the models answer again, and whose votes are marked for a new one.
    added: criteria.filter((criterion) => !was.has(criterion.key)),
    dropped: before.filter((criterion) => !keys.has(criterion.key)),
    stricter: criteria.filter((criterion) => criterion.must && was.get(criterion.key)?.must === false).map((criterion) => criterion.key),
    // Whether the change touches what decides where a paper stands: its papers, its criteria, who is on it and its rule.
    decides: Boolean(change.addSources?.length || change.removeSources?.length || change.ranges?.length || leaving.length || joining.length || change.addModels?.length || rule.each !== job.rule!.each || rule.settle !== job.rule!.settle || settling(criteria) !== settling(before)),
  };
}
/** What of its criteria decides a model's vote: which there are, and which a paper must meet. */
const settling = (criteria: Criterion[]) => criteria.map((criterion) => `${criterion.key}:${criterion.must}`).join();

/** The parts of the settings a change touches, as the activity names them. */
const partsOf = (change: Change) => [
  ...(change.name !== undefined ? ["name"] : []),
  ...(change.question !== undefined ? ["question"] : []),
  ...(change.addSources?.length || change.removeSources?.length || change.ranges?.length ? ["papers"] : []),
  ...(change.living !== undefined ? ["new-papers"] : []),
  ...(change.criteria || change.stars ? ["criteria"] : []),
  ...(change.addPeople?.length || change.addModels?.length || change.remove?.length ? ["reviewers"] : []),
  ...(change.rule ? ["decided"] : []),
  ...(change.saveTo || change.prune !== undefined ? ["goes-to"] : []),
];

/**
 * Changes one of the workspace's screenings in one save: its name and research question, its criteria (the whole
 * list as it should be, each kept by its `key`), the points and stars, the rule that settles a paper, how often it
 * looks for new papers, where included papers go, sources added or taken out and which of a source's papers are
 * taken, and reviewers added (members of the workspace, or AI models) or taken off (`discard` throws their votes
 * out). Only the parts named change. A change applies from now on: votes that were cast stay, and papers that were
 * settled keep their result unless `recheck` asks for them to be checked again. Models read what the change gives
 * them, paid from the workspace's credits a paper at a time.
 */
export const save = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), change: changeValidator },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, change }) => {
    const job = await requireMember(ctx, actor, jobId);
    const plan = await planned(ctx, job, change);
    const now = Date.now();
    const name = change.name?.trim();
    if (change.name !== undefined && (!name || name.length > SCREENING_TEXT.name)) throw createError("VALIDATION_ERROR", "Give the screening a name of up to 200 characters.");
    if ((change.question?.length ?? 0) > SCREENING_TEXT.question) throw createError("VALIDATION_ERROR", "That research question is too long.");
    const settles = await ctx.db.get("users", plan.rule.resolver);
    if (!settles || !((await actorIn(ctx, settles, job.workspaceId)) || plan.reviewers.some((one) => one.userId === settles._id && one.left === undefined))) throw createError("VALIDATION_ERROR", "Conflicts are settled by someone on this screening.");
    const sources = await sourcesOf(ctx, jobId);
    if (sources.filter((one) => one.removedAt === undefined && !change.removeSources?.includes(one._id)).length + (change.addSources?.length ?? 0) > MAX_SOURCES) throw createError("VALIDATION_ERROR", `A screening reads up to ${MAX_SOURCES} sources.`);
    const writer = { userId: actor.userId, workspaceId: job.workspaceId };
    const later = change.saveTo?.kind === "new" ? change.saveTo.name.trim() : undefined;
    if (change.saveTo?.kind === "libraryCollection" || change.saveTo?.kind === "newLibraryCollection") throw createError("VALIDATION_ERROR", "Send its papers to a community's collection when you start a screening.");
    const prune = change.prune ?? job.prune === true;
    if (prune && !sources.some((source) => source.removedAt === undefined && prunable(source.set.kind === "upload" || source.set.kind === "pdf" || source.set.kind === "dois" ? undefined : source.set))) throw createError("VALIDATION_ERROR", "Only a collection's papers can leave it.");

    // Settled papers keep their result from here on, unless this save checks them again: said before any paper is stamped, so the worker holds them.
    await ctx.db.patch("screeningJobs", jobId, {
      ...(name ? { name } : {}),
      ...(change.question !== undefined ? { question: change.question.trim() || undefined } : {}),
      ...(change.criteria || change.stars ? { criteria: plan.criteria, stars: plan.stars, ...legacyOf(plan.criteria, plan.stars) } : {}),
      rule: plan.rule,
      ...(change.living !== undefined ? { living: change.living ? { every: change.living, next: now + EVERY_MS[change.living] } : undefined } : {}),
      ...(change.saveTo ? { targetCollectionId: undefined, newCollection: undefined, unsaved: undefined, ...(later ? { newCollection: later } : await destination(ctx, writer, change.saveTo)) } : {}),
      ...(change.prune !== undefined ? { prune: change.prune ? (true as const) : undefined } : {}),
      ...(plan.decides && !change.recheck ? { heldAt: now } : {}),
      ...touched(now),
    });
    const saved = (await ctx.db.get("screeningJobs", jobId))!;

    for (const { reviewer, discard } of plan.leaving) await takeOff(ctx, saved, reviewer, discard);
    for (const { userId } of plan.joining) {
      const person = await ctx.db.get("users", userId);
      if (person?.state !== "active" || !(await actorIn(ctx, person, job.workspaceId))) throw createError("VALIDATION_ERROR", "Only members of this workspace are added here. Share the screening with anyone else.");
      await addPerson(ctx, saved, userId, actor.userId);
    }
    for (const model of plan.models) await addModel(ctx, saved, model, actor.userId);

    for (const sourceId of change.removeSources ?? []) {
      const source = sources.find((one) => one._id === sourceId && one.removedAt === undefined);
      if (!source) continue;
      await ctx.db.patch("screeningSources", sourceId, { removedAt: now });
      await ctx.scheduler.runAfter(0, internal.screening.settings.withdraw, { jobId, sourceId, cursor: null });
    }
    // A range that takes more of a source reads the source again: what it has stays, and the rest joins.
    for (const range of change.ranges ?? []) {
      const source = sources.find((one) => one._id === range.sourceId && one.removedAt === undefined);
      if (source) await ctx.db.patch("screeningSources", source._id, { first: range.first, last: range.last, state: "waiting", read: 0, resume: undefined, snapshot: undefined, failure: undefined, duplicates: 0, left: 0, bare: 0 });
    }
    for (const source of change.addSources ?? []) await addSource(ctx, jobId, actor.userId, source, now);
    // New papers arrive by a look in its sources: the ones just added or widened are read, and a screening made living looks in the others too.
    const reads = Boolean(change.addSources?.length || change.ranges?.length);
    if (change.living && !job.living && !reads) await check(ctx, saved, actor.userId);
    else if (reads && !(await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", jobId).eq("state", "running")).first())) await startCheck(ctx, saved, actor.userId, saved.totalPapers);

    // What follows on its papers, a step at a time: the open ones are settled again under the new settings, with people's votes marked where a criterion became a must-have and the models reading again where one was added.
    if (plan.decides || change.recheck || plan.added.length || plan.stricter.length || change.stars) {
      await ctx.scheduler.runAfter(0, internal.screening.settings.follow, { jobId, cursor: null, results: change.recheck ? ["waiting", "conflict", "include", "maybe", "exclude"] : change.stars && !plan.decides ? ["include", "maybe", "exclude", "waiting", "conflict"] : ["waiting", "conflict"], recheck: change.recheck === true, stricter: plan.stricter, reread: plan.added.length > 0 });
    }
    // The papers it has included go to a collection it is newly sent to.
    if (change.saveTo && change.saveTo.kind !== "none") await ctx.scheduler.runAfter(0, internal.screening.settings.shelveIncluded, { jobId, cursor: null });

    const more: Line[] = [
      ...partsOf(change).map((part) => ({ code: "part", detail: part })),
      ...(change.recheck ? [{ code: "rechecked" }] : []),
      ...(await Promise.all(plan.joining.map(async ({ userId }) => { const user = await ctx.db.get("users", userId); return { code: "joinedBy", detail: nameOf(user) }; }))),
      ...plan.leaving.flatMap(({ discard }) => (discard ? [{ code: "votesDiscarded" }] : [])),
    ];
    await logChange(ctx, actor, job, "settings", { more });
    return null;
  },
});

/** Papers one step of what follows a save handles. */
const FOLLOW = 100;
const resultValidator = v.union(v.literal("waiting"), v.literal("conflict"), v.literal("include"), v.literal("maybe"), v.literal("exclude"));

/**
 * What a save does to a screening's papers, a step at a time: each paper of the results it names is stamped for the
 * bookkeeping worker, which settles it under the settings as they are now. With `recheck`, a settled paper lets go of
 * its result first. Where a criterion became a must-have, the votes people cast on the papers still open are marked
 * for a new one, unless they exclude already. Where a criterion was added, the models that read an open paper read it
 * again, to answer it.
 */
export const follow = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()), results: v.array(resultValidator), recheck: v.boolean(), stricter: v.array(v.string()), reread: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor, results, recheck, stricter, reread }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    const result = results[0];
    if (!job || !result) return null;
    const open = result === "waiting" || result === "conflict";
    const reviewers = new Map((await reviewersOf(ctx, jobId)).map((one) => [one._id, one]));
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: FOLLOW });
    let queued = 0;
    for (const paper of page.page) {
      if (open && (stricter.length || reread)) {
        for (const vote of await votesOf(ctx, paper._id)) {
          const reviewer = reviewers.get(vote.reviewerId);
          if (vote.status !== "cast" || !reviewer) continue;
          if (reviewer.kind === "person" && stricter.length && vote.decision !== "exclude" && !vote.flagged) await ctx.db.patch("screeningVotes", vote._id, { flagged: true });
          if (reviewer.kind === "model" && reread && readingModel(reviewer)) {
            await ctx.db.patch("screeningVotes", vote._id, { ...modelRow(job, paper, reviewer), decision: undefined, answers: undefined, confidences: undefined, passages: undefined, reason: undefined, at: undefined });
            queued++;
          }
        }
      }
      await ctx.db.patch("screeningResults", paper._id, { doneAt: ctx.db.vars.commitTs, ...(recheck ? { reopen: "recheck" as const } : {}) });
    }
    if (queued) await startWaitingVotes(ctx, job.workspaceId);
    if (page.page.length) await bookkeepLater(ctx);
    // A paper that leaves a result as it is settled again shifts the range it was read from: the worker moves papers between results only after this step, so the cursor holds.
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.settings.follow, { jobId, cursor: page.continueCursor, results, recheck, stricter, reread });
    else if (results.length > 1) await ctx.scheduler.runAfter(0, internal.screening.settings.follow, { jobId, cursor: null, results: results.slice(1), recheck, stricter, reread });
    return null;
  },
});

/** Takes a removed source's papers out of the screening, a step at a time: each is stamped, and the worker takes it out of the counts and keeps its votes on record. */
export const withdraw = internalMutation({
  args: { jobId: v.id("screeningJobs"), sourceId: v.id("screeningSources"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, sourceId, cursor }) => {
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_source", (q) => q.eq("jobId", jobId).eq("sourceId", sourceId)).paginate({ cursor, numItems: FOLLOW });
    for (const paper of page.page) if (!paper.withdrawn) await ctx.db.patch("screeningResults", paper._id, { withdrawn: true, doneAt: ctx.db.vars.commitTs });
    if (page.page.length) await bookkeepLater(ctx);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.settings.withdraw, { jobId, sourceId, cursor: page.continueCursor });
    return null;
  },
});

/** Saves the papers a screening has included to the collection it was just sent to, a step at a time. */
export const shelveIncluded = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor }) => {
    let job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.unsaved) return null;
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", "include")).paginate({ cursor, numItems: SHELVE });
    if (page.page.length && job.newCollection && !job.targetCollectionId) {
      const targetCollectionId = await newCollection(ctx, { userId: job.createdBy, workspaceId: job.workspaceId }, job.newCollection);
      await ctx.db.patch("screeningJobs", jobId, { targetCollectionId, newCollection: undefined });
      job = { ...job, targetCollectionId, newCollection: undefined };
    }
    for (const paper of page.page) await saveQualified(ctx, job, paper);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.settings.shelveIncluded, { jobId, cursor: page.continueCursor });
    return null;
  },
});
/** Papers one step of that saves: each is a library item and a membership, a few dozen reads. */
const SHELVE = 40;

