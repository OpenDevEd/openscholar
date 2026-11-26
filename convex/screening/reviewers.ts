/**
 * Who is on a screening with reviewers (plans/screening-reviewers), and what changes when that changes. A member of
 * its workspace is put on it here. Someone from outside is given it, or invited to it, by sharing (../sharing): a
 * guest who edits votes, and their place among the reviewers follows their place as a guest (`guestChanged`). A
 * change to who is on it applies from now on: votes that were cast stay, the places nobody voted from are shared out
 * again a step at a time, and every paper touched is settled again by the bookkeeping worker (./settling.ts).
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { noteActivity } from "../activity/notes";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { personName } from "../lib/people";
import { defineUserMutation, defineUserQuery, userMutation, userQuery, type Acting } from "../lib/userActions";
import schema from "../schema";
import { grantOf } from "../sharing/items";
import { actorIn } from "../workspaces/actor";
import { readersFor, takesOver } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { bookkeepLater } from "./bookkeeping";
import { countDealt, dealable, MAX_REVIEWERS, modelRow, readingModel, reviewersOf } from "./dealing";
import { modelFor, modelInput, MODELS_A_SCREENING } from "./screenings";
import { startWaitingVotes } from "./slots";

type Reviewer = Doc<"screeningReviewers">;

/** Papers one step of a change to the reviewers looks at. */
const STEP = 100;

const noted = (ctx: MutationCtx, actor: Pick<Acting, "userId" | "author">, job: Doc<"screeningJobs">, happened: "added" | "removed" | "retried" | "moved" | "edited", detail: string, count?: number) =>
  noteActivity(ctx, { workspaceId: job.workspaceId, by: actor.userId, viaAssistant: actor.author === "assistant" }, { kind: "screening", id: job._id, happened, detail, ...(count === undefined ? {} : { count }) });

const nameOf = async (ctx: Pick<MutationCtx, "db">, reviewer: Reviewer) => {
  if (reviewer.kind === "model") return (reviewer.modelId ? (await ctx.db.get("models", reviewer.modelId))?.name : undefined) ?? "A model";
  const user = reviewer.userId ? await ctx.db.get("users", reviewer.userId) : null;
  return user ? personName(user) || user.email : "Someone";
};

/** Stamps a paper for the bookkeeping worker without waking it: a step that stamps many wakes it once. */
const stamp = (ctx: MutationCtx, resultId: Id<"screeningResults">, reopen?: "vote") => ctx.db.patch("screeningResults", resultId, { doneAt: ctx.db.vars.commitTs, ...(reopen ? { reopen } : {}) });

/**
 * Puts a person on a screening, new or back again. Someone who comes back keeps the votes they cast. Their share
 * of the papers nobody has voted on follows a step at a time (`join`).
 */
async function addPerson(ctx: MutationCtx, job: Doc<"screeningJobs">, userId: Id<"users">, by: Id<"users">) {
  const reviewers = await reviewersOf(ctx, job._id);
  const before = reviewers.filter(dealable).length;
  const old = reviewers.find((one) => one.kind === "person" && one.userId === userId);
  if (old && old.left === undefined) return old._id;
  if (!old && reviewers.length >= MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
  const reviewerId = old?._id ?? (await ctx.db.insert("screeningReviewers", { jobId: job._id, kind: "person", userId, addedAt: Date.now(), addedBy: by, dealt: 0 }));
  if (old) await ctx.db.patch("screeningReviewers", old._id, { left: undefined, addedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId: job._id, reviewerId, before, cursor: null, result: "waiting" });
  return reviewerId;
}

/**
 * Gives someone who joined their share of the open papers, a step at a time. On a paper that waits for votes they
 * take over one of the places nobody voted from, as often as leaves everyone an even share. Every paper that may be
 * short of people, or that everyone reads, is stamped for the worker, which fills the places still free.
 */
export const join = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), before: v.number(), cursor: v.union(v.string(), v.null()), result: v.union(v.literal("waiting"), v.literal("conflict")) },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId, before, cursor, result }) => {
    const [job, reviewer] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningReviewers", reviewerId)]);
    if (!job?.rule || !reviewer || reviewer.left !== undefined) return null;
    const everyone = job.rule.each === "all";
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: STEP });
    const dealt = new Map<Id<"screeningReviewers">, number>();
    const people = new Map((await reviewersOf(ctx, jobId)).map((one) => [one._id, one]));
    for (const paper of page.page) {
      const votes = await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", paper._id)).take(500);
      const persons = votes.filter((vote) => people.get(vote.reviewerId)?.kind === "person");
      if (persons.some((vote) => vote.reviewerId === reviewerId)) continue;
      const waiting = persons.filter((vote) => vote.status === "waiting");
      const place = !everyone && result === "waiting" ? takesOver(paper._id, reviewerId, before, waiting.length) : null;
      if (place !== null) {
        const taken = waiting[place]!;
        await ctx.db.patch("screeningVotes", taken._id, { reviewerId });
        dealt.set(taken.reviewerId, (dealt.get(taken.reviewerId) ?? 0) - 1);
        dealt.set(reviewerId, (dealt.get(reviewerId) ?? 0) + 1);
      }
      // Short of the people its rule asks for, or read by everyone: the worker gives them a place.
      if (everyone || persons.filter((vote) => vote.status !== "discarded").length < readersFor(job.rule.each, before + 1)) await stamp(ctx, paper._id);
    }
    await countDealt(ctx, dealt);
    await bookkeepLater(ctx);
    // A paper in conflict gains a reviewer only where everyone reads every paper.
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId, reviewerId, before, cursor: page.continueCursor, result });
    else if (result === "waiting" && everyone) await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId, reviewerId, before, cursor: null, result: "conflict" });
    return null;
  },
});

/**
 * Takes a reviewer off a screening, a step at a time: the places they hadn't voted from are freed, and the worker
 * gives each to someone else. Their votes stay and go on counting, unless they are thrown out (`discard`), which
 * lets go of every paper they voted on.
 */
export const leave = internalMutation({
  args: { reviewerId: v.id("screeningReviewers"), discard: v.boolean(), cursor: v.union(v.string(), v.null()), status: v.union(v.literal("waiting"), v.literal("cast")) },
  returns: v.null(),
  handler: async (ctx, { reviewerId, discard, cursor, status }) => {
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (!reviewer || reviewer.left === undefined) return null;
    const page = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewerId).eq("status", status)).paginate({ cursor, numItems: STEP });
    for (const vote of page.page) {
      if (status === "waiting") {
        // A reading under way finishes and is paid for: its row goes with it once it has.
        if (vote.workId !== undefined) continue;
        await ctx.db.delete("screeningVotes", vote._id);
        await stamp(ctx, vote.resultId);
      } else {
        await ctx.db.patch("screeningVotes", vote._id, { status: "discarded" });
        await stamp(ctx, vote.resultId, "vote");
      }
    }
    await countDealt(ctx, new Map([[reviewerId, -page.page.filter((vote) => status === "cast" || vote.workId === undefined).length]]));
    await bookkeepLater(ctx);
    // Rows taken out of the range shift it: a step that changed any starts the range again.
    const next = page.page.length ? null : page.continueCursor;
    if (!page.isDone || page.page.length) await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId, discard, cursor: next, status });
    else if (status === "waiting" && discard) await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId, discard, cursor: null, status: "cast" });
    return null;
  },
});

/** Takes someone off: they stop being dealt papers at once, and their places follow. Conflicts always have someone to settle them. */
async function takeOff(ctx: MutationCtx, job: Doc<"screeningJobs">, reviewer: Reviewer, discard: boolean) {
  if (reviewer.left !== undefined) return;
  const now = Date.now();
  await ctx.db.patch("screeningReviewers", reviewer._id, { left: now, ...(discard ? { discarded: now } : {}) });
  const rule = job.rule;
  if (rule && reviewer.kind === "person" && rule.resolver === reviewer.userId) {
    // They go to whoever started the screening, or failing that the first person still on it.
    const people = (await reviewersOf(ctx, job._id)).filter((one) => dealable(one) && one._id !== reviewer._id);
    const resolver = (people.find((one) => one.userId === job.createdBy) ?? people[0])?.userId;
    if (resolver) await ctx.db.patch("screeningJobs", job._id, { rule: { ...rule, resolver } });
  }
  await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId: reviewer._id, discard, cursor: null, status: "waiting" });
}

/** Gives a model that joined a running screening the papers still open, a step at a time. The ones settled by then it passes over. */
export const enlist = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), cursor: v.union(v.string(), v.null()), result: v.union(v.literal("waiting"), v.literal("conflict")) },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId, cursor, result }) => {
    const [job, reviewer] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningReviewers", reviewerId)]);
    if (!job || !reviewer || !readingModel(reviewer)) return null;
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: STEP });
    let made = 0;
    for (const paper of page.page) {
      const votes = await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", paper._id)).take(500);
      const mine = votes.find((vote) => vote.reviewerId === reviewerId);
      // Back after its votes were thrown out, it reads the paper again.
      if (mine?.status === "discarded") await ctx.db.patch("screeningVotes", mine._id, { ...modelRow(job, paper, reviewer), decision: undefined, answers: undefined, confidences: undefined, passages: undefined, reason: undefined, at: undefined });
      else if (!mine) await ctx.db.insert("screeningVotes", modelRow(job, paper, reviewer));
      else continue;
      made++;
      // A paper in conflict waits for votes again once another reviewer is on it.
      if (result === "conflict") await stamp(ctx, paper._id);
    }
    await countDealt(ctx, new Map([[reviewerId, made]]));
    if (made) await startWaitingVotes(ctx, job.workspaceId);
    if (result === "conflict" && made) await bookkeepLater(ctx);
    const next = result === "conflict" && made ? null : page.continueCursor;
    if (!page.isDone || (result === "conflict" && made)) await ctx.scheduler.runAfter(0, internal.screening.reviewers.enlist, { jobId, reviewerId, cursor: next, result });
    else if (result === "waiting") await ctx.scheduler.runAfter(0, internal.screening.reviewers.enlist, { jobId, reviewerId, cursor: null, result: "conflict" });
    return null;
  },
});

export const addAction = defineUserMutation({
  path: "screening/reviewers:add",
  description:
    "Puts a reviewer on one of the workspace's screenings: a member of the workspace (`personId`), who gets an even share of the papers nobody has voted on, or an AI model at one effort (`model`), which reads every paper still open and is paid for from the workspace's credits, a paper at a time. " +
    "Papers that were settled keep their result. Someone from outside the workspace is given the screening by sharing instead (sharing/guests:add or sharing/invitations:invite, as an editor to vote).",
  args: { jobId: v.id("screeningJobs"), personId: v.optional(v.id("users")), model: v.optional(modelInput) },
  returns: v.null(),
  // A model reads from then on, each reading charged as it is made: nothing is held when it is added.
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { jobId, personId, model }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to add a reviewer.");
    if (Boolean(personId) === Boolean(model)) throw createError("VALIDATION_ERROR", "Add one person or one model.");
    if (personId) {
      const person = await ctx.db.get("users", personId);
      if (person?.state !== "active" || !(await actorIn(ctx, person, job.workspaceId))) throw createError("VALIDATION_ERROR", "Only members of this workspace are added here. Share the screening with anyone else.");
      await addPerson(ctx, job, personId, actor.userId);
      await noted(ctx, actor, job, "added", personName(person) || person.email);
      return null;
    }
    const picked = await modelFor(ctx, model!.model);
    const reviewers = await reviewersOf(ctx, jobId);
    const old = reviewers.find((one) => one.kind === "model" && one.modelId === picked._id && one.effort === model!.effort);
    if (old && old.left === undefined) return null;
    if (reviewers.filter(readingModel).length >= MODELS_A_SCREENING) throw createError("VALIDATION_ERROR", `A screening runs up to ${MODELS_A_SCREENING} models. Take one off to add another.`);
    if (!old && reviewers.length >= MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
    const reviewerId = old?._id ?? (await ctx.db.insert("screeningReviewers", { jobId, kind: "model", modelId: picked._id, ...(model!.effort ? { effort: model!.effort } : {}), addedAt: Date.now(), addedBy: actor.userId, dealt: 0 }));
    // One that comes back with its votes kept goes on from the papers it hadn't read.
    if (old) await ctx.db.patch("screeningReviewers", old._id, { left: undefined, addedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.reviewers.enlist, { jobId, reviewerId, cursor: null, result: "waiting" });
    await noted(ctx, actor, job, "added", picked.name);
    return null;
  },
});
export const add = userMutation(addAction);

export const removeAction = defineUserMutation({
  path: "screening/reviewers:remove",
  description:
    "Takes a reviewer off one of the workspace's screenings: a person or a model. The papers they hadn't voted on go to the other reviewers. Their votes stay and go on counting, unless `discard` throws them out, which opens again every paper they voted on that nobody settled by hand. " +
    "Someone from outside the workspace keeps the screening to look at; to take it back from them, stop sharing it (sharing/guests:remove).",
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), discard: v.optional(v.boolean()) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { jobId, reviewerId, discard }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId) throw createError("NOT_FOUND", "They aren't on this screening.");
    // A guest who votes becomes one who looks: their place as a guest decides whether they vote (`guestChanged`).
    const grant = reviewer.userId ? await grantOf(ctx, jobId, reviewer.userId) : null;
    if (grant?.role === "editor") await ctx.db.patch("itemAccess", grant._id, { role: "viewer" });
    await takeOff(ctx, job, reviewer, discard === true);
    await noted(ctx, actor, job, "removed", await nameOf(ctx, reviewer));
    return null;
  },
});
export const remove = userMutation(removeAction);

export const joinAction = defineUserMutation({
  path: "screening/reviewers:joinIn",
  description: "Puts the person themselves on one of their workspace's screenings as a reviewer: they get an even share of the papers nobody has voted on.",
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to join.");
    await addPerson(ctx, job, actor.userId, actor.userId);
    const me = await ctx.db.get("users", actor.userId);
    await noted(ctx, actor, job, "added", me ? personName(me) || me.email : "A reviewer");
    return null;
  },
});
export const joinIn = userMutation(joinAction);

/**
 * A guest's place on a screening changed, or went (../lib/triggers.ts): one who edits is one of its reviewers, and
 * one who only looks, or has it no more, is not. Someone who has since joined its workspace keeps their place as a member.
 */
export const guestChanged = internalMutation({
  args: { item: v.string(), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { item, userId }) => {
    const jobId = ctx.db.normalizeId("screeningJobs", item);
    const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
    if (!job || job.shape !== 2) return null;
    const [grant, person] = await Promise.all([grantOf(ctx, job._id, userId), ctx.db.get("users", userId)]);
    if (person && (await actorIn(ctx, person, job.workspaceId))) return null;
    const reviewer = (await reviewersOf(ctx, job._id)).find((one) => one.kind === "person" && one.userId === userId);
    if (grant?.role === "editor" && job.finishedAt === undefined) await addPerson(ctx, job, userId, grant.grantedBy);
    else if (grant?.role !== "editor" && reviewer) await takeOff(ctx, job, reviewer, false);
    return null;
  },
});

export const moveAction = defineUserMutation({
  path: "screening/reviewers:move",
  description: "Moves papers one person hasn't voted on yet to another person on the same screening, the ones furthest down their queue first: up to `papers` of them, among those the other person doesn't have already.",
  args: { jobId: v.id("screeningJobs"), from: v.id("screeningReviewers"), to: v.id("screeningReviewers"), papers: v.number() },
  returns: v.object({ moved: v.number() }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { jobId, from, to, papers }) => {
    const job = await requireMember(ctx, actor, jobId);
    const [giver, taker] = await Promise.all([ctx.db.get("screeningReviewers", from), ctx.db.get("screeningReviewers", to)]);
    if (!giver || !taker || giver.jobId !== jobId || taker.jobId !== jobId || !dealable(giver) || !dealable(taker) || from === to) throw createError("VALIDATION_ERROR", "Pick two people who are on this screening.");
    const most = Math.min(Math.max(0, Math.floor(papers)), MOVE_MAX);
    // From the far end of their queue, passing the ones the other person is on already.
    const waiting = stream(ctx.db, schema).query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", from).eq("status", "waiting")).order("desc");
    let moved = 0;
    for await (const vote of waiting) {
      if (moved >= most) break;
      const others = await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", vote.resultId)).take(500);
      if (others.some((one) => one.reviewerId === to)) continue;
      await ctx.db.patch("screeningVotes", vote._id, { reviewerId: to });
      // It goes back to them only where nobody else is left to take it.
      const paper = await ctx.db.get("screeningResults", vote.resultId);
      if (paper) await ctx.db.patch("screeningResults", paper._id, { away: [...new Set([...(paper.away ?? []).filter((one) => one !== to), from])] });
      moved++;
    }
    await countDealt(ctx, new Map([[from, -moved], [to, moved]]));
    if (moved) await noted(ctx, actor, job, "moved", `${await nameOf(ctx, giver)} to ${await nameOf(ctx, taker)}`, moved);
    return { moved };
  },
});
export const move = userMutation(moveAction);
/** The most papers one call moves between two people. */
const MOVE_MAX = 500;

export const movableAction = defineUserQuery({
  path: "screening/reviewers:movable",
  description: "Counts the papers one person on a screening hasn't voted on yet that another person on it doesn't have: what can be moved from the first to the second, counted up to 500.",
  args: { jobId: v.id("screeningJobs"), from: v.id("screeningReviewers"), to: v.id("screeningReviewers") },
  returns: v.number(),
  run: async (ctx, actor, { jobId, from, to }) => {
    await requireMember(ctx, actor, jobId);
    const [giver, taker] = await Promise.all([ctx.db.get("screeningReviewers", from), ctx.db.get("screeningReviewers", to)]);
    if (giver?.jobId !== jobId || taker?.jobId !== jobId) return 0;
    const waiting = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", from).eq("status", "waiting")).take(MOVE_MAX);
    const theirs = new Set((await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", to)).take(MOVE_MAX * 4)).map((vote) => vote.resultId));
    return waiting.filter((vote) => !theirs.has(vote.resultId)).length;
  },
});
export const movable = userQuery(movableAction);

export const remindAction = defineUserMutation({
  path: "screening/reviewers:remind",
  description: "Sends a person on a screening a reminder by email that papers wait for their vote, at most once a day.",
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers") },
  returns: v.null(),
  spendsCredits: false,
  // An email goes out.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { jobId, reviewerId }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId || !dealable(reviewer)) throw createError("NOT_FOUND", "They aren't on this screening.");
    if (reviewer.reminded && Date.now() - reviewer.reminded < 86_400_000) throw createError("CONFLICT", "They were reminded less than a day ago.");
    await ctx.db.patch("screeningReviewers", reviewerId, { reminded: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.noticeMail.send, { jobId, userId: reviewer.userId!, about: "reminder", by: actor.userId });
    await noted(ctx, actor, job, "edited", `Reminded ${await nameOf(ctx, reviewer)}`);
    return null;
  },
});
export const remind = userMutation(remindAction);

export const retryAction = defineUserMutation({
  path: "screening/reviewers:retry",
  description: "Sends one of a screening's models back to the papers it couldn't read. Each is read again and paid for from the workspace's credits like any reading.",
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers") },
  returns: v.null(),
  // Each reading is charged as it is made.
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { jobId, reviewerId }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId || !readingModel(reviewer)) throw createError("NOT_FOUND", "That model isn't on this screening.");
    await ctx.scheduler.runAfter(0, internal.screening.reviewers.reread, { jobId, reviewerId });
    await noted(ctx, actor, job, "retried", await nameOf(ctx, reviewer));
    return null;
  },
});
export const retry = userMutation(retryAction);

/** Puts a model's failed readings back in its workspace's queue, a step at a time. */
export const reread = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers") },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId }) => {
    const [job, reviewer] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningReviewers", reviewerId)]);
    if (!job || !reviewer || !readingModel(reviewer)) return null;
    const failed = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewerId).eq("status", "failed")).take(STEP);
    for (const vote of failed) {
      const paper = await ctx.db.get("screeningResults", vote.resultId);
      if (!paper) continue;
      await ctx.db.patch("screeningVotes", vote._id, { ...modelRow(job, paper, reviewer), error: undefined });
      await stamp(ctx, vote.resultId);
    }
    if (failed.length) {
      await startWaitingVotes(ctx, job.workspaceId);
      await bookkeepLater(ctx);
      await ctx.scheduler.runAfter(0, internal.screening.reviewers.reread, { jobId, reviewerId });
    }
    return null;
  },
});

/** People one page of the picker holds, and memberships a page looks through for the ones the text matches. */
const CANDIDATES = 20;
const CANDIDATE_ROWS = 500;

export const candidatesAction = defineUserQuery({
  path: "screening/reviewers:candidates",
  description: "Lists the members of the workspace who could be put on a screening as reviewers, a page at a time, the ones whose name or email contains `text`. In a person's own workspace that is only themselves.",
  args: { text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()) })),
  run: async (ctx, { userId, workspaceId }, { text, paginationOpts }) => {
    const needle = text?.trim().toLowerCase() ?? "";
    const row = (user: Doc<"users">) => ({ id: user._id, name: personName(user) || user.email, email: user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) });
    const matches = (user: Doc<"users">) => !needle || `${personName(user)}\n${user.email}`.toLowerCase().includes(needle);
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") {
      const me = await ctx.db.get("users", userId);
      return { page: me && matches(me) && !paginationOpts.cursor ? [row(me)] : [], isDone: true, continueCursor: "" };
    }
    const found = new Map<string, Doc<"users">>();
    const read = await stream(ctx.db, schema)
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active"))
      .filterWith(async (membership) => {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
        if (user?.state !== "active" || !matches(user)) return false;
        found.set(membership.clerkUserId, user);
        return true;
      })
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, CANDIDATES), maximumRowsRead: CANDIDATE_ROWS });
    return { ...read, page: read.page.flatMap((membership) => { const user = found.get(membership.clerkUserId); return user ? [row(user)] : []; }) };
  },
});
export const candidates = userQuery(candidatesAction);
