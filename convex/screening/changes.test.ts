// Changing a running screening (plans/screening-reviewers): every rule against every change made mid-course.
// After each change the screening's rows are audited against one another (counts, tallies, places, results), and
// what the change was said to do before it was made is compared with what it then did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { isFinal, settle, type Ballot, type Result } from "../../lib/screening/rules";
import { runAll, settleAll, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type T = Team["t"];
type Each = number | "all";
type Settle = "all" | "most" | "one";
const DECISIONS = ["include", "maybe", "exclude"] as const;
const PAPERS = 9;

const run = (t: T) => runAll(t, vi.runAllTimers);

/** A screening's rows, checked against one another. Returns what doesn't add up, and where each paper stands. */
async function audit(t: T, jobId: Id<"screeningJobs">) {
  return t.run(async (ctx) => {
    const job = (await ctx.db.get("screeningJobs", jobId))!;
    const rule = job.rule!;
    const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const byId = new Map(reviewers.map((one) => [one._id, one]));
    const names = new Map(await Promise.all(reviewers.map(async (one) => [one._id, one.userId ? (await ctx.db.get("users", one.userId))!.clerkId : "a model"] as const)));
    const papers = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const votes = await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).collect();
    const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())!;
    const pairs = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).collect();
    const problems: string[] = [];
    const live = papers.filter((paper) => !paper.withdrawn);
    const liveIds = new Set(live.map((paper) => paper._id));
    const active = reviewers.filter((one) => one.kind === "person" && one.left === undefined);

    // Where its papers stand, as the progress row counts them.
    const counts = { include: 0, maybe: 0, exclude: 0, conflict: 0 };
    for (const paper of live) if (paper.result && paper.result !== "waiting") counts[paper.result]++;
    if (JSON.stringify(counts) !== JSON.stringify({ include: 0, maybe: 0, exclude: 0, conflict: 0, ...progress.counts })) problems.push(`counts say ${JSON.stringify(progress.counts)}, the papers ${JSON.stringify(counts)}`);
    const reasons = Object.values(progress.reasons ?? {}).reduce((sum, n) => sum + n, 0);
    if (reasons !== counts.exclude) problems.push(`${reasons} reasons for ${counts.exclude} excluded papers`);

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
        const cells = matrices.get(`${a.reviewerId}:${b.reviewerId}`) ?? matrices.set(`${a.reviewerId}:${b.reviewerId}`, Array.from({ length: 9 }, () => 0)).get(`${a.reviewerId}:${b.reviewerId}`)!;
        cells[DECISIONS.indexOf(a.decision!) * 3 + DECISIONS.indexOf(b.decision!)]!++;
      }
    }
    for (const pair of pairs) {
      const counted = matrices.get(`${pair.a}:${pair.b}`) ?? Array.from({ length: 9 }, () => 0);
      if (pair.matrix.join() !== counted.join()) problems.push(`${names.get(pair.a)} and ${names.get(pair.b)}: agreement kept as ${pair.matrix.join()}, their votes give ${counted.join()}`);
      matrices.delete(`${pair.a}:${pair.b}`);
    }
    for (const [key, counted] of matrices) if (counted.some((n) => n > 0)) problems.push(`a pair's agreement isn't kept: ${key}`);

    const cast = Object.fromEntries(reviewers.map((one) => [names.get(one._id)!, progress.reviewers?.[one._id]?.cast ?? 0]));
    return { problems, cast, stands: Object.fromEntries(papers.map((paper) => [paper._id, paper.withdrawn ? "withdrawn" : (paper.result ?? "waiting")])) as Record<string, string> };
  });
}

/** Votes on a screening's papers in a fixed pattern: every holder includes one, the first two split on the next, and one alone votes Maybe on the third. */
async function voteAround({ t, as, workspaceId }: Team, jobId: Id<"screeningJobs">) {
  const { papers, holders } = await t.run(async (ctx) => {
    const papers = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const votes = await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).collect();
    const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const names = new Map(await Promise.all(reviewers.map(async (one) => [one._id, (await ctx.db.get("users", one.userId!))!.clerkId] as const)));
    return { papers: papers.map((paper) => paper._id), holders: Object.fromEntries(papers.map((paper) => [paper._id, votes.filter((vote) => vote.resultId === paper._id && vote.status === "waiting").map((vote) => names.get(vote.reviewerId)!)])) };
  });
  const vote = (name: string, paperId: Id<"screeningResults">, decision: (typeof DECISIONS)[number]) => as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
  for (const [i, paperId] of papers.entries()) {
    const on = holders[paperId] ?? [];
    if (i % 3 === 0) for (const name of on) await vote(name, paperId, "include");
    else if (i % 3 === 1) for (const [k, name] of on.slice(0, 2).entries()) await vote(name, paperId, k ? "exclude" : "include");
    else if (on[0]) await vote(on[0], paperId, "maybe");
    // Each vote is settled before the next is cast, as it is when people vote: under "the first vote decides", a second vote on a settled paper is refused.
    await settleAll(t);
  }
}

type Change = (typeof api.screening.settings.save)["_args"]["change"];
/** The changes made mid-course, each built for the screening as it stands. */
const CHANGES: Array<{ name: string; make: (made: Team, at: { ben: Id<"screeningReviewers">; each: Each; settle: Settle; criteria: NonNullable<Change["criteria"]> }) => Change | null }> = [
  { name: "one person a paper", make: (_, { each, settle }) => (each === 1 ? null : { rule: { each: 1, settle, blind: "after" } }) },
  { name: "two people a paper", make: (_, { each, settle }) => (each === 2 ? null : { rule: { each: 2, settle, blind: "after" } }) },
  { name: "everyone on each paper", make: (_, { each, settle }) => (each === "all" ? null : { rule: { each: "all", settle, blind: "after" } }) },
  { name: "settled when all agree", make: (_, { each, settle }) => (settle === "all" ? null : { rule: { each, settle: "all", blind: "after" } }) },
  { name: "settled when most agree", make: (_, { each, settle }) => (settle === "most" ? null : { rule: { each, settle: "most", blind: "after" } }) },
  { name: "the first vote decides", make: (_, { each, settle }) => (settle === "one" ? null : { rule: { each, settle: "one", blind: "after" } }) },
  { name: "a person joins", make: ({ ids }) => ({ addPeople: [ids.dan!] }) },
  { name: "a person is taken off, votes kept", make: (_, { ben }) => ({ remove: [{ reviewerId: ben }] }) },
  { name: "a person is taken off, votes thrown out", make: (_, { ben }) => ({ remove: [{ reviewerId: ben, discard: true }] }) },
  { name: "a criterion becomes a must-have", make: (_, { criteria }) => ({ criteria: criteria.map((criterion) => ({ ...criterion, must: true })) }) },
  { name: "another rule, with the settled papers checked again", make: (_, { each, settle }) => ({ rule: { each, settle: settle === "one" ? "all" : "one", blind: "after" }, recheck: true }) },
  { name: "a person joins and everyone reads every paper", make: ({ ids }, { settle }) => ({ addPeople: [ids.dan!], rule: { each: "all", settle, blind: "after" } }) },
];

describe.each((["all", "most", "one"] as const).flatMap((rule) => ([1, 2, "all"] as const).map((each) => ({ rule, each }))))("settled when $rule, $each on each paper", ({ rule, each }) => {
  it.each(CHANGES)("holds together through: $name", async ({ make }) => {
    const made = await team(["ann", "ben", "cat", "dan"]);
    const { jobId } = await started(made, ["ann", "ben", "cat"], PAPERS, { rule: { each, settle: rule, blind: "after" } });
    await run(made.t);
    await voteAround(made, jobId);
    await run(made.t);
    const before = await audit(made.t, jobId);
    expect(before.problems).toEqual([]);

    const at = await made.t.run(async (ctx) => {
      const job = (await ctx.db.get("screeningJobs", jobId))!;
      const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
      return { ben: reviewers.find((one) => one.userId === made.ids.ben)!._id, criteria: job.criteria!.map(({ key, text, short, must, terms, points }) => ({ key, text, short, must, terms, points })) };
    });
    const change = make(made, { ...at, each, settle: rule });
    if (!change) return;

    // What the change is said to do, before it is made.
    const said = await made.as.ann!.action(api.screening.effects.preview, { workspaceId: made.workspaceId, jobId, change });
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId: made.workspaceId, jobId, change });
    await run(made.t);
    const after = await audit(made.t, jobId);
    expect(after.problems).toEqual([]);

    // What it did: each paper that moved from one result to another, counted as the preview counts them.
    const moved = new Map<string, number>();
    for (const [paperId, was] of Object.entries(before.stands)) {
      const now = after.stands[paperId]!;
      if (now !== was) moved.set(`${was} to ${now}`, (moved.get(`${was} to ${now}`) ?? 0) + 1);
    }
    expect(Object.fromEntries(said.moves.map((move) => [`${move.from} to ${move.to}`, move.count]))).toEqual(Object.fromEntries(moved));

    // Whoever it put on the screening got the open papers it said they would, and whoever it took off had the votes it said they had.
    const dealt = await made.t.run(async (ctx) => {
      const dan = (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.userId === made.ids.dan);
      if (!dan) return null;
      const places = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", dan._id)).collect();
      return places.filter((vote) => !isFinal((after.stands[vote.resultId] ?? "waiting") as Result)).length;
    });
    expect(said.joining[made.ids.dan!]?.dealt ?? null).toEqual(change.addPeople ? dealt : null);
    if (change.remove) expect(said.leaving[at.ben]?.cast).toBe(before.cast.ben);
  });
});
