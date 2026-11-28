// Changing a running screening (plans/screening-reviewers): every rule against every change made mid-course.
// After each change the screening's rows are audited against one another (./audit.ts), and
// what the change was said to do before it was made is compared with what it then did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { isFinal, type Result } from "../../lib/screening/rules";
import { auditJob } from "./audit";
import { runAll, settleAll, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type T = Team["t"];
type Each = number | "all";
type Settle = "all" | "most" | "one";
const DECISIONS = ["include", "maybe", "exclude"] as const;
const PAPERS = 9;

const run = (t: T) => runAll(t, vi.runAllTimers);

const audit = (t: T, jobId: Id<"screeningJobs">) => t.run((ctx) => auditJob(ctx, jobId));

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
const CHANGES: Array<{ name: string; /** A change saved first, that this one follows. */ first?: (made: Team, at: { ben: Id<"screeningReviewers"> }) => Change; make: (made: Team, at: { ben: Id<"screeningReviewers">; each: Each; settle: Settle; criteria: NonNullable<Change["criteria"]> }) => Change | null }> = [
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
  { name: "a person taken off with their votes kept is put back", first: (_, { ben }) => ({ remove: [{ reviewerId: ben }] }), make: ({ ids }) => ({ addPeople: [ids.ben!] }) },
  { name: "a person joins and everyone reads every paper", make: ({ ids }, { settle }) => ({ addPeople: [ids.dan!], rule: { each: "all", settle, blind: "after" } }) },
];

describe.each((["all", "most", "one"] as const).flatMap((rule) => ([1, 2, "all"] as const).map((each) => ({ rule, each }))))("settled when $rule, $each on each paper", ({ rule, each }) => {
  it.each(CHANGES)("holds together through: $name", async ({ first, make }) => {
    const made = await team(["ann", "ben", "cat", "dan"]);
    const { jobId } = await started(made, ["ann", "ben", "cat"], PAPERS, { rule: { each, settle: rule, blind: "after" } });
    await run(made.t);
    await voteAround(made, jobId);
    await run(made.t);
    const benRow = await made.t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.userId === made.ids.ben)!._id);
    if (first) {
      await made.as.ann!.mutation(api.screening.settings.save, { workspaceId: made.workspaceId, jobId, change: first(made, { ben: benRow }) });
      await run(made.t);
    }
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
    // Dan is a member of the workspace with no paper of his own to vote on: no vote is kept from him, and he is told all of it. Ann still has papers to vote on, and is told less (below).
    const said = await made.as.dan!.action(api.screening.effects.preview, { workspaceId: made.workspaceId, jobId, change });
    const hers = await made.as.ann!.action(api.screening.effects.preview, { workspaceId: made.workspaceId, jobId, change });
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
    // The others' votes on the papers Ann has yet to vote on are kept from her: what the change does to those is not worked out for her, under any figure (./keeping.test.ts). Each move she is told of is one that happened, on a paper whose votes she sees.
    const told = hers.moves.filter((move) => move.count > move.hidden);
    for (const move of told) expect(moved.get(`${move.from} to ${move.to}`) ?? 0).toBeGreaterThanOrEqual(move.count);
    expect(hers.moves.every((move) => move.hidden === 0 || (move.from === "waiting" && move.to === "waiting" && move.hidden === move.count))).toBe(true);

    // Whoever it put on the screening, new or back again, got the open papers to vote on it said they would, and whoever it took off had the votes it said they had.
    const joiner = change.addPeople?.[0] ?? made.ids.dan!;
    const dealt = await made.t.run(async (ctx) => {
      const row = (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.userId === joiner);
      if (!row) return null;
      const places = await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", row._id).eq("status", "waiting")).collect();
      return places.filter((vote) => !isFinal((after.stands[vote.resultId] ?? "waiting") as Result)).length;
    });
    expect(said.joining[joiner]?.dealt ?? null).toEqual(change.addPeople ? dealt : null);
    if (change.remove) expect(said.leaving[at.ben]?.cast).toBe(before.cast.ben);
    // The fewest and the most papers a person is said to hold once it is saved are what the people on it hold.
    const held = await made.t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).filter((one) => one.kind === "person" && one.left === undefined).map((one) => one.dealt));
    expect(said.loads).toEqual({ least: Math.min(...held), most: Math.max(...held) });
  });
});
