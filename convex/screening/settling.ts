/**
 * Where each paper of a screening with reviewers stands (plans/screening-reviewers), worked out by the bookkeeping
 * worker alone (./bookkeeping.ts). Whatever changes a paper's votes stamps the paper `doneAt`; the worker then, a
 * batch at a time, settles each paper on its votes under the screening's rule, brings its places in step with the
 * people on it, and counts what changed: the screening's papers by result, the excluded ones by reason, each
 * reviewer's votes, and how each pair of reviewers agreed. Nothing else writes any of these, so votes arriving
 * together never write the same document.
 *
 * A paper that was settled keeps its result through a change of settings (`heldAt` on the screening): a model
 * reading on never moves it. A person's vote on it lets it go, and so does a check of the settled papers.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cellOf, decide, emptyMatrix, isFinal, reasonOf, scoreOf, settle, type Answer, type Ballot, type Decision, type Result } from "../../lib/screening/rules";
import { newCollection } from "../library/collections";
import { progressOf, shelve, withMoved } from "./bookkeeping";
import { countDealt, dealOpen, reviewersOf } from "./dealing";
import type { Infer } from "convex/values";
import type { reviewerCountsValidator } from "./validators";

type Paper = Doc<"screeningResults">;
type Vote = Doc<"screeningVotes">;
type Reviewer = Doc<"screeningReviewers">;
type Counts = Infer<typeof reviewerCountsValidator>;
type Counted = NonNullable<Vote["counted"]>;

const NO_COUNTS: Counts = { cast: 0, include: 0, maybe: 0, exclude: 0, failed: 0, closed: 0, spent: 0 };
export const NO_RESULTS = { include: 0, maybe: 0, exclude: 0, conflict: 0 };

/** A vote as the rule reads it. A model's decision follows its answers under the criteria as they are now; a person's is the one they gave. */
export function ballotOf(job: Doc<"screeningJobs">, vote: Vote, reviewer: Reviewer | undefined): Ballot & { decision?: Decision } {
  if (vote.status !== "cast") return { status: vote.status };
  const voted = reviewer?.kind === "model" && vote.answers ? decide(vote.answers as Record<string, Answer>, job.criteria ?? []) : { decision: vote.decision, reason: vote.reason };
  return { status: "cast", decision: voted.decision, reason: voted.reason, at: vote.at, answers: vote.answers as Record<string, Answer> | undefined };
}

/** What a vote adds to its reviewer's counts, by sign. */
function add(counts: Counts, counted: Counted | undefined, sign: 1 | -1) {
  if (!counted) return;
  if (counted.status === "cast") counts.cast += sign;
  if (counted.status === "cast" && counted.decision) counts[counted.decision] += sign;
  if (counted.status === "failed") counts.failed += sign;
  if (counted.status === "closed") counts.closed += sign;
  counts.spent += sign * (counted.credits ?? 0);
}

const same = (a: Counted | undefined, b: Counted) => a?.status === b.status && a.decision === b.decision && (a.credits ?? 0) === (b.credits ?? 0);

/**
 * Settles a batch of one screening's papers, and returns how many slots their finished readings freed and how many
 * new readings were made, for the worker to start the workspace's next ones.
 */
export async function settlePapers(ctx: MutationCtx, made: Doc<"screeningJobs">, papers: Paper[]) {
  let job = made;
  const reviewers = await reviewersOf(ctx, job._id);
  const byId = new Map(reviewers.map((one) => [one._id, one]));
  const order = new Map(reviewers.map((one, at) => [one._id, at]));
  const progress = await progressOf(ctx, job._id);
  const counts = { ...NO_RESULTS, ...progress.counts };
  const reasons = { ...progress.reasons };
  const perReviewer = new Map<Id<"screeningReviewers">, Counts>();
  const countsOf = (id: Id<"screeningReviewers">) => perReviewer.get(id) ?? perReviewer.set(id, { ...NO_COUNTS, ...progress.reviewers?.[id] }).get(id)!;
  const pairs = new Map<string, { a: Id<"screeningReviewers">; b: Id<"screeningReviewers">; cells: number[] }>();
  const pair = (x: Id<"screeningReviewers">, y: Id<"screeningReviewers">, first: Decision, second: Decision, sign: 1 | -1) => {
    const [a, b, cell] = (order.get(x) ?? 0) <= (order.get(y) ?? 0) ? [x, y, cellOf(first, second)] : [y, x, cellOf(second, first)];
    const held = pairs.get(`${a}:${b}`) ?? pairs.set(`${a}:${b}`, { a, b, cells: emptyMatrix() }).get(`${a}:${b}`)!;
    held.cells[cell]! += sign;
  };
  const moved = { saved: 0, removed: 0 };
  // Rows this pass made or took away, by reviewer: what it adds to their count of papers.
  const dealt = new Map<Id<"screeningReviewers">, number>();
  let freed = 0;
  let queued = 0;

  for (const paper of papers) {
    let votes = await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", paper._id)).take(500);
    const ballots = () => votes.map((vote) => ballotOf(job, vote, byId.get(vote.reviewerId)));
    const was: Result = paper.result ?? "waiting";
    // Held through a change of settings: settled by then, and nobody has voted on it or asked for it to be checked again since.
    const held = isFinal(paper.result) && !paper.resolved && !paper.reopen && (paper.settledAt ?? 0) <= (job.heldAt ?? 0);
    let now: Result = paper.resolved ? paper.resolved.decision : held ? was : settle(job.rule!.settle, ballots());
    if (!held && !isFinal(now) && !paper.resolved) {
      // Still open: its places follow the people and the rule as they are now, which can settle it or open it further.
      const { made, gone } = await dealOpen(ctx, job, paper, votes, reviewers, { models: paper.reopen === "recheck" });
      if (made.length || gone.length || votes.some((vote) => vote.status === "closed")) {
        for (const vote of gone) add(countsOf(vote.reviewerId), vote.counted, -1);
        for (const [vote, sign] of [...made.map((one) => [one, 1] as const), ...gone.map((one) => [one, -1] as const)]) dealt.set(vote.reviewerId, (dealt.get(vote.reviewerId) ?? 0) + sign);
        votes = [...votes.filter((vote) => !gone.includes(vote)).map((vote) => (vote.status === "closed" ? { ...vote, status: "waiting" as const } : vote)), ...made];
        queued += made.filter((vote) => vote.waitingWorkspace !== undefined).length;
        now = settle(job.rule!.settle, ballots());
      }
    }
    // Settled: the places nobody voted from are closed, and their people's queues let go of the paper.
    if (isFinal(now)) {
      const closing = votes.filter((vote) => vote.status === "waiting" && byId.get(vote.reviewerId)?.kind === "person");
      for (const vote of closing) await ctx.db.patch("screeningVotes", vote._id, { status: "closed" });
      votes = votes.map((vote) => (closing.includes(vote) ? { ...vote, status: "closed" as const } : vote));
    }

    // Each vote adds what it now is to its reviewer's counts, and each pair of votes to their agreement.
    const before = votes.flatMap((vote) => (vote.counted?.status === "cast" && vote.counted.decision ? [{ id: vote.reviewerId, decision: vote.counted.decision }] : []));
    const after: typeof before = [];
    let changed = false;
    for (const vote of votes) {
      const ballot = ballotOf(job, vote, byId.get(vote.reviewerId));
      const counted: Counted = { status: vote.status, ...(ballot.decision ? { decision: ballot.decision } : {}), ...(vote.credits ? { credits: vote.credits } : {}) };
      if (ballot.status === "cast" && ballot.decision) after.push({ id: vote.reviewerId, decision: ballot.decision });
      const finished = vote.slot && vote.status !== "waiting";
      if (finished) freed++;
      if (same(vote.counted, counted) && !finished && vote.decision === ballot.decision) continue;
      changed = true;
      add(countsOf(vote.reviewerId), vote.counted, -1);
      add(countsOf(vote.reviewerId), counted, 1);
      // A model's vote follows its answers under the criteria as they are now, so its decision can move with them.
      await ctx.db.patch("screeningVotes", vote._id, { counted, ...(ballot.status === "cast" && vote.decision !== ballot.decision ? { decision: ballot.decision, reason: ballot.reason } : {}), ...(finished ? { slot: undefined } : {}) });
    }
    if (changed || before.length !== after.length) {
      for (const [i, x] of before.entries()) for (const y of before.slice(i + 1)) pair(x.id, y.id, x.decision, y.decision, -1);
      for (const [i, x] of after.entries()) for (const y of after.slice(i + 1)) pair(x.id, y.id, x.decision, y.decision, 1);
    }

    const cast = ballots();
    const reason = now === "exclude" ? (reasonOf(cast, paper.resolved?.reason) ?? "other") : undefined;
    const { points, stars } = scoreOf(job.criteria ?? [], job.stars ?? [], cast);
    if (was !== "waiting") counts[was] = Math.max(0, counts[was] - 1);
    if (now !== "waiting") counts[now]++;
    if (was === "exclude") reasons[paper.reason ?? "other"] = (reasons[paper.reason ?? "other"] ?? 1) - 1;
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const patch = { result: now, reason, score: points, stars, reopen: undefined, ...(isFinal(now) && now !== was ? { settledAt: Date.now() } : {}), ...(isFinal(now) ? {} : { settledAt: undefined }) };
    await ctx.db.patch("screeningResults", paper._id, patch);
    // Included papers go where the screening sends them, and one that ends excluded leaves the collection it came from, where that was asked.
    if ((now === "include") !== (was === "include") || (now === "exclude") !== (was === "exclude")) {
      const source = paper.sourceId ? await ctx.db.get("screeningSources", paper.sourceId) : null;
      const set = source && source.set.kind !== "upload" && source.set.kind !== "pdf" && source.set.kind !== "dois" ? source.set : undefined;
      // The collection its included papers go to is made with the first of them.
      if (now === "include" && job.newCollection && !job.targetCollectionId) {
        const targetCollectionId = await newCollection(ctx, { userId: job.createdBy, workspaceId: job.workspaceId }, job.newCollection);
        await ctx.db.patch("screeningJobs", job._id, { targetCollectionId, newCollection: undefined });
        job = { ...job, targetCollectionId, newCollection: undefined };
      }
      const to = await shelve(ctx, job, { ...paper, ...patch }, { becameIncluded: now === "include" && was !== "include", left: now === "exclude" && was !== "exclude" }, set);
      moved.saved += to.saved;
      moved.removed += to.removed;
    }
  }

  await ctx.db.patch("screeningJobProgress", progress._id, {
    counts,
    reasons: Object.fromEntries(Object.entries(reasons).filter(([, n]) => n > 0)),
    ...(perReviewer.size ? { reviewers: { ...progress.reviewers, ...Object.fromEntries(perReviewer) } } : {}),
    ...(freed && progress.running ? { running: Math.max(0, progress.running - freed) } : {}),
    ...withMoved(progress, moved),
  });
  await countDealt(ctx, dealt);
  for (const { a, b, cells } of pairs.values()) {
    if (cells.every((n) => n === 0)) continue;
    const row = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", job._id).eq("a", a).eq("b", b)).unique();
    if (row) await ctx.db.patch("screeningAgreement", row._id, { matrix: row.matrix.map((n, cell) => Math.max(0, n + cells[cell]!)) });
    else await ctx.db.insert("screeningAgreement", { jobId: job._id, a, b, matrix: cells.map((n) => Math.max(0, n)) });
  }
  return { freed, queued };
}
