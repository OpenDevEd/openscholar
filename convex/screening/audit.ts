/**
 * A screening's rows checked against one another: what its pages and files show must follow from what is stored.
 * The rules test runs it after every change made mid-course (./changes.test.ts), and it runs on a live screening:
 *
 *   npx convex run screening/audit:check '{"jobId": "..."}'
 *
 * Reads a whole screening: for one person's look at a screening of a few thousand papers, not for a page.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { isFinal, settle, type Ballot, type Result } from "../../lib/screening/rules";
import { tallyOfReviewer, tallyUnder, type Tally } from "./facets";

const DECISIONS = ["include", "maybe", "exclude"] as const;
/** Rows of one kind an audit reads: a screening's papers, votes or cards, which a screening of 5,000 papers stays well within. */
const AUDIT_ROWS = 30_000;

/** What doesn't add up, how many votes each reviewer cast (by Clerk id, "a model" for a model), and where each paper stands. */
export async function auditJob(ctx: QueryCtx, jobId: Id<"screeningJobs">) {
  const job = (await ctx.db.get("screeningJobs", jobId))!;
  const rule = job.rule!;
  const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(AUDIT_ROWS);
  const byId = new Map(reviewers.map((one) => [one._id, one]));
  const names = new Map(await Promise.all(reviewers.map(async (one) => [one._id, one.userId ? (await ctx.db.get("users", one.userId))!.clerkId : "a model"] as const)));
  const papers = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(AUDIT_ROWS);
  const votes = await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).take(AUDIT_ROWS);
  const cards = await ctx.db.query("screeningCards").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(AUDIT_ROWS);
  const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())!;
  const pairs = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).take(AUDIT_ROWS);
  const problems: string[] = [];
  const placed = papers.filter((paper) => paper.place !== undefined);
  const live = placed.filter((paper) => !paper.withdrawn);
  const liveIds = new Set(live.map((paper) => paper._id));
  const active = reviewers.filter((one) => one.kind === "person" && one.left === undefined);

  // Where its papers stand, as the progress row counts them.
  const counts = { include: 0, maybe: 0, exclude: 0, conflict: 0 };
  for (const paper of live) if (paper.result && paper.result !== "waiting") counts[paper.result]++;
  if (JSON.stringify(counts) !== JSON.stringify({ include: 0, maybe: 0, exclude: 0, conflict: 0, ...progress.counts })) problems.push(`counts say ${JSON.stringify(progress.counts)}, the papers ${JSON.stringify(counts)}`);
  const reasons = Object.values(progress.reasons ?? {}).reduce((sum, n) => sum + n, 0);
  if (reasons !== counts.exclude) problems.push(`${reasons} reasons for ${counts.exclude} excluded papers`);

  // Each paper's card, which the Papers page lists and narrows by, says what the paper says.
  const cardOf = new Map(cards.map((card) => [card.resultId, card]));
  for (const paper of placed) {
    const card = cardOf.get(paper._id);
    const want = { result: paper.result ?? "waiting", sourceId: paper.sourceId, checkId: paper.checkId, reason: paper.reason, withdrawn: paper.withdrawn };
    if (!card) problems.push(`${paper.title}: has no card`);
    else if (JSON.stringify(want) !== JSON.stringify({ result: card.result, sourceId: card.sourceId, checkId: card.checkId, reason: card.reason, withdrawn: card.withdrawn })) problems.push(`${paper.title}: its card says ${card.result}${card.withdrawn ? ", withdrawn" : ""}, the paper ${want.result}${want.withdrawn ? ", withdrawn" : ""}`);
  }
  if (cards.length !== placed.length) problems.push(`${cards.length} cards for ${placed.length} papers`);

  // Each reviewer's votes, as the progress row counts them, and the papers their row says they hold.
  for (const reviewer of reviewers) {
    const mine = votes.filter((vote) => vote.reviewerId === reviewer._id);
    const cast = mine.filter((vote) => vote.status === "cast" && liveIds.has(vote.resultId));
    const kept = progress.reviewers?.[reviewer._id];
    if ((kept?.cast ?? 0) !== cast.length) problems.push(`${names.get(reviewer._id)}: counted ${kept?.cast ?? 0} votes, has ${cast.length}`);
    for (const decision of DECISIONS) if ((kept?.[decision] ?? 0) !== cast.filter((vote) => vote.decision === decision).length) problems.push(`${names.get(reviewer._id)}: counted ${kept?.[decision] ?? 0} ${decision}, has ${cast.filter((vote) => vote.decision === decision).length}`);
    const holds = mine.filter((vote) => vote.status !== "discarded").length;
    if (reviewer.dealt !== holds) problems.push(`${names.get(reviewer._id)}: said to hold ${reviewer.dealt} papers, holds ${holds}`);
  }

  for (const paper of live) {
    const on = votes.filter((vote) => vote.resultId === paper._id);
    const result: Result = paper.result ?? "waiting";
    const ballots: Ballot[] = on.map((vote) => ({ status: vote.status, decision: vote.decision, at: vote.at, reason: vote.reason }));
    // A paper settled before the settings last changed keeps its result. Any other stands where its votes put it.
    const held = isFinal(result) && !paper.resolved && !paper.reopen && (paper.settledAt ?? 0) <= (job.heldAt ?? 0);
    const voted = paper.resolved ? paper.resolved.decision : settle(rule.settle, ballots);
    if (!held && result !== voted) problems.push(`${paper.title}: stands at ${result}, its votes say ${voted}`);
    const people = on.filter((vote) => byId.get(vote.reviewerId)?.kind === "person");
    const places = people.filter((vote) => vote.status === "waiting" || vote.status === "cast");
    const taken = people.filter((vote) => vote.status !== "discarded").map((vote) => vote.reviewerId);
    if (new Set(taken).size !== taken.length) problems.push(`${paper.title}: someone holds two places`);
    if (isFinal(result)) {
      if (people.some((vote) => vote.status === "waiting")) problems.push(`${paper.title}: settled, and still waits for someone`);
      continue;
    }
    for (const vote of people) if (vote.status === "waiting" && byId.get(vote.reviewerId)?.left !== undefined) problems.push(`${paper.title}: waits for ${names.get(vote.reviewerId)}, who left`);
    // A split under "everyone agrees" can't become agreement: it keeps the places it had, and its resolver settles it.
    if (result === "conflict" && rule.settle === "all") continue;
    // An open paper has the places its rule asks for: its votes, and the people still to vote up to the rule's number.
    const cast = places.filter((vote) => vote.status === "cast");
    const free = active.filter((one) => !cast.some((vote) => vote.reviewerId === one._id)).length;
    const asked = cast.length + Math.min(free, Math.max(0, (rule.each === "all" ? Infinity : rule.each) - cast.length));
    if (places.length !== asked) problems.push(`${paper.title}: ${places.length} places (${places.map((vote) => `${names.get(vote.reviewerId)} ${vote.status}`).join(", ")}), its rule asks for ${asked}`);
  }

  // How far each pair agrees, counted again from their votes.
  const order = new Map(reviewers.map((one, at) => [one._id, at]));
  const matrices = new Map<string, number[]>();
  for (const paper of live) {
    const cast = votes.filter((vote) => vote.resultId === paper._id && vote.status === "cast" && vote.decision);
    for (const [i, x] of cast.entries()) for (const y of cast.slice(i + 1)) {
      const [a, b] = order.get(x.reviewerId)! <= order.get(y.reviewerId)! ? [x, y] : [y, x];
      const key = `${a.reviewerId}:${b.reviewerId}`;
      const cells = matrices.get(key) ?? matrices.set(key, Array.from({ length: 9 }, () => 0)).get(key)!;
      cells[DECISIONS.indexOf(a.decision!) * 3 + DECISIONS.indexOf(b.decision!)]!++;
    }
  }
  for (const pair of pairs) {
    const counted = matrices.get(`${pair.a}:${pair.b}`) ?? Array.from({ length: 9 }, () => 0);
    if (pair.matrix.join() !== counted.join()) problems.push(`${names.get(pair.a)} and ${names.get(pair.b)}: agreement kept as ${pair.matrix.join()}, their votes give ${counted.join()}`);
    matrices.delete(`${pair.a}:${pair.b}`);
  }
  for (const [key, counted] of matrices) if (counted.some((n) => n > 0)) problems.push(`a pair's agreement isn't kept: ${key}`);

  // The counts Papers narrows by (./facets.ts), against the cards and votes: a moment behind the writes, so read once they settle.
  const tally = (results: Result[]): Tally => ({ include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0, ...Object.fromEntries((["include", "maybe", "exclude", "conflict", "waiting"] as const).map((result) => [result, results.filter((one) => one === result).length])) });
  const liveCards = cards.filter((card) => !card.withdrawn);
  for (const sourceId of new Set(liveCards.flatMap((card) => (card.sourceId ? [card.sourceId] : [])))) {
    const [counted, read] = [await tallyUnder(ctx, jobId, { source: sourceId }), tally(liveCards.filter((card) => card.sourceId === sourceId).map((card) => card.result))];
    if (JSON.stringify(counted) !== JSON.stringify(read)) problems.push(`source ${sourceId}: counted ${JSON.stringify(counted)}, its papers ${JSON.stringify(read)}`);
  }
  for (const reviewer of reviewers) {
    const on = votes.filter((vote) => vote.reviewerId === reviewer._id && (vote.status === "waiting" || vote.status === "cast" || vote.status === "failed")).flatMap((vote) => {
      const card = cardOf.get(vote.resultId);
      return card && !card.withdrawn && card.result ? [card.result] : [];
    });
    const counted = await tallyOfReviewer(ctx, reviewer._id, ["include", "maybe", "exclude", "cast", "waiting", "failed"]);
    if (JSON.stringify(counted) !== JSON.stringify(tally(on))) problems.push(`${names.get(reviewer._id)}: counted on ${JSON.stringify(counted)}, their papers ${JSON.stringify(tally(on))}`);
  }

  const cast = Object.fromEntries(reviewers.map((one) => [names.get(one._id)!, progress.reviewers?.[one._id]?.cast ?? 0]));
  return { problems, cast, stands: Object.fromEntries(placed.map((paper) => [paper._id, paper.withdrawn ? "withdrawn" : (paper.result ?? "waiting")])) as Record<string, string> };
}

/** What doesn't add up in one screening; an empty list when its rows agree. */
export const check = internalQuery({
  args: { jobId: v.id("screeningJobs") },
  returns: v.array(v.string()),
  handler: async (ctx, { jobId }) => (await auditJob(ctx, jobId)).problems,
});
