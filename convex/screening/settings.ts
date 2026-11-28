/**
 * Changing a running screening (plans/screening-reviewers): its name, criteria, rule, sources, reviewers, schedule
 * and where its included papers go, in one save. A change applies from now on: the papers that were settled keep
 * their result, unless the save asks for them to be checked again. What the save would do is counted first, for the
 * same change, by ./effects.ts.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { queueLibraryWrite } from "../evidenceLibraries/writes";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { newCollection, screeningDestination } from "../library/collections";
import { workspaceAction, workspaceMutation } from "../lib/userActions";
import { actorIn } from "../workspaces/actor";
import { type Criterion } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { pdfBand } from "../../lib/pricing/estimate";
import { bookkeepLater, progressRow, saveQualified } from "./bookkeeping";
import { keepVersion, keeperOf, readAgain, dealable, papersAStep, settlerFor, modelRow, nameOf, readingModel, reviewersOf, sourcesOf, touched, votesOf } from "./dealing";
import { startCheck } from "./checks";
import { check } from "./living";
import { logChange, type Line } from "./log";
import { addModel, addPerson, takeOff } from "./reviewers";
import { addSource, criteriaFrom, criterionInput, EVERY_MS, legacyOf, MAX_SOURCES, modelInput, NEEDS_CRITERIA, ruleFrom, ruleInput, sourceInput, starsFrom } from "./screenings";
import { startWaitingVotes } from "./slots";
import { everyValidator, libraryDestinationValidator, prunable, RETIRED_CRITERIA, saveToValidator, SCREENING_TEXT } from "./validators";

/** The criteria taken off by a save, kept by key and name with the ones taken off before: a criterion put back is no longer one of them. */
const retiredOf = (job: Doc<"screeningJobs">, criteria: Array<{ key: string }>) => {
  const kept = new Set(criteria.map((one) => one.key));
  const gone = (job.criteria ?? []).filter((one) => !kept.has(one.key)).map(({ key, text, short, must }) => ({ key, text, short, must }));
  return [...(job.retiredCriteria ?? []).filter((one) => !kept.has(one.key) && !gone.some((now) => now.key === one.key)), ...gone].slice(-RETIRED_CRITERIA);
};

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
  // People invited by email with the save, sent before it (../sharing/invitations.ts): the preview counts them as the rule waits for them.
  inviting: v.optional(v.number()),
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
  if (!criteria.some((criterion) => criterion.must) && (change.addModels?.length || reviewers.some((one) => readingModel(one) && !gone.has(one._id)))) throw createError("VALIDATION_ERROR", NEEDS_CRITERIA);
  const staying = reviewers.filter((one) => !gone.has(one._id));
  const people = staying.filter(dealable);
  // Each person who joins, with how many people there were before them: what their even share is counted from.
  const joining = [...new Set(change.addPeople ?? [])].filter((userId) => !people.some((one) => one.userId === userId)).map((userId, at) => ({ userId, before: people.length + at }));
  const rule = { ...job.rule!, ...(change.rule ? { ...ruleFrom(change.rule), ...(change.rule.resolver ? { resolver: change.rule.resolver } : {}) } : {}) };
  // Conflicts always have someone to settle them: when that person is taken off, they go on by the one rule (./dealing.ts `settlerFor`).
  const resolverLeft = leaving.some(({ reviewer }) => reviewer.kind === "person" && reviewer.userId === rule.resolver) && !change.rule?.resolver;
  const settles = resolverLeft ? await settlerFor(ctx, job, people.flatMap((one) => one.userId ?? []), rule.resolver) : rule.resolver;
  const was = new Map(before.map((criterion) => [criterion.key, criterion]));
  const keys = new Set(criteria.map((criterion) => criterion.key));
  // Whether the change can move a paper the screening already has: who is on it, its rule, or what of its criteria decides. Papers a source adds move none of them.
  const moves = Boolean(leaving.length || joining.length || change.addModels?.length || rule.each !== job.rule!.each || rule.settle !== job.rule!.settle || (rule.models ?? "vote") !== (job.rule!.models ?? "vote") || settling(criteria) !== settling(before));
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
    moves,
    // Whether the change touches what decides where a paper stands: its papers as well.
    decides: moves || Boolean(change.addSources?.length || change.removeSources?.length || change.ranges?.length),
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
  handler: (ctx, actor, { jobId, change }) => apply(ctx, actor, jobId, change),
});

const toCommunity = (saveTo: Change["saveTo"]) => saveTo?.kind === "libraryCollection" || saveTo?.kind === "newLibraryCollection";

/**
 * The same save, where its included papers are sent to a community's collection: one the person changes there, or a
 * new one of theirs, checked or made in the community before anything is saved here.
 */
export const saveToCommunity = workspaceAction({
  args: { jobId: v.id("screeningJobs"), change: changeValidator },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, change }): Promise<null> => {
    const saveTo = change.saveTo;
    if (saveTo?.kind !== "libraryCollection" && saveTo?.kind !== "newLibraryCollection") throw createError("VALIDATION_ERROR", "Pick a community's collection.");
    const libraryDestination = await ctx.runAction(internal.evidenceLibraries.sourceActions.destination, { userId: actor.userId, saveTo });
    await ctx.runMutation(internal.screening.settings.saveSent, { userId: actor.userId, workspaceId: actor.workspaceId, jobId, change, libraryDestination });
    return null;
  },
});
export const saveSent = internalMutation({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), jobId: v.id("screeningJobs"), change: changeValidator, libraryDestination: libraryDestinationValidator },
  returns: v.null(),
  handler: (ctx, { userId, workspaceId, jobId, change, libraryDestination }) => apply(ctx, { userId, workspaceId }, jobId, change, libraryDestination),
});

async function apply(ctx: MutationCtx, actor: { userId: Id<"users">; workspaceId: Id<"workspaces">; author?: "user" | "assistant" }, jobId: Id<"screeningJobs">, change: Change, libraryDestination?: Infer<typeof libraryDestinationValidator>): Promise<null> {
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
  // A community's collection is checked, or made, before the save (`saveToCommunity`).
  if (toCommunity(change.saveTo) !== Boolean(libraryDestination)) throw createError("VALIDATION_ERROR", "Pick the collection its included papers go to again.");
  const prune = change.prune ?? job.prune === true;
  // Checked against the sources as the save leaves them: those it takes out don't count, and those it adds do.
  const canTake = (set: (typeof sources)[number]["set"]) => prunable(set.kind === "upload" || set.kind === "pdf" || set.kind === "dois" ? undefined : set);
  if (prune && !sources.some((source) => source.removedAt === undefined && !change.removeSources?.includes(source._id) && canTake(source.set)) && !(change.addSources ?? []).some((source) => canTake(source.set as (typeof sources)[number]["set"]))) throw createError("VALIDATION_ERROR", "Only a collection's papers can leave it.");

  // Settled papers keep their result from here on, unless this save checks them again: said before any paper is stamped, so the worker holds them.
  await ctx.db.patch("screeningJobs", jobId, {
    ...(name ? { name } : {}),
    ...(change.question !== undefined ? { question: change.question.trim() || undefined } : {}),
    ...(change.criteria || change.stars ? { criteria: plan.criteria, stars: plan.stars, ...legacyOf(plan.criteria, plan.stars), retiredCriteria: retiredOf(job, plan.criteria) } : {}),
    rule: plan.rule,
    ...(change.living !== undefined ? { living: change.living ? { every: change.living, next: now + EVERY_MS[change.living] } : undefined } : {}),
    ...(change.saveTo ? { targetCollectionId: undefined, newCollection: undefined, unsaved: undefined, libraryDestination, ...(later ? { newCollection: later } : await screeningDestination(ctx, writer, change.saveTo)) } : {}),
    ...(change.prune !== undefined ? { prune: change.prune ? (true as const) : undefined } : {}),
    ...(plan.decides && !change.recheck ? { heldAt: now } : {}),
    ...touched(now),
  });
  const saved = (await ctx.db.get("screeningJobs", jobId))!;
  // Set to take excluded papers out of their collections: the ones it already excluded leave them too, as the save said they would.
  if (saved.prune && !job.prune) await ctx.scheduler.runAfter(0, internal.screening.settling.pruneExcluded, { jobId, cursor: null });
  // Someone who no longer settles its conflicts and doesn't review it can't answer the questions put to them as its settler: those go on to whoever settles now.
  const was = job.rule?.resolver;
  if (was && was !== saved.rule?.resolver && !plan.reviewers.some((one) => one.userId === was && one.left === undefined)) await ctx.scheduler.runAfter(0, internal.screening.reviewers.closeQuestions, { jobId, userId: was, ...(saved.rule?.resolver ? { to: saved.rule.resolver } : {}) });
  // A change to its rule or its criteria is a version of them from now on, which the whole record lists.
  if (JSON.stringify(job.rule) !== JSON.stringify(saved.rule) || JSON.stringify(job.criteria ?? []) !== JSON.stringify(saved.criteria ?? [])) await keepVersion(ctx, saved, actor.userId);

  // The settler taken off by this save hands their questions to whoever settles now.
  for (const { reviewer, discard } of plan.leaving) await takeOff(ctx, saved, reviewer, discard, actor.userId, was && reviewer.userId === was && saved.rule?.resolver !== was ? saved.rule?.resolver : undefined);
  for (const { userId } of plan.joining) {
    const person = await ctx.db.get("users", userId);
    if (person?.state !== "active" || !(await actorIn(ctx, person, job.workspaceId))) throw createError("VALIDATION_ERROR", "Only members of this workspace are added here. Share the screening with anyone else.");
    await addPerson(ctx, saved, userId, actor.userId, { tell: true });
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
    if (source) await ctx.db.patch("screeningSources", source._id, { first: range.first, last: range.last, ...readAgain(source) });
  }
  for (const source of change.addSources ?? []) await addSource(ctx, jobId, actor, source, now);
  // New papers arrive by a look in its sources: the ones just added or widened are read, and a screening made living looks in the others too.
  const reads = Boolean(change.addSources?.length || change.ranges?.length);
  // Made living in the same save that adds a source, it looks in every source at once, as it said it would: the added ones are read in that same look.
  const checks = change.living && !job.living ? await check(ctx, saved, actor.userId) : false;
  if (!checks && reads && !(await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", jobId).eq("state", "running")).first())) await startCheck(ctx, saved, actor.userId);

  // What follows on its papers, a step at a time: the open ones are settled again under the new settings, with people's votes marked where a criterion became a must-have and the models reading again where one was added.
  if (plan.decides || change.recheck || plan.added.length || plan.stricter.length || change.stars) {
    await ctx.scheduler.runAfter(0, internal.screening.settings.follow, { jobId, cursor: null, results: change.recheck ? ["waiting", "conflict", "include", "maybe", "exclude"] : change.stars && !plan.decides ? ["include", "maybe", "exclude", "waiting", "conflict"] : ["waiting", "conflict"], recheck: change.recheck === true, stricter: plan.stricter, reread: plan.added.length > 0 });
  }
  // The papers it has included go to a collection it is newly sent to.
  if (change.saveTo && change.saveTo.kind !== "none") await ctx.scheduler.runAfter(0, internal.screening.settings.shelveIncluded, { jobId, cursor: null });

  const more: Line[] = [
    ...partsOf(change).map((part) => ({ code: "part", detail: part })),
    // Every settled paper is checked again: as many as stood settled when it was saved.
    ...(change.recheck ? [{ code: "rechecked", count: ((counts) => (counts?.include ?? 0) + (counts?.maybe ?? 0) + (counts?.exclude ?? 0))((await progressRow(ctx, jobId))?.counts) }] : []),
    ...(await Promise.all(plan.joining.map(async ({ userId }) => { const user = await ctx.db.get("users", userId); return { code: "joinedBy", detail: nameOf(user) }; }))),
    ...plan.leaving.flatMap(({ discard }) => (discard ? [{ code: "votesDiscarded" }] : [])),
  ];
  await logChange(ctx, actor, job, "settings", { more });
  return null;
}

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
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: papersAStep(reviewers.size, FOLLOW) });
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
    const sources = await sourcesOf(ctx, jobId);
    for (const paper of page.page) {
      if (paper.withdrawn) continue;
      // Another source still in the screening holds it too, merged into it: it stays, with its votes, as that source's paper (./dealing.ts `keeperOf`). That source counts it as one it brought, its PDF and the PDF's length with it, and no longer as a duplicate merged; an included paper is counted under it.
      const kept = await keeperOf(ctx, paper._id, new Set([sourceId]), sources);
      if (kept) {
        const { row } = kept;
        // Read again for each paper: an earlier paper of this step may have moved to the same source.
        const keeper = (await ctx.db.get("screeningSources", kept.source._id))!;
        await ctx.db.patch("screeningResults", paper._id, { sourceId: keeper._id, record: undefined, doneAt: ctx.db.vars.commitTs });
        const filed = !paper.abstract && paper.file;
        const band = pdfBand(paper.pages ?? 0);
        const spread = { ...keeper.fileSpread };
        if (filed && paper.pages) spread[band] = { papers: (spread[band]?.papers ?? 0) + 1, pages: (spread[band]?.pages ?? 0) + paper.pages, most: Math.max(spread[band]?.most ?? 0, paper.pages) };
        await ctx.db.patch("screeningSources", keeper._id, { taken: keeper.taken + 1, duplicates: Math.max(0, keeper.duplicates - 1), ...(filed ? { filed: (keeper.filed ?? 0) + 1, filePages: (keeper.filePages ?? 0) + (paper.pages ?? 0), fileSpread: spread } : {}) });
        if (paper.result === "include") await moveIncluded(ctx, jobId, sourceId, keeper._id);
        await ctx.db.delete("screeningMerged", row._id);
        continue;
      }
      await ctx.db.patch("screeningResults", paper._id, { withdrawn: true, doneAt: ctx.db.vars.commitTs });
      // A paper out of the screening asks nobody for a new vote: Vote again counts only papers still in it.
      for (const vote of await votesOf(ctx, paper._id)) if (vote.flagged) await ctx.db.patch("screeningVotes", vote._id, { flagged: undefined });
    }
    if (page.page.length) await bookkeepLater(ctx);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.settings.withdraw, { jobId, sourceId, cursor: page.continueCursor });
    return null;
  },
});

/** An included paper that moved from one source to another is counted under the one it moved to (the Overview's and the flow's included papers by source). */
async function moveIncluded(ctx: MutationCtx, jobId: Id<"screeningJobs">, from: Id<"screeningSources">, to: Id<"screeningSources">) {
  const progress = await progressRow(ctx, jobId);
  if (!progress) return;
  const included = { ...progress.included };
  included[from] = Math.max(0, (included[from] ?? 1) - 1);
  included[to] = (included[to] ?? 0) + 1;
  await ctx.db.patch("screeningJobProgress", progress._id, { included });
}

/** Saves the papers a screening has included to the collection it was just sent to, a step at a time. */
export const shelveIncluded = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor }) => {
    let job = await ctx.db.get("screeningJobs", jobId);
    if (!job || (job.unsaved && !job.libraryDestination)) return null;
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", "include")).paginate({ cursor, numItems: SHELVE });
    if (page.page.length && job.newCollection && !job.targetCollectionId) {
      const targetCollectionId = await newCollection(ctx, { userId: job.createdBy, workspaceId: job.workspaceId }, job.newCollection);
      await ctx.db.patch("screeningJobs", jobId, { targetCollectionId, newCollection: undefined });
      job = { ...job, targetCollectionId, newCollection: undefined };
    }
    for (const paper of page.page) {
      if (!job.unsaved) await saveQualified(ctx, job, paper);
      // A community's collection gets them through the community's own writes.
      if (job.libraryDestination) await queueLibraryWrite(ctx, job, paper, "add", job.libraryDestination);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.settings.shelveIncluded, { jobId, cursor: page.continueCursor });
    return null;
  },
});
/** Papers one step of that saves: each is a library item and a membership, a few dozen reads. */
const SHELVE = 40;

