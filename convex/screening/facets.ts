/**
 * A screening's papers and votes counted by what its Papers page narrows to, so a tab's count under any one narrowing
 * is a few counted reads, never a read of every paper (plans/screening-reviewers). Namespaces of the
 * `screeningFacetCounts` aggregate:
 *
 * - `${jobId}:source:${sourceId}` and `${jobId}:check:${checkId}`: each paper by where it stands.
 * - `${jobId}:reason`: each excluded paper by why.
 * - `${reviewerId}`: each paper a reviewer is on, by how they stand on it and where the paper stands:
 *   `include|conflict` is a paper they voted include on that is in conflict.
 * - `${reviewerId}:at`: each vote they cast, by when.
 *
 * A paper that left with its source counts nowhere but in its reviewers' votes by when, as its card does
 * (./cards.ts). Triggers on screeningResults and screeningVotes keep them, queued once per mutation
 * (../lib/countQueue.ts). This module holds no Convex functions, so the triggers can load it.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { queueCounts, type QueueingCtx } from "../lib/countQueue";
import { NO_REASON } from "../../lib/screening/rules";
import { MAX_REVIEWERS } from "./validators";

type Key = string | number;
export const screeningCounts = new DirectAggregate<{ Namespace: string; Key: Key; Id: string }>(components.screeningFacetCounts);

const RESULTS = ["include", "maybe", "exclude", "conflict", "waiting"] as const;
type Result = (typeof RESULTS)[number];
export type Tally = Record<Result, number>;
/**
 * How a reviewer stands on a paper: the way they voted, or that they haven't (`waiting`), or that a model couldn't
 * (`failed`). A model's vote is cast before the bookkeeping works out its decision: until then it is `cast`.
 */
export type Way = "include" | "maybe" | "exclude" | "cast" | "waiting" | "failed";

const sourceOf = (jobId: Id<"screeningJobs">, sourceId: Id<"screeningSources">) => `${jobId}:source:${sourceId}`;
const checkOf = (jobId: Id<"screeningJobs">, checkId: Id<"screeningChecks">) => `${jobId}:check:${checkId}`;
const reasonsOf = (jobId: Id<"screeningJobs">) => `${jobId}:reason`;
const reviewerOf = (reviewerId: Id<"screeningReviewers">) => `${reviewerId}`;
const castOf = (reviewerId: Id<"screeningReviewers">) => `${reviewerId}:at`;
// Two narrowings at once, as Papers offers them: a reviewer with a source, a check or a reason, and a source, a check and a reason with each other.
type Under = { source: Id<"screeningSources"> } | { check: Id<"screeningChecks"> };
const reviewerUnder = (reviewerId: Id<"screeningReviewers">, under: Under) => ("source" in under ? `${reviewerId}:source:${under.source}` : `${reviewerId}:check:${under.check}`);
const reviewerReasons = (reviewerId: Id<"screeningReviewers">) => `${reviewerId}:reason`;
const sourceAndCheck = (jobId: Id<"screeningJobs">, sourceId: Id<"screeningSources">, checkId: Id<"screeningChecks">) => `${jobId}:source:${sourceId}:check:${checkId}`;
const reasonsUnder = (jobId: Id<"screeningJobs">, under: Under) => ("source" in under ? `${jobId}:source:${under.source}:reason` : `${jobId}:check:${under.check}:reason`);

type Entry = { namespace: string; key: Key; id: string };
type Paper = Pick<Doc<"screeningResults">, "_id" | "jobId" | "place" | "withdrawn" | "result" | "sourceId" | "checkId" | "reason">;
const resultOf = (paper: Pick<Paper, "result">): Result => paper.result ?? "waiting";
/** Whether a paper counts in its screening's lists: one with a place, still in it. */
const counted = (paper: Pick<Paper, "place" | "withdrawn"> | null): paper is Pick<Paper, "place" | "withdrawn" | "result"> => Boolean(paper && paper.place !== undefined && !paper.withdrawn);

const same = (a: Entry, b: Entry) => a.namespace === b.namespace && a.key === b.key && a.id === b.id;
/** Queues what moved between two sets of entries. Inserting twice or deleting what isn't there does nothing, so a backfill just counts every row again. */
async function move(ctx: QueueingCtx, was: Entry[], now: Entry[]) {
  await queueCounts(ctx, screeningCounts, [
    ...was.filter((entry) => !now.some((other) => same(entry, other))).map((entry) => ({ type: "deleteIfExists" as const, ...entry })),
    ...now.filter((entry) => !was.some((other) => same(entry, other))).map((entry) => ({ type: "insertIfDoesNotExist" as const, ...entry })),
  ]);
}

/** A paper's entries: where it stands under its source and its check, and why it is excluded. */
export function paperEntries(paper: Paper | null): Entry[] {
  if (!paper || !counted(paper)) return [];
  const result = resultOf(paper);
  return [
    ...(paper.sourceId ? [{ namespace: sourceOf(paper.jobId, paper.sourceId), key: result, id: paper._id }] : []),
    ...(paper.checkId ? [{ namespace: checkOf(paper.jobId, paper.checkId), key: result, id: paper._id }] : []),
    ...(result === "exclude" ? [{ namespace: reasonsOf(paper.jobId), key: paper.reason ?? NO_REASON, id: paper._id }] : []),
    ...(paper.sourceId && paper.checkId ? [{ namespace: sourceAndCheck(paper.jobId, paper.sourceId, paper.checkId), key: result, id: paper._id }] : []),
    ...(result === "exclude" && paper.sourceId ? [{ namespace: reasonsUnder(paper.jobId, { source: paper.sourceId }), key: paper.reason ?? NO_REASON, id: paper._id }] : []),
    ...(result === "exclude" && paper.checkId ? [{ namespace: reasonsUnder(paper.jobId, { check: paper.checkId }), key: paper.reason ?? NO_REASON, id: paper._id }] : []),
  ];
}

type Vote = Pick<Doc<"screeningVotes">, "_id" | "reviewerId" | "status" | "decision" | "at">;
/** A vote's entries: how its reviewer stands on its paper with where the paper stands, and, cast, when it was. */
export function voteEntries(vote: Vote | null, paper: Pick<Paper, "place" | "withdrawn" | "result" | "sourceId" | "checkId" | "reason"> | null): Entry[] {
  if (!vote) return [];
  const way = vote.status === "cast" ? (vote.decision ?? "cast") : vote.status;
  const on = way && counted(paper) ? `${way}|${resultOf(paper)}` : null;
  return [
    ...(on ? [{ namespace: reviewerOf(vote.reviewerId), key: on, id: vote._id }] : []),
    ...(on && paper!.sourceId ? [{ namespace: reviewerUnder(vote.reviewerId, { source: paper!.sourceId }), key: on, id: vote._id }] : []),
    ...(on && paper!.checkId ? [{ namespace: reviewerUnder(vote.reviewerId, { check: paper!.checkId }), key: on, id: vote._id }] : []),
    ...(on && resultOf(paper!) === "exclude" ? [{ namespace: reviewerReasons(vote.reviewerId), key: `${way}|${paper!.reason ?? NO_REASON}`, id: vote._id }] : []),
    ...(vote.status === "cast" && vote.at !== undefined ? [{ namespace: castOf(vote.reviewerId), key: vote.at, id: vote._id }] : []),
  ];
}

/**
 * The papers one mutation has written or read, by id, while it runs: a step of a reading deals hundreds of votes on
 * the papers it just made, and each vote's entries need its paper. Read once each, a step stays inside a
 * transaction's reads (4,096 index ranges). Kept by the mutation's count queue, which lives as long as it does, and
 * kept current by the papers' own trigger.
 */
const papersOf = new WeakMap<object, Map<string, Paper | null>>();
const known = (ctx: QueueingCtx) => {
  if (!ctx.countQueue) return null;
  let papers = papersOf.get(ctx.countQueue);
  if (!papers) papersOf.set(ctx.countQueue, (papers = new Map()));
  return papers;
};
async function paperOf(ctx: QueueingCtx, id: Id<"screeningResults">) {
  const papers = known(ctx);
  if (papers?.has(id)) return papers.get(id)!;
  const paper = await ctx.db.get("screeningResults", id);
  papers?.set(id, paper);
  return paper;
}

/** Keeps a paper's entries, and its votes' where the paper's standing in them moved. */
export async function countPaperFacets(ctx: QueueingCtx, change: Change<DataModel, "screeningResults">) {
  const [was, now] = [change.oldDoc, change.newDoc];
  known(ctx)?.set(change.id, now);
  await move(ctx, paperEntries(was), paperEntries(now));
  // Its votes are counted under where it stands, its source, its check and its reason: they move when any of those does.
  const standing = (paper: Paper | null) => (counted(paper) ? `${resultOf(paper!)}|${paper!.sourceId}|${paper!.checkId}|${paper!.reason}` : null);
  const before = standing(was);
  const after = standing(now);
  // A paper just made has no votes yet: they are dealt after it, and counted by their own trigger.
  if (before === after || !was) return;
  const votes = await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", change.id)).take(MAX_REVIEWERS);
  await move(ctx, votes.flatMap((vote) => voteEntries(vote, was)), votes.flatMap((vote) => voteEntries(vote, now)));
}

/** Keeps a vote's entries where how it stands, or when it was cast, changed. */
export async function countVoteFacets(ctx: QueueingCtx, change: Change<DataModel, "screeningVotes">) {
  const [was, now] = [change.oldDoc, change.newDoc];
  if (was && now && was.reviewerId === now.reviewerId && was.status === now.status && was.decision === now.decision && was.at === now.at) return;
  const paper = await paperOf(ctx, (now ?? was)!.resultId);
  await move(ctx, voteEntries(was, paper), voteEntries(now, paper));
}

/** Counts every entry of a row that may predate the counts: what the backfill does. */
export const countEntries = (ctx: QueueingCtx, entries: Entry[]) => move(ctx, [], entries);

/**
 * The waiting entries a vote has that it shouldn't: a model's reading that came back through the pool before its
 * completion ran with the triggers (../lib/functions.ts `withAppWrites`) left its vote counted as waiting, under where
 * its paper stood then, whatever the vote has done since, waited again included.
 */
export const staleWaiting = (vote: Vote, paper: Pick<Paper, "place" | "withdrawn" | "result" | "sourceId" | "checkId" | "reason"> | null): Entry[] => {
  const kept = voteEntries(vote, paper).find((entry) => entry.namespace === reviewerOf(vote.reviewerId))?.key;
  return RESULTS.map((result) => `waiting|${result}`).filter((key) => key !== kept).map((key) => ({ namespace: reviewerOf(vote.reviewerId), key, id: vote._id }));
};

/** Takes out a vote's stale waiting entries, and counts it as it stands. */
export async function recountVote(ctx: QueueingCtx, vote: Vote, paper: Pick<Paper, "place" | "withdrawn" | "result" | "sourceId" | "checkId" | "reason"> | null) {
  await queueCounts(ctx, screeningCounts, staleWaiting(vote, paper).map((entry) => ({ type: "deleteIfExists" as const, ...entry })));
  await countEntries(ctx, voteEntries(vote, paper));
}

const none = (): Tally => ({ include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 });
/** One count for each key, in order. A moment behind the writes. */
const countEach = (ctx: QueryCtx, namespace: string, keys: Key[]) =>
  screeningCounts.countBatch(ctx, keys.map((key) => ({ namespace, bounds: { eq: key } })) as never, { stale: true });

/** How many of a screening's papers stand each way under one source, or one check. */
export async function tallyUnder(ctx: QueryCtx, jobId: Id<"screeningJobs">, under: { source: Id<"screeningSources"> } | { check: Id<"screeningChecks"> }): Promise<Tally> {
  const counts = await countEach(ctx, "source" in under ? sourceOf(jobId, under.source) : checkOf(jobId, under.check), [...RESULTS]);
  return Object.fromEntries(RESULTS.map((result, at) => [result, counts[at]!])) as Tally;
}

/** How many of a screening's papers are excluded for each of `reasons`, those with none left out. */
export async function excludedFor(ctx: QueryCtx, jobId: Id<"screeningJobs">, reasons: string[]): Promise<Record<string, number>> {
  const counts = await countEach(ctx, reasonsOf(jobId), reasons);
  return Object.fromEntries(reasons.flatMap((reason, at) => (counts[at] ? [[reason, counts[at]!]] : [])));
}

/** How many of a screening's papers are excluded for `reason`: they are the only ones that stand that way. */
export async function tallyForReason(ctx: QueryCtx, jobId: Id<"screeningJobs">, reason: string): Promise<Tally> {
  return { ...none(), exclude: (await excludedFor(ctx, jobId, [reason]))[reason] ?? 0 };
}

/** How many of the papers a reviewer stands one of `ways` on stand each way. */
export async function tallyOfReviewer(ctx: QueryCtx, reviewerId: Id<"screeningReviewers">, ways: Way[]): Promise<Tally> {
  const keys = ways.flatMap((way) => RESULTS.map((result) => `${way}|${result}`));
  const counts = await countEach(ctx, reviewerOf(reviewerId), keys);
  const tally = none();
  keys.forEach((key, at) => (tally[key.split("|")[1] as Result] += counts[at]!));
  return tally;
}

/** How many votes a reviewer cast from `since` on. */
export const castSince = (ctx: QueryCtx, reviewerId: Id<"screeningReviewers">, since: number) =>
  screeningCounts.count(ctx, { namespace: castOf(reviewerId), bounds: { lower: { key: since, inclusive: true } }, stale: true });

/** How many of the papers a reviewer stands one of `ways` on stand each way, of those one source or one check brought. */
export async function tallyOfReviewerUnder(ctx: QueryCtx, reviewerId: Id<"screeningReviewers">, ways: Way[], under: Under): Promise<Tally> {
  const keys = ways.flatMap((way) => RESULTS.map((result) => `${way}|${result}`));
  const counts = await countEach(ctx, reviewerUnder(reviewerId, under), keys);
  const tally = none();
  keys.forEach((key, at) => (tally[key.split("|")[1] as Result] += counts[at]!));
  return tally;
}

/** How many of the papers a reviewer stands one of `ways` on are excluded for `reason`. */
export async function tallyOfReviewerForReason(ctx: QueryCtx, reviewerId: Id<"screeningReviewers">, ways: Way[], reason: string): Promise<Tally> {
  const counts = await countEach(ctx, reviewerReasons(reviewerId), ways.map((way) => `${way}|${reason}`));
  return { ...none(), exclude: counts.reduce((sum, n) => sum + n, 0) };
}

/** How many of the papers one source brought in one check stand each way. */
export async function tallyUnderBoth(ctx: QueryCtx, jobId: Id<"screeningJobs">, sourceId: Id<"screeningSources">, checkId: Id<"screeningChecks">): Promise<Tally> {
  const counts = await countEach(ctx, sourceAndCheck(jobId, sourceId, checkId), [...RESULTS]);
  return Object.fromEntries(RESULTS.map((result, at) => [result, counts[at]!])) as Tally;
}

/** How many of the papers one source or one check brought are excluded for `reason`. */
export async function tallyForReasonUnder(ctx: QueryCtx, jobId: Id<"screeningJobs">, reason: string, under: Under): Promise<Tally> {
  const [excluded] = await countEach(ctx, reasonsUnder(jobId, under), [reason]);
  return { ...none(), exclude: excluded! };
}
