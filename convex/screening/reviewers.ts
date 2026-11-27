/**
 * Who is on a screening with reviewers (plans/screening-reviewers), and what changes when that changes. A member of
 * its workspace is put on it here. Someone from outside is given it, or invited to it, by sharing (../sharing): a
 * guest who edits votes, and their place among the reviewers follows their place as a guest (`guestChanged`). A
 * change to who is on it applies from now on: votes that were cast stay, the places nobody voted from are shared out
 * again a step at a time, and every paper touched is settled again by the bookkeeping worker (./settling.ts).
 */
import { addressesOf } from "../lib/people";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { personName } from "../lib/people";
import { workspaceMutation, workspaceQuery } from "../lib/userActions";
import schema from "../schema";
import { grantOf } from "../sharing/items";
import { actorIn } from "../workspaces/actor";
import { isFinal, nextResolver, readersFor } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { bookkeepLater } from "./bookkeeping";
import { logChange } from "./log";
import { countDealt, dealable, keepVersion, MAX_REVIEWERS, modelName, modelRow, nameOf, readingModel, readsOf, reviewersOf, teamFor, votesOf } from "./dealing";
import { modelFor, modelInput, modelsLimit, NEEDS_CRITERIA } from "./screenings";
import { startWaitingVotes } from "./slots";

type Reviewer = Doc<"screeningReviewers">;

/** Papers one step of a change to the reviewers looks at. */
const STEP = 100;

const calledOf = async (ctx: Pick<MutationCtx, "db">, reviewer: Reviewer) =>
  reviewer.kind === "model" ? modelName(reviewer.modelId ? await ctx.db.get("models", reviewer.modelId) : null) : nameOf(reviewer.userId ? await ctx.db.get("users", reviewer.userId) : null);

/** Stamps a paper for the bookkeeping worker without waking it: a step that stamps many wakes it once. */
const stamp = (ctx: MutationCtx, resultId: Id<"screeningResults">, reopen?: "vote") => ctx.db.patch("screeningResults", resultId, { doneAt: ctx.db.vars.commitTs, ...(reopen ? { reopen } : {}) });

/** How long after someone is put on a screening their email goes: by then their share of its open papers is given out, and the email says how many. */
const JOINED_AFTER_MS = 2 * 60_000;

/**
 * Puts a person on a screening, new or back again. Someone who comes back keeps the votes they cast. Their share
 * of the papers nobody has voted on follows a step at a time (`join`).
 */
/** How soon after a screening is made the form's own shares arrive (components/screening/screening-form.tsx `outside`). */
const FROM_THE_START = 60_000;

export async function addPerson(ctx: MutationCtx, job: Doc<"screeningJobs">, userId: Id<"users">, by: Id<"users">, { tell = false }: { /** A colleague put them on it: an email says so, with the papers that wait for them once their share is given out. */ tell?: boolean } = {}) {
  const reviewers = await reviewersOf(ctx, job._id);
  const before = reviewers.filter(dealable).length;
  const old = reviewers.find((one) => one.kind === "person" && one.userId === userId);
  if (old && old.left === undefined) return old._id;
  if (!old && reviewers.length >= MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
  // Someone the form that made the screening named shares in just after it is made: they were on it from the start, and are dated from it.
  const addedAt = Date.now() - job.createdAt < FROM_THE_START ? job.createdAt : Date.now();
  const reviewerId = old?._id ?? (await ctx.db.insert("screeningReviewers", { jobId: job._id, kind: "person", userId, addedAt, addedBy: by, dealt: 0 }));
  if (old) await ctx.db.patch("screeningReviewers", old._id, { left: undefined, discarded: undefined });
  await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId: job._id, reviewerId, before, cursor: null, result: "waiting" });
  if (tell && by !== userId) await ctx.scheduler.runAfter(JOINED_AFTER_MS, internal.screening.noticeMail.send, { jobId: job._id, userId, about: "joined", by });
  return reviewerId;
}

/**
 * Gives someone who joined their share of the open papers, a step at a time. On the papers that wait for votes they
 * take over the places nobody voted from in turn: one in as many as there were people before them, counted across
 * every step (`owed`), so even a few waiting papers are shared evenly, the first going to them. Every paper that may
 * be short of people, or that everyone reads, is stamped for the worker, which fills the places still free.
 */
export const join = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), before: v.number(), cursor: v.union(v.string(), v.null()), result: v.union(v.literal("waiting"), v.literal("conflict")), /** Places owed to them so far, in shares of `before + 1`, and how many they took: carried from step to step. */ owed: v.optional(v.number()), took: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId, before, cursor, result, owed: owedBefore, took: tookBefore }) => {
    const [job, reviewer] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningReviewers", reviewerId)]);
    if (!job?.rule || !reviewer || reviewer.left !== undefined) return null;
    const everyone = job.rule.each === "all";
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: STEP });
    const dealt = new Map<Id<"screeningReviewers">, number>();
    // The first waiting place is theirs: starting one short of a whole share gives them the first, then every `before + 1`th.
    let [owed, took] = [owedBefore ?? before, tookBefore ?? 0];
    const people = new Map((await reviewersOf(ctx, jobId)).map((one) => [one._id, one]));
    for (const paper of page.page) {
      const votes = await votesOf(ctx, paper._id);
      const persons = votes.filter((vote) => people.get(vote.reviewerId)?.kind === "person");
      const mine = persons.find((vote) => vote.reviewerId === reviewerId);
      // Back after their votes were thrown out: the place they had is theirs again, without the vote, as a model's is (`enlist`). The worker counts it and settles the paper again.
      if (mine?.status === "discarded") {
        await ctx.db.patch("screeningVotes", mine._id, { status: "waiting", decision: undefined, answers: undefined, confidences: undefined, passages: undefined, reason: undefined, note: undefined, at: undefined, flagged: undefined, lean: undefined });
        await stamp(ctx, paper._id, "vote");
        continue;
      }
      if (mine) continue;
      const waiting = persons.filter((vote) => vote.status === "waiting");
      // Each place nobody voted from adds a share of one in `before + 1`; a whole one is a place they take, from each earlier holder in turn. A change's preview estimates the same share (lib/screening/project.ts `withJoined`).
      let place: number | null = null;
      if (!everyone && result === "waiting" && waiting.length) {
        owed += waiting.length;
        if (owed >= before + 1) { owed -= before + 1; place = took % waiting.length; took++; }
      }
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
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId, reviewerId, before, cursor: page.continueCursor, result, owed, took });
    // Under "everyone agrees" a split stays one whoever joins: its resolver keeps it.
    else if (result === "waiting" && everyone && job.rule.settle !== "all") await ctx.scheduler.runAfter(0, internal.screening.reviewers.join, { jobId, reviewerId, before, cursor: null, result: "conflict" });
    return null;
  },
});

/**
 * Takes a reviewer off a screening, a step at a time: the worker frees the places they hadn't voted from and gives
 * each to someone else. A model's reading under way finishes and is paid for. Their votes stay and go on counting,
 * unless they are thrown out (`discard`), which lets go of every paper they voted on.
 */
export const leave = internalMutation({
  args: { reviewerId: v.id("screeningReviewers"), discard: v.boolean(), cursor: v.union(v.string(), v.null()), status: v.union(v.literal("waiting"), v.literal("cast")) },
  returns: v.null(),
  handler: async (ctx, { reviewerId, discard, cursor, status }) => {
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (!reviewer || reviewer.left === undefined) return null;
    const page = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewerId).eq("status", status)).paginate({ cursor, numItems: STEP });
    // Each paper they are on is stamped: the worker takes the places they hadn't voted from, gives them to someone else, and stops counting the votes thrown out (./settling.ts).
    for (const vote of page.page) {
      if (status === "cast") await ctx.db.patch("screeningVotes", vote._id, { status: "discarded" });
      await stamp(ctx, vote.resultId, status === "cast" ? "vote" : undefined);
    }
    if (page.page.length) await bookkeepLater(ctx);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId, discard, cursor: page.continueCursor, status });
    else if (status === "waiting" && discard) await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId, discard, cursor: null, status: "cast" });
    return null;
  },
});

/** Takes someone off: they stop being dealt papers at once, and their places follow. Conflicts always have someone to settle them. */
/** `by`: whoever took them off by hand, whom the rule's new version names. A guest whose access changed is taken off by nobody. */
export async function takeOff(ctx: MutationCtx, job: Doc<"screeningJobs">, reviewer: Reviewer, discard: boolean, by?: Id<"users">) {
  if (reviewer.left !== undefined) return;
  const now = Date.now();
  // A guest who votes becomes one who looks, however they are taken off (the People dialog, Settings): nothing that reopens it puts them back on (./dealing.ts `placeGuests`).
  const grant = reviewer.userId ? await grantOf(ctx, job._id, reviewer.userId) : null;
  if (grant?.role === "editor") await ctx.db.patch("itemAccess", grant._id, { role: "viewer" });
  await ctx.db.patch("screeningReviewers", reviewer._id, { left: now, discarded: discard ? now : undefined });
  // Questions put to them wait no more: they can't answer from here now. What was written stays on each paper.
  if (reviewer.userId) await ctx.scheduler.runAfter(0, internal.screening.reviewers.closeQuestions, { jobId: job._id, userId: reviewer.userId });
  const rule = job.rule;
  if (rule && reviewer.kind === "person" && rule.resolver === reviewer.userId) {
    const people = (await reviewersOf(ctx, job._id)).filter((one) => dealable(one) && one._id !== reviewer._id);
    await ctx.db.patch("screeningJobs", job._id, { rule: { ...rule, resolver: nextResolver(job.createdBy, people.flatMap((one) => one.userId ?? [])) } });
    // Who settles conflicts is part of the rule: the whole record lists the change.
    await keepVersion(ctx, (await ctx.db.get("screeningJobs", job._id))!, by);
  }
  await ctx.scheduler.runAfter(0, internal.screening.reviewers.leave, { reviewerId: reviewer._id, discard, cursor: null, status: "waiting" });
}

/**
 * Puts a model on a screening, new or back again, and says which. One that comes back with its votes kept goes on
 * from the papers it hadn't read. The papers still open follow a step at a time (`enlist`).
 */
export async function addModel(ctx: MutationCtx, job: Doc<"screeningJobs">, model: { model: string; effort?: Reviewer["effort"] }, by: Id<"users">) {
  const picked = await modelFor(ctx, model.model);
  if (!job.criteria?.some((criterion) => criterion.must)) throw createError("VALIDATION_ERROR", NEEDS_CRITERIA);
  const reviewers = await reviewersOf(ctx, job._id);
  const old = reviewers.find((one) => one.kind === "model" && one.modelId === picked._id && one.effort === model.effort);
  if (old && old.left === undefined) return picked;
  const most = await modelsLimit(ctx, job.workspaceId);
  if (reviewers.filter(readingModel).length >= most) throw createError("VALIDATION_ERROR", `This workspace's plan runs up to ${most} models on a screening. Take one off to add another.`);
  if (!old && reviewers.length >= MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
  const reviewerId = old?._id ?? (await ctx.db.insert("screeningReviewers", { jobId: job._id, kind: "model", modelId: picked._id, ...(model.effort ? { effort: model.effort } : {}), addedAt: Date.now(), addedBy: by, dealt: 0 }));
  if (old) await ctx.db.patch("screeningReviewers", old._id, { left: undefined, discarded: undefined });
  await ctx.scheduler.runAfter(0, internal.screening.reviewers.enlist, { jobId: job._id, reviewerId, cursor: null, result: "waiting" });
  return picked;
}

/** Gives a model that joined a running screening the papers still open, a step at a time. The ones settled by then it passes over. */
export const enlist = internalMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), cursor: v.union(v.string(), v.null()), result: v.union(v.literal("waiting"), v.literal("conflict")) },
  returns: v.null(),
  handler: async (ctx, { jobId, reviewerId, cursor, result }) => {
    const [job, reviewer] = await Promise.all([ctx.db.get("screeningJobs", jobId), ctx.db.get("screeningReviewers", reviewerId)]);
    if (!job || !reviewer || !readingModel(reviewer)) return null;
    const page = await ctx.db.query("screeningResults").withIndex("by_job_and_result", (q) => q.eq("jobId", jobId).eq("result", result)).paginate({ cursor, numItems: STEP });
    const reads = await readsOf(ctx, [reviewer]);
    let made = 0;
    for (const paper of page.page) {
      // A paper that is only its PDF is not for a model that takes no files (./dealing.ts `teamFor`).
      if (!teamFor({ people: [], models: [reviewerId as string] }, paper, reads).models.length) continue;
      const votes = await votesOf(ctx, paper._id);
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
    else if (result === "waiting" && job.rule?.settle !== "all") await ctx.scheduler.runAfter(0, internal.screening.reviewers.enlist, { jobId, reviewerId, cursor: null, result: "conflict" });
    return null;
  },
});

/**
 * Puts a reviewer on one of the workspace's screenings: a member of the workspace (`personId`), who gets an even
 * share of the papers nobody has voted on, or an AI model at one effort (`model`), which reads every paper still
 * open and is paid for from the workspace's credits, a paper at a time. Papers that were settled keep their result.
 * Someone from outside the workspace is given the screening by sharing instead (sharing/guests:add or
 * sharing/invitations:invite, as an editor to vote).
 */
export const add = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), personId: v.optional(v.id("users")), model: v.optional(modelInput) },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, personId, model }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to add a reviewer.");
    if (Boolean(personId) === Boolean(model)) throw createError("VALIDATION_ERROR", "Add one person or one model.");
    if (personId) {
      const person = await ctx.db.get("users", personId);
      if (person?.state !== "active" || !(await actorIn(ctx, person, job.workspaceId))) throw createError("VALIDATION_ERROR", "Only members of this workspace are added here. Share the screening with anyone else.");
      await addPerson(ctx, job, personId, actor.userId, { tell: true });
      await logChange(ctx, actor, job, "reviewerAdded", { detail: nameOf(person) });
      return null;
    }
    const picked = await addModel(ctx, job, model!, actor.userId);
    await logChange(ctx, actor, job, "reviewerAdded", { detail: modelName(picked) });
    return null;
  },
});

/**
 * Takes a reviewer off one of the workspace's screenings: a person or a model. The papers they hadn't voted on go to
 * the other reviewers. Their votes stay and go on counting, unless `discard` throws them out, which opens again
 * every paper they voted on that nobody settled by hand. Someone from outside the workspace keeps the screening to
 * look at; to take it back from them, stop sharing it (sharing/guests:remove).
 */
export const remove = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers"), discard: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, reviewerId, discard }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId) throw createError("NOT_FOUND", "They aren't on this screening.");
    // A guest who votes becomes one who looks (`takeOff`): Activity says so.
    const grant = reviewer.userId ? await grantOf(ctx, jobId, reviewer.userId) : null;
    await takeOff(ctx, job, reviewer, discard === true, actor.userId);
    await logChange(ctx, actor, job, grant?.role === "editor" ? "madeViewer" : "reviewerRemoved", { detail: await calledOf(ctx, reviewer), more: discard ? [{ code: "votesDiscarded" }] : [] });
    return null;
  },
});

/**
 * Puts the person themselves on one of their workspace's screenings as a reviewer: they get an even share of the
 * papers nobody has voted on.
 */
export const joinIn = workspaceMutation({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to join.");
    await addPerson(ctx, job, actor.userId, actor.userId);
    const me = await ctx.db.get("users", actor.userId);
    await logChange(ctx, actor, job, "reviewerJoined", { detail: nameOf(me) });
    return null;
  },
});

/**
 * A guest's place on a screening changed, or went (../lib/triggers.ts): one who edits is one of its reviewers, and
 * one who only looks, or has it no more, is not. Someone who has since joined its workspace keeps their place as a member.
 */
export const guestChanged = internalMutation({
  args: { item: v.string(), userId: v.id("users"), /** Placed as the screening reopens: they are told they can vote now, whatever told them they could later. */ reopened: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { item, userId, reopened }) => {
    const jobId = ctx.db.normalizeId("screeningJobs", item);
    const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
    if (job?.shape === 2) await placeGuest(ctx, job, userId, reopened === true);
    return null;
  },
});

/** Closes the questions put to someone on one screening, a step at a time, once they can no longer answer them there. What was written stays on each paper. */
export const closeQuestions = internalMutation({
  args: { jobId: v.id("screeningJobs"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { jobId, userId }) => {
    const open = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", userId).eq("open", true)).take(STEP);
    for (const message of open) await ctx.db.patch("screeningMessages", message._id, { open: undefined });
    if (open.length === STEP) await ctx.scheduler.runAfter(0, internal.screening.reviewers.closeQuestions, { jobId, userId });
    return null;
  },
});

/**
 * Takes someone who left an organization off its screenings: their votes stay and count, and the papers that waited
 * for them go to the others (`takeOff`). One the screening is shared with as a guest who votes stays on it.
 */
export const memberLeft = internalMutation({
  args: { organizationId: v.id("organizations"), clerkUserId: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { organizationId, clerkUserId, cursor }) => {
    const [workspace, person] = await Promise.all([
      ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique(),
      ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique(),
    ]);
    if (!workspace || !person) return null;
    // Every screening they are on, a step at a time: the ones of this organization are taken off them.
    const page = await ctx.db.query("screeningReviewers").withIndex("by_user", (q) => q.eq("userId", person._id)).paginate({ cursor: cursor ?? null, numItems: STEP });
    for (const reviewer of page.page) {
      if (reviewer.left !== undefined) continue;
      const job = await ctx.db.get("screeningJobs", reviewer.jobId);
      if (job?.workspaceId !== workspace._id || (await grantOf(ctx, job._id, person._id))?.role === "editor") continue;
      await takeOff(ctx, job, reviewer, false);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.reviewers.memberLeft, { organizationId, clerkUserId, cursor: page.continueCursor });
    else {
      // The screenings they settle conflicts on, reviewer or not, pass to someone who can still open them: a person reviewing it, else whoever made it.
      for (const status of ["processing", "completed"] as const) {
        for (const job of await ctx.db.query("screeningJobs").withIndex("by_resolver_and_status", (q) => q.eq("rule.resolver", person._id).eq("status", status)).take(STEP)) {
          // One the screening is shared with to vote on still opens it, and still settles its conflicts.
          if (job.workspaceId !== workspace._id || !job.rule || (await grantOf(ctx, job._id, person._id))?.role === "editor") continue;
          const people = (await reviewersOf(ctx, job._id)).filter((one) => dealable(one) && one.kind === "person" && one.userId && one.userId !== person._id).flatMap((one) => one.userId ?? []);
          const maker = job.createdBy !== person._id ? job.createdBy : undefined;
          const next = people[0] ?? maker;
          if (!next) continue;
          await ctx.db.patch("screeningJobs", job._id, { rule: { ...job.rule, resolver: people.includes(job.createdBy) ? job.createdBy : next } });
          await keepVersion(ctx, (await ctx.db.get("screeningJobs", job._id))!);
        }
      }
    }
    return null;
  },
});

/** Puts a guest on a screening as a reviewer, or takes them off, as their place as its guest says. A finished screening takes no one on: reopening it asks again for each guest (./screenings.ts `reopen`). */
async function placeGuest(ctx: MutationCtx, job: Doc<"screeningJobs">, userId: Id<"users">, reopened = false) {
  const [grant, person] = await Promise.all([grantOf(ctx, job._id, userId), ctx.db.get("users", userId)]);
  if (person && (await actorIn(ctx, person, job.workspaceId))) return;
  const reviewer = (await reviewersOf(ctx, job._id)).find((one) => one.kind === "person" && one.userId === userId);
  // One who accepted an emailed invitation was told by that email. One given it by name was told nothing: an email says they are on it, or, the screening being finished, that they vote once it is reopened.
  const emailed = async () => (person ? (await Promise.all(addressesOf(person).map((email) => ctx.db.query("itemInvitations").withIndex("by_item_and_email", (q) => q.eq("item", job._id).eq("email", email)).first()))).some((one) => one?.state === "accepted" && one.role === "editor") : false);
  if (grant?.role === "editor" && job.finishedAt === undefined) await addPerson(ctx, job, userId, grant.grantedBy, { tell: reopened || !(await emailed()) });
  else if (grant?.role === "editor" && !reviewer) {
    if (grant.grantedBy !== userId && !(await emailed())) await ctx.scheduler.runAfter(0, internal.screening.noticeMail.send, { jobId: job._id, userId, about: "joined", by: grant.grantedBy });
  }
  else if (grant?.role !== "editor" && reviewer) await takeOff(ctx, job, reviewer, false);
}

/**
 * Moves papers one person hasn't voted on yet to another person on the same screening, the ones furthest down their
 * queue first: up to `papers` of them, among those the other person doesn't have already.
 */
export const move = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), from: v.id("screeningReviewers"), to: v.id("screeningReviewers"), papers: v.number() },
  returns: v.object({ moved: v.number() }),
  handler: async (ctx, actor, { jobId, from, to, papers }) => {
    const job = await requireMember(ctx, actor, jobId);
    const [giver, taker] = await Promise.all([ctx.db.get("screeningReviewers", from), ctx.db.get("screeningReviewers", to)]);
    if (!giver || !taker || giver.jobId !== jobId || taker.jobId !== jobId || !dealable(giver) || !dealable(taker) || from === to) throw createError("VALIDATION_ERROR", "Pick two people who are on this screening.");
    const most = Math.min(Math.max(0, Math.floor(papers)), MOVE_MAX);
    // From the far end of their queue, passing the ones the other person is on already.
    let moved = 0;
    for (const vote of (await freeToMove(ctx, from, to, most)).found) {
      await ctx.db.patch("screeningVotes", vote._id, { reviewerId: to });
      // It goes back to them only where nobody else is left to take it.
      const paper = await ctx.db.get("screeningResults", vote.resultId);
      if (paper) await ctx.db.patch("screeningResults", paper._id, { away: [...new Set([...(paper.away ?? []).filter((one) => one !== to), from])] });
      moved++;
    }
    await countDealt(ctx, new Map([[from, -moved], [to, moved]]));
    if (moved) await logChange(ctx, actor, job, "papersMoved", { count: moved, detail: await calledOf(ctx, giver), more: [{ code: "to", detail: await calledOf(ctx, taker) }] });
    return { moved };
  },
});
/** The most papers one call moves between two people, the places of a queue looked through at a time for them, and how many such stretches it looks through. */
const MOVE_MAX = 200;
const MOVE_LOOKED = 400;
// Nine stretches, 3,600 places: each place is one index range, and a transaction has 4,096 of them.
const MOVE_STRETCHES = 9;

/** The waiting votes of one person that another isn't on, from the far end of the first one's queue: up to `most`, a stretch of places at a time, so papers past a stretch the other person all has are still found. */
async function freeToMove(ctx: Pick<QueryCtx, "db">, from: Id<"screeningReviewers">, to: Id<"screeningReviewers">, most: number) {
  const found: Doc<"screeningVotes">[] = [];
  let below: number | undefined;
  // Whether the whole queue was looked through, or the stretches ran out first.
  let whole = false;
  for (let stretch = 0; stretch < MOVE_STRETCHES && found.length < most; stretch++) {
    const waiting = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => (below === undefined ? q.eq("reviewerId", from).eq("status", "waiting") : q.eq("reviewerId", from).eq("status", "waiting").lt("place", below))).order("desc").take(MOVE_LOOKED);
    // One indexed look for the other person on each paper: a large team's votes are never all read.
    for (const vote of waiting) if (found.length < most && !(await ctx.db.query("screeningVotes").withIndex("by_result_and_reviewer", (q) => q.eq("resultId", vote.resultId).eq("reviewerId", to)).first())) found.push(vote);
    if (waiting.length < MOVE_LOOKED) { whole = true; break; }
    below = waiting.at(-1)!.place;
  }
  return { found, whole };
}

/**
 * Counts the papers one person on a screening hasn't voted on yet that another person on it doesn't have: what can
 * be moved from the first to the second, counted up to 200, as a move finds them.
 */
export const movable = workspaceQuery({
  args: { jobId: v.id("screeningJobs"), from: v.id("screeningReviewers"), to: v.id("screeningReviewers") },
  // `whole`: the first person's whole queue was looked through, so none found means the second person has them all.
  returns: v.object({ count: v.number(), whole: v.boolean() }),
  handler: async (ctx, actor, { jobId, from, to }) => {
    await requireMember(ctx, actor, jobId);
    const [giver, taker] = await Promise.all([ctx.db.get("screeningReviewers", from), ctx.db.get("screeningReviewers", to)]);
    if (giver?.jobId !== jobId || taker?.jobId !== jobId) return { count: 0, whole: true };
    // Found as the move finds them: the count is what the move does.
    const { found, whole } = await freeToMove(ctx, from, to, MOVE_MAX);
    return { count: found.length, whole };
  },
});

/**
 * Sends a person on a screening a reminder by email that papers wait for their vote, at most once a day.
 */
export const remind = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers") },
  returns: v.null(),
  // An email goes out.
  handler: async (ctx, actor, { jobId, reviewerId }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId || !dealable(reviewer)) throw createError("NOT_FOUND", "They aren't on this screening.");
    if (reviewer.reminded && Date.now() - reviewer.reminded < 86_400_000) throw createError("CONFLICT", "They were reminded less than a day ago.");
    await ctx.db.patch("screeningReviewers", reviewerId, { reminded: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.noticeMail.send, { jobId, userId: reviewer.userId!, about: "reminder", by: actor.userId });
    await logChange(ctx, actor, job, "reminded", { detail: await calledOf(ctx, reviewer) });
    return null;
  },
});

/**
 * Sends one of a screening's models back to the papers it couldn't read. Each is read again and paid for from the
 * workspace's credits like any reading.
 */
export const retry = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), reviewerId: v.id("screeningReviewers") },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, reviewerId }) => {
    const job = await requireMember(ctx, actor, jobId);
    const reviewer = await ctx.db.get("screeningReviewers", reviewerId);
    if (reviewer?.jobId !== jobId || !readingModel(reviewer)) throw createError("NOT_FOUND", "That model isn't on this screening.");
    // A finished screening reads nothing: its failed readings wait for it to be reopened.
    if (job.finishedAt !== undefined) throw createError("CONFLICT", "This screening is finished. Reopen it to read those papers again.");
    await ctx.scheduler.runAfter(0, internal.screening.reviewers.reread, { jobId, reviewerId });
    const failed = (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())?.reviewers?.[reviewerId]?.failed;
    await logChange(ctx, actor, job, "retried", { detail: await calledOf(ctx, reviewer), ...(failed ? { count: failed } : {}) });
    return null;
  },
});

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
      // A paper its other votes settled meanwhile keeps its result, as one settled before a model joins does (`enlist`): the model lets go of it, and it isn't paid for again. A closed place would be one the rule still waits for.
      // A paper whose source was taken out is in the screening no more: the model lets go of it too, and nothing is paid to read it.
      await ctx.db.patch("screeningVotes", vote._id, isFinal(paper.result) || paper.withdrawn ? { status: "discarded", error: undefined } : { ...modelRow(job, paper, reviewer), error: undefined });
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

/**
 * Lists the members of the workspace who could be put on a screening as reviewers, a page at a time, the ones whose
 * name or email contains `text`. In a person's own workspace that is only themselves.
 */
export const candidates = workspaceQuery({
  args: { text: v.optional(v.string()), /** The people already on it, left out before a page is cut, so a page is never emptied by them. */ exclude: v.optional(v.array(v.string())), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("users"), name: v.string(), email: v.string(), imageUrl: v.optional(v.string()) })),
  handler: async (ctx, { userId, workspaceId }, { text, exclude = [], paginationOpts }) => {
    if (exclude.length > MAX_REVIEWERS) throw createError("VALIDATION_ERROR", "Too many people to leave out");
    const left = new Set<string>(exclude);
    const needle = text?.trim().toLowerCase() ?? "";
    const row = (user: Doc<"users">) => ({ id: user._id, name: personName(user) || user.email, email: user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) });
    const matches = (user: Doc<"users">) => !needle || `${personName(user)}\n${user.email}`.toLowerCase().includes(needle);
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") {
      const me = await ctx.db.get("users", userId);
      return { page: me && matches(me) && !left.has(me._id) && !paginationOpts.cursor ? [row(me)] : [], isDone: true, continueCursor: "" };
    }
    const found = new Map<string, Doc<"users">>();
    const read = await stream(ctx.db, schema)
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active"))
      .filterWith(async (membership) => {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
        if (user?.state !== "active" || !matches(user) || left.has(user._id)) return false;
        found.set(membership.clerkUserId, user);
        return true;
      })
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, CANDIDATES), maximumRowsRead: CANDIDATE_ROWS });
    return { ...read, page: read.page.flatMap((membership) => { const user = found.get(membership.clerkUserId); return user ? [row(user)] : []; }) };
  },
});
