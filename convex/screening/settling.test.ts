// A screening with reviewers (plans/screening-reviewers): papers are settled on their votes by the bookkeeping worker, under each rule.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { give, paper, settleAll, standingOf, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Decision = "include" | "maybe" | "exclude";
/** One person's vote on a paper, as its page casts it. */
const voter = ({ as, workspaceId }: Team, jobId: Id<"screeningJobs">) => (name: string, paperId: Id<"screeningResults">, decision: Decision | null, more: { reason?: string } = {}) =>
  as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision, ...(decision === "exclude" ? { reason: more.reason ?? "other" } : {}) });

describe("a paper settled on its votes", () => {
  it("is included when both agree, in conflict when they don't, and settled by whoever settles conflicts", async () => {
    const made = await team(["ann", "ben"]);
    const { jobId, papers } = await started(made, ["ann", "ben"], 2);
    const vote = voter(made, jobId);
    const [first, second] = papers.map((one) => one._id) as [Id<"screeningResults">, Id<"screeningResults">];
    await vote("ann", first, "include");
    await settleAll(made.t);
    expect((await standingOf(made.t, jobId)).papers[0]).toMatchObject({ result: "waiting", on: { ann: "include", ben: "waiting" } });

    await vote("ben", first, "include");
    await vote("ann", second, "include");
    await vote("ben", second, "exclude");
    await settleAll(made.t);
    const split = await standingOf(made.t, jobId);
    expect(split.papers.map((one) => one.result)).toEqual(["include", "conflict"]);
    expect(split.counts).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1 });
    expect(split.reviewers.ann).toMatchObject({ dealt: 2, cast: 2, include: 2 });
    expect(split.reviewers.ben).toMatchObject({ dealt: 2, cast: 2, include: 1, exclude: 1 });
    // Ann by Ben: both included one, and Ann included one Ben excluded.
    expect(split.agreement).toHaveLength(1);
    expect(split.agreement[0]!.matrix).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0]);

    // Ben doesn't settle conflicts here: whoever started the screening does.
    await expect(made.as.ben!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: "include" })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const criterion = (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.criteria![0]!.key;
    await made.as.ann!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: "exclude", reason: criterion });
    await settleAll(made.t);
    const settled = await standingOf(made.t, jobId);
    expect(settled.papers[1]).toMatchObject({ result: "exclude", reason: criterion });
    expect(settled.counts).toEqual({ include: 1, maybe: 0, exclude: 1, conflict: 0 });
    expect(settled.reasons).toEqual({ [criterion]: 1 });

    await made.as.ann!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: null });
    await settleAll(made.t);
    expect((await standingOf(made.t, jobId)).counts).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1 });
  });

  it("is settled by the first vote where the rule says so, and waits again when that vote is taken back", async () => {
    const made = await team(["ann", "ben"]);
    const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: 2, settle: "one", blind: "after" } });
    const vote = voter(made, jobId);
    await vote("ben", papers[0]!._id, "maybe");
    await settleAll(made.t);
    // Ann's place is closed: the paper waits for nobody.
    expect((await standingOf(made.t, jobId)).papers[0]).toMatchObject({ result: "maybe", on: { ann: "closed", ben: "maybe" } });
    await vote("ben", papers[0]!._id, null);
    await settleAll(made.t);
    const back = await standingOf(made.t, jobId);
    expect(back.papers[0]).toMatchObject({ result: "waiting", on: { ann: "waiting", ben: "waiting" } });
    expect(back.counts).toEqual({ include: 0, maybe: 0, exclude: 0, conflict: 0 });
    expect(back.reviewers.ben).toMatchObject({ cast: 0, maybe: 0 });
  });

  it("goes with most of three, and stays on a reviewer who votes on a paper that wasn't theirs", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { jobId, papers } = await started(made, ["ann", "ben", "cat"], 2, { rule: { each: "all", settle: "most", blind: "after" } });
    const vote = voter(made, jobId);
    await vote("ann", papers[0]!._id, "exclude");
    await vote("ben", papers[0]!._id, "exclude");
    await vote("cat", papers[0]!._id, "include");
    await settleAll(made.t);
    expect((await standingOf(made.t, jobId)).papers[0]).toMatchObject({ result: "exclude", reason: "other" });

    // One person a paper, and Cat votes on one that went to someone else: it is hers, and the place nobody voted from goes.
    const one = await started(made, ["ann", "ben", "cat"], 1, { rule: { each: 1, settle: "all", blind: "after" } });
    expect(Object.keys((await standingOf(made.t, one.jobId)).papers[0]!.on)).toEqual(["ann"]);
    await voter(made, one.jobId)("cat", one.papers[0]!._id, "include");
    await settleAll(made.t);
    const hers = await standingOf(made.t, one.jobId);
    expect(hers.papers[0]).toMatchObject({ result: "include", on: { cat: "include" } });
    expect(hers.reviewers.ann!.dealt).toBe(0);
    expect(hers.reviewers.cat!.dealt).toBe(1);
  });

  it("refuses a vote from someone who isn't one of its reviewers, and any vote once it is finished", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { jobId, papers } = await started(made, ["ann", "ben"], 1);
    const vote = voter(made, jobId);
    await expect(vote("cat", papers[0]!._id, "include")).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await made.as.cat!.mutation(api.screening.screenings.finish, { workspaceId: made.workspaceId, jobId });
    await expect(vote("ann", papers[0]!._id, "include")).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await made.as.ann!.mutation(api.screening.screenings.reopen, { workspaceId: made.workspaceId, jobId });
    await vote("ann", papers[0]!._id, "include");
  });
});

describe("papers from several sources", () => {
  it("leaves out a record with no abstract, and keeps a paper two sources hold in the first", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0, { sources: [{ set: { kind: "saved" }, name: "Saved papers" }, { set: { kind: "zotero" }, name: "My library" }], rule: { each: 1, settle: "all", blind: "after" } });
    await give(made.t, jobId, 0, [paper(1, { doi: "10.1234/A" }), { paper: "openalex:W2", title: "No abstract here" }, paper(3)]);
    // The same DOI under another key, the same title and year with no DOI, and a new one.
    await give(made.t, jobId, 1, [{ ...paper(9, { doi: "https://doi.org/10.1234/a" }), paper: "zotero:user:7:AAAA1111" }, { ...paper(3), paper: "zotero:user:7:BBBB2222" }, { ...paper(4), paper: "zotero:user:7:CCCC3333" }]);
    const rows = await made.t.run(async (ctx) => ({
      sources: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).map(({ taken, duplicates, left, state }) => ({ taken, duplicates, left, state })),
      left: (await ctx.db.query("screeningLeftOut").withIndex("by_job_and_why", (q) => q.eq("jobId", jobId)).collect()).map(({ name, why }) => ({ name, why })),
      papers: (await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).map((one) => one.title),
    }));
    expect(rows.sources).toEqual([{ taken: 2, duplicates: 0, left: 1, state: "done" }, { taken: 1, duplicates: 2, left: 0, state: "done" }]);
    expect(rows.left).toEqual([{ name: "No abstract here", why: "abstract" }]);
    expect(rows.papers).toEqual(["Paper 1", "Paper 3", "Paper 4"]);
  });
});
