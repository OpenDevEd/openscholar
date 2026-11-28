// A screening with reviewers (plans/screening-reviewers): papers are settled on their votes by the bookkeeping worker, under each rule.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { give, paper, papersOf, runAll, settleAll, standingOf, started, team, type Team } from "./reviewers.test-support";

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
    // An extraction, or another screening, that takes this one's included papers finds them by the old name.
    expect((await papersOf(made.t, jobId)).map((one) => one.outcome)).toEqual(["included", undefined]);
    const revision = () => made.t.run(async (ctx) => (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())?.exportRevision ?? 0);
    const included = await revision();
    expect(included).toBeGreaterThan(0);
    expect(split.reviewers.ann).toMatchObject({ dealt: 2, cast: 2, include: 2 });
    expect(split.reviewers.ben).toMatchObject({ dealt: 2, cast: 2, include: 1, exclude: 1 });
    // Ann by Ben: both included one, and Ann included one Ben excluded.
    expect(split.agreement).toHaveLength(1);
    expect(split.agreement[0]!.matrix).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0]);
    // Ann started it, so its conflicts are hers to settle: she is told one waits.
    expect(await made.t.run((ctx) => ctx.db.query("screeningNotices").collect())).toMatchObject([{ userId: made.ids.ann, off: false, conflictsAt: expect.any(Number) }]);

    // Ben doesn't settle conflicts here: whoever started the screening does.
    await expect(made.as.ben!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: "include" })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const criterion = (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.criteria![0]!.key;
    await made.as.ann!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: "exclude", reason: criterion });
    // The reasons are counted a moment after the papers: once that has run.
    await runAll(made.t, vi.runAllTimers);
    const settled = await standingOf(made.t, jobId);
    expect(settled.papers[1]).toMatchObject({ result: "exclude", reason: criterion });
    expect(settled.counts).toEqual({ include: 1, maybe: 0, exclude: 1, conflict: 0 });
    expect(settled.reasons).toEqual({ [criterion]: 1 });

    await made.as.ann!.mutation(api.screening.voting.resolve, { workspaceId: made.workspaceId, jobId, paperId: second, decision: null });
    await settleAll(made.t);
    expect((await standingOf(made.t, jobId)).counts).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1 });
    // An extraction under way takes the included papers: a paper that moved between the other results is no change to it.
    expect(await revision()).toBe(included);
  });

  it("is settled by the first vote where the rule says so, and waits again when that vote is taken back", async () => {
    const made = await team(["ann", "ben"]);
    // Asked for two people on each paper, it is given one: a second would read it for nothing.
    const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: 2, settle: "one", blind: "after" } });
    const vote = voter(made, jobId);
    await vote("ben", papers[0]!._id, "maybe");
    await settleAll(made.t);
    // Ann's place is closed: the paper waits for nobody.
    expect((await standingOf(made.t, jobId)).papers[0]).toMatchObject({ result: "maybe", on: { ann: "closed", ben: "maybe" } });
    await vote("ben", papers[0]!._id, null);
    await settleAll(made.t);
    const back = await standingOf(made.t, jobId);
    // Ben voted on Ann's paper: taking the vote back leaves it with her alone.
    expect(back.papers[0]).toMatchObject({ result: "waiting" });
    expect(back.papers[0]!.on).toEqual({ ann: "waiting" });
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
    // Taken back, it is in her queue like any paper given to her: with the number the order by the models' votes reads.
    await voter(made, one.jobId)("cat", one.papers[0]!._id, null);
    await settleAll(made.t);
    expect(await made.t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", one.papers[0]!._id)).collect()).map(({ status, lean }) => ({ status, lean })))).toEqual([{ status: "waiting", lean: 0 }]);
  });

  it("takes an exclusion with no reason, and counts it as no reason given, not as another reason", async () => {
    const made = await team(["ann"]);
    const { jobId, papers } = await started(made, ["ann"], 1, { rule: { each: 1, settle: "one", blind: "after" } });
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId: made.workspaceId, jobId, paperId: papers[0]!._id, decision: "exclude" });
    await runAll(made.t, vi.runAllTimers);
    const settled = await standingOf(made.t, jobId);
    expect(settled.papers[0]).toMatchObject({ result: "exclude", reason: "unstated" });
    expect(settled.reasons).toEqual({ unstated: 1 });

    // Two exclusions with no reason and one for a duplicate: most gave none, so it is counted as none.
    const three = await team(["cat", "dan", "eve"]);
    const shared = await started(three, ["cat", "dan", "eve"], 1, { rule: { each: 3, settle: "all", blind: "after" } });
    const exclude = (name: string, reason?: string) => three.as[name]!.mutation(api.screening.voting.vote, { workspaceId: three.workspaceId, jobId: shared.jobId, paperId: shared.papers[0]!._id, decision: "exclude", ...(reason ? { reason } : {}) });
    await exclude("cat");
    await exclude("dan");
    await exclude("eve", "duplicate");
    await settleAll(three.t);
    expect((await standingOf(three.t, shared.jobId)).papers[0]).toMatchObject({ result: "exclude", reason: "unstated" });
  });

  it("refuses a vote from someone who isn't one of its reviewers, and any vote once it is finished", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { jobId, papers } = await started(made, ["ann", "ben"], 1);
    const vote = voter(made, jobId);
    await expect(vote("cat", papers[0]!._id, "include")).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const toDo = async () => (await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId: made.workspaceId, jobId, queue: "todo", paginationOpts: { cursor: null, numItems: 10 } })).page.length;
    expect(await toDo()).toBe(1);
    await made.as.cat!.mutation(api.screening.screenings.finish, { workspaceId: made.workspaceId, jobId });
    await expect(vote("ann", papers[0]!._id, "include")).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    // Nothing is to do in a finished screening: its queue is as empty as its count.
    expect(await toDo()).toBe(0);
    await made.as.ann!.mutation(api.screening.screenings.reopen, { workspaceId: made.workspaceId, jobId });
    await vote("ann", papers[0]!._id, "include");
  });
});

describe("what a change takes out", () => {
  const run = (t: Team["t"]) => runAll(t, vi.runAllTimers);
  const slotsOf = ({ t, workspaceId }: Team) => t.run(async (ctx) => (await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())?.running);

  it("frees the slot of a reading that came back unread, and lets go of a model's unread places once it is taken off", async () => {
    const made = await team(["ann"]);
    const { jobId, papers } = await started(made, ["ann"], 2, { rule: { each: 1, settle: "all", blind: "after" } });
    const [first, second] = papers.map((one) => one._id) as [Id<"screeningResults">, Id<"screeningResults">];
    // A model on both papers. Its reading of the first came back unread, as when the screening is paused. Its reading of the second is still in the pool.
    const modelId = await made.t.run(async (ctx) => {
      const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 2 });
      await ctx.db.insert("screeningVotes", { jobId, resultId: first, reviewerId, place: 0, status: "waiting", slot: true });
      await ctx.db.insert("screeningVotes", { jobId, resultId: second, reviewerId, place: 1, status: "waiting", slot: true, workId: "in the pool" });
      await ctx.db.insert("screeningSlots", { workspaceId: made.workspaceId, running: 2 });
      return reviewerId;
    });
    const vote = voter(made, jobId);
    await vote("ann", first, "include");
    await vote("ann", second, "include");
    await settleAll(made.t);
    expect(await slotsOf(made)).toBe(1);
    expect((await standingOf(made.t, jobId)).papers.map((one) => one.result)).toEqual(["waiting", "waiting"]);

    await made.as.ann!.mutation(api.screening.reviewers.remove, { workspaceId: made.workspaceId, jobId, reviewerId: modelId });
    await run(made.t);
    const off = await standingOf(made.t, jobId);
    // Neither paper waits for the model any more. The reading in the pool keeps its row until it comes back.
    expect(off.papers.map((one) => one.result)).toEqual(["include", "include"]);
    expect(off.papers.map((one) => Object.keys(one.on).length)).toEqual([1, 2]);
    expect(await slotsOf(made)).toBe(1);

    await made.t.run(async (ctx) => {
      const row = (await ctx.db.query("screeningVotes").withIndex("by_workId", (q) => q.eq("workId", "in the pool")).unique())!;
      await ctx.db.patch("screeningVotes", row._id, { workId: undefined });
    });
    await vote("ann", second, "maybe");
    await settleAll(made.t);
    const back = await standingOf(made.t, jobId);
    expect(Object.keys(back.papers[1]!.on)).toEqual(["ann"]);
    expect(back.reviewers["model:undefined"]!.dealt).toBe(0);
    expect(await slotsOf(made)).toBe(0);
  });

  it("takes a removed source's papers out of every count, voted on or not", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann", "ben"], 0, { sources: [{ set: { kind: "saved" }, name: "Saved papers" }, { set: { kind: "zotero" }, name: "My library" }] });
    await give(made.t, jobId, 0, [paper(1), paper(2)]);
    const { sourceId, papers } = await give(made.t, jobId, 1, [{ ...paper(3), paper: "zotero:user:7:AAAA1111" }, { ...paper(4), paper: "zotero:user:7:BBBB2222" }]);
    await run(made.t);
    await voter(made, jobId)("ann", papers[2]!._id, "include");
    await settleAll(made.t);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { removeSources: [sourceId] } });
    await run(made.t);

    const after = await standingOf(made.t, jobId);
    expect(after.reviewers.ann).toMatchObject({ dealt: 2, cast: 0 });
    expect(after.reviewers.ben).toMatchObject({ dealt: 2, cast: 0 });
    expect(await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId })).toMatchObject({ total: 2, forYou: 2, counts: { waiting: 2 } });
    // Her vote on a paper that is gone is kept, and is in none of her lists, looked for by its words or not.
    expect((await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "done", paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
    expect((await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "done", text: "Paper 3", paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
    expect((await made.as.ann!.query(api.screening.paperViews.list, { workspaceId, jobId, paginationOpts: { cursor: null, numItems: 10 } })).page.map((one) => one.title)).toEqual(["Paper 1", "Paper 2"]);
  });

  it("brings a paper back when its source was taken out and another source holds it too, with the vote cast on it", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann", "ben"], 0, { sources: [{ set: { kind: "zotero" }, name: "My library" }] });
    const { sourceId, papers } = await give(made.t, jobId, 0, [{ ...paper(3), paper: "zotero:user:7:AAAA1111", doi: "10.1000/three" }, { ...paper(4), paper: "zotero:user:7:BBBB2222" }]);
    await run(made.t);
    await voter(made, jobId)("ann", papers[0]!._id, "include");
    await settleAll(made.t);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { removeSources: [sourceId] } });
    await run(made.t);
    expect(await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId })).toMatchObject({ total: 0 });

    // The library, added now, holds the first of them too, under its own key.
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "saved" }, name: "Saved papers" }] } });
    await give(made.t, jobId, 1, [{ ...paper(9), doi: "10.1000/three" }]);
    await run(made.t);
    const after = await standingOf(made.t, jobId);
    expect(after.reviewers.ann).toMatchObject({ dealt: 1, cast: 1, include: 1 });
    expect(after.reviewers.ben).toMatchObject({ dealt: 1, cast: 0 });
    expect(await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId })).toMatchObject({ total: 1, counts: { waiting: 1 } });
    expect((await made.as.ann!.query(api.screening.paperViews.list, { workspaceId, jobId, paginationOpts: { cursor: null, numItems: 10 } })).page.map((one) => one.title)).toEqual(["Paper 3"]);
  });

  it("lists no vote of someone whose votes were thrown out", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId, papers } = await started(made, ["ann", "ben"], 2);
    await run(made.t);
    await voter(made, jobId)("ben", papers[0]!._id, "include");
    await settleAll(made.t);
    const ben = await made.t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", made.ids.ben!)).unique())!._id);
    await made.as.ann!.mutation(api.screening.reviewers.remove, { workspaceId, jobId, reviewerId: ben, discard: true });
    await run(made.t);
    expect((await standingOf(made.t, jobId)).reviewers.ben).toMatchObject({ dealt: 0, cast: 0 });
    expect((await made.as.ann!.query(api.screening.paperViews.list, { workspaceId, jobId, reviewer: made.ids.ben!, voted: "include", paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
  });

  it("emails a person about the new papers a check gave them, and nobody it gave none", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann", "ben"], 2, { rule: { each: 1, settle: "all", blind: "after" } });
    await run(made.t);
    // A later check finds one paper the screening doesn't have: it goes to one of the two.
    await made.as.ann!.mutation(api.screening.living.checkNow, { workspaceId, jobId });
    await give(made.t, jobId, 0, [paper(1), paper(2), paper(3)]);
    await run(made.t);
    const about = (name: string) => made.t.query(internal.screening.notices.context, { jobId, userId: made.ids[name]!, about: "papers" });
    const counts = [(await about("ann"))?.count ?? 0, (await about("ben"))?.count ?? 0];
    expect(counts.toSorted()).toEqual([0, 1]);
  });

  it("takes back a selection's votes only where each is still the vote it cast, never one changed since", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId, papers } = await started(made, ["ann", "ben"], 2, { rule: { each: "all", settle: "all", blind: "after" } });
    await run(made.t);
    const ids = papers.map((one) => one._id);
    const { changed, at } = await made.as.ann!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: ids, decision: "include" });
    expect(changed).toHaveLength(2);
    // The same decision again on one of them, with a note: a newer vote, which Undo leaves alone.
    vi.advanceTimersByTime(1000);
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: ids[0]!, decision: "include", note: "Checked the full text" });
    const undone = await made.as.ann!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: ids, decision: null, onlyAt: at });
    expect(undone.changed).toEqual([ids[1]]);
    const votes = await made.t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", id)).collect()).find((one) => one.reviewerId !== undefined && one.status === "cast")?.note ?? null)));
    expect(votes).toEqual(["Checked the full text", null]);
  });

  it("counts the papers a screening started without as new ones: in its total, and emailed to whoever they went to", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    // Started with no source, its first look finds nothing. The source added later is read by a check of its own.
    const { jobId } = await started(made, ["ann", "ben"], 0, { sources: [], rule: { each: 1, settle: "all", blind: "after" } });
    await run(made.t);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "saved" }, name: "Saved papers" }] } });
    await give(made.t, jobId, 0, [paper(1), paper(2), paper(3)]);
    await run(made.t);
    expect(await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId })).toMatchObject({ total: 3 });
    const about = (name: string) => made.t.query(internal.screening.notices.context, { jobId, userId: made.ids[name]!, about: "papers" });
    expect(((await about("ann"))?.count ?? 0) + ((await about("ben"))?.count ?? 0)).toBe(3);
  });

  it("places the papers of every look after the ones the screening has, and counts them all", async () => {
    const made = await team(["ann"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann"], 2);
    await run(made.t);
    // A source added in Settings, and a check asked for while that look reads: the check is refused, as the papers are still arriving, and the one look places them after the papers there are.
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "saved" }, name: "Saved papers" }] } });
    await expect(made.as.ann!.mutation(api.screening.living.checkNow, { workspaceId, jobId })).rejects.toThrow(/still arriving/);
    await give(made.t, jobId, 1, [paper(7), paper(8), paper(9)]);
    await run(made.t);
    const { job, places, running } = await made.t.run(async (ctx) => ({
      job: (await ctx.db.get("screeningJobs", jobId))!,
      places: (await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).map((one) => one.place),
      running: (await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", jobId).eq("state", "running")).collect()).length,
    }));
    expect(job.totalPapers).toBe(5);
    expect(new Set(places).size).toBe(places.length);
    expect(running).toBe(0);
  });

  it("counts a check for new papers as a later search, and not a save that reads a source it adds", async () => {
    const made = await team(["ann"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann"], 1);
    await run(made.t);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "saved" }, name: "Saved papers" }] } });
    await give(made.t, jobId, 1, [paper(5)]);
    await run(made.t);
    const later = async () => (await made.as.ann!.query(api.screening.view.figures, { workspaceId, jobId, since: 0 }))!.checks;
    expect(await later()).toMatchObject({ later: 0, added: 0 });
    await made.as.ann!.mutation(api.screening.living.checkNow, { workspaceId, jobId });
    await give(made.t, jobId, 0, [paper(6)]);
    await run(made.t);
    expect(await later()).toMatchObject({ later: 1, added: 1 });
  });

  it("gives someone who joins their even share of the papers still waiting, however few", async () => {
    for (const [waiting, theirs] of [[1, 1], [2, 1], [3, 2], [5, 3]] as const) {
      const made = await team(["ann", "ben"]);
      const { workspaceId } = made;
      // One person on each paper, Ann alone: every paper is hers, and she votes on all but `waiting` of them.
      const { jobId, papers } = await started(made, ["ann"], 6, { rule: { each: 1, settle: "all", blind: "after" } });
      await run(made.t);
      const vote = voter(made, jobId);
      for (const one of papers.slice(waiting)) await vote("ann", one._id, "include");
      await run(made.t);
      await made.as.ann!.mutation(api.screening.reviewers.add, { workspaceId, jobId, personId: made.ids.ben! });
      await run(made.t);
      // Ben takes the first waiting paper and every second one after it: never none by chance.
      const held = await standingOf(made.t, jobId);
      expect([waiting, held.reviewers.ben?.dealt]).toEqual([waiting, theirs]);
      expect([waiting, held.reviewers.ann?.dealt]).toEqual([waiting, 6 - theirs]);
    }
  });

  it("takes someone who leaves the organization off its screenings, keeping their votes and giving their papers to the others", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { jobId, papers } = await started(made, ["ann", "ben", "cat"], 2, { rule: { each: 2, settle: "all", blind: "after" } });
    await run(made.t);
    const vote = voter(made, jobId);
    const benOn = (await standingOf(made.t, jobId)).papers.filter((one) => "ben" in one.on).map((one) => one.title);
    // Ben votes on one of his papers, then leaves the organization.
    const first = papers.find((one) => benOn.includes(one.title))!;
    await vote("ben", first._id, "include");
    await run(made.t);
    // Ben settles its conflicts too.
    await made.t.run(async (ctx) => { const job = (await ctx.db.get("screeningJobs", jobId))!; await ctx.db.patch("screeningJobs", jobId, { rule: { ...job.rule!, resolver: made.ids.ben! } }); });
    const organizationId = await made.t.run(async (ctx) => { const workspace = (await ctx.db.get("workspaces", made.workspaceId))!; if (workspace.kind !== "organization") throw new Error("not an organization"); return workspace.organizationId; });
    await made.t.mutation(internal.screening.reviewers.memberLeft, { organizationId, clerkUserId: "ben" });
    await run(made.t);
    // Its conflicts go to someone still on it, who can open it.
    const resolver = (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.rule!.resolver;
    expect([made.ids.ann, made.ids.cat]).toContain(resolver);
    const after = await standingOf(made.t, jobId);
    // His vote stays and counts; nothing waits for him any more.
    expect(after.papers.find((one) => one.title === first.title)?.on.ben).toBe("include");
    expect(after.papers.some((one) => one.on.ben === "waiting")).toBe(false);
  });

  it("hands its conflicts to someone still in the organization once its maker and its last reviewer have both left", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { jobId } = await started(made, ["ann", "ben"], 2, { rule: { each: 2, settle: "all", blind: "after" } });
    await run(made.t);
    const organizationId = await made.t.run(async (ctx) => { const workspace = (await ctx.db.get("workspaces", made.workspaceId))!; if (workspace.kind !== "organization") throw new Error("not an organization"); return workspace.organizationId; });
    const settler = async () => (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.rule!.resolver;
    // Leaving ends the membership, and then tells the screenings.
    const leaves = async (clerkUserId: string) => {
      await made.t.run(async (ctx) => { for (const one of await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", clerkUserId).eq("state", "active")).collect()) await ctx.db.patch("organizationMemberships", one._id, { state: "revoked" }); });
      await made.t.mutation(internal.screening.reviewers.memberLeft, { organizationId, clerkUserId });
      await run(made.t);
    };
    // Ann made it and settles it: she leaves, and Ben, reviewing it, settles it.
    await leaves("ann");
    expect(await settler()).toBe(made.ids.ben);
    // Ben leaves too: nobody reviews it, and Ann can't open it, so Cat settles it.
    await leaves("ben");
    expect(await settler()).toBe(made.ids.cat);
  });

  it("emails a colleague put on a screening, with the papers that wait for them or with none", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { workspaceId } = made;
    const { jobId } = await started(made, ["ann"], 2, { rule: { each: 2, settle: "all", blind: "after" } });
    await run(made.t);
    const joined = (name: string) => made.t.query(internal.screening.notices.context, { jobId, userId: made.ids[name]!, about: "joined", by: made.ids.ann! });
    // Nobody put Ben on it: there is nothing to tell him.
    expect(await joined("ben")).toBeNull();
    await made.as.ann!.mutation(api.screening.reviewers.add, { workspaceId, jobId, personId: made.ids.ben! });
    await run(made.t);
    // Each paper asks for two people and had one: both come to Ben, and the email says so and who added him.
    expect(await joined("ben")).toMatchObject({ count: 2, by: expect.any(String) });
    // Cat joins once both papers are settled: she is told she is on it, with no paper waiting yet.
    const vote = voter(made, jobId);
    for (const one of await papersOf(made.t, jobId)) { await vote("ann", one._id, "include"); await vote("ben", one._id, "include"); }
    await run(made.t);
    await made.as.ann!.mutation(api.screening.reviewers.add, { workspaceId, jobId, personId: made.ids.cat! });
    await run(made.t);
    expect(await joined("cat")).toMatchObject({ count: 0 });
    expect((await made.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((one) => one.name.includes("noticeMail") && (one.args[0] as { about?: string }).about === "joined")).toHaveLength(2);
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

describe("a record a screening read from a file", () => {
  it("is saved to the screening's collection when it is included, with what the file gave", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0, { rule: { each: 1, settle: "all", blind: "after" }, saveTo: { kind: "new", name: "Included in Tutoring" } });
    // A record of an uploaded export, which no index knows: its key is its place in the file.
    const { papers } = await give(made.t, jobId, 0, [{ paper: "upload:export.0", title: "A report no index knows", abstract: "What the report found." }]);
    await voter(made, jobId)("ann", papers[0]!._id, "include");
    await runAll(made.t, vi.runAllTimers);
    expect((await standingOf(made.t, jobId)).papers[0]).toMatchObject({ result: "include" });
    expect(await made.t.run((ctx) => ctx.db.query("libraryItems").collect())).toMatchObject([{ title: "A report no index knows", abstract: "What the report found." }]);
  });

  it("is saved with those included while the workspace had no room for the collection, once there is room", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0, { rule: { each: 1, settle: "all", blind: "after" }, saveTo: { kind: "new", name: "Included in Tutoring" } });
    // The plan takes one collection, and the workspace has it.
    const room = (count: number) => made.t.run(async (ctx) => {
      const counted = await ctx.db.query("collectionCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", made.workspaceId)).unique();
      if (counted) await ctx.db.patch("collectionCounts", counted._id, { count });
      else await ctx.db.insert("collectionCounts", { workspaceId: made.workspaceId, count });
      const account = await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", made.workspaceId)).unique();
      await ctx.db.patch("billingAccounts", account!._id, { limits: { collections: 1 } });
    });
    await room(1);
    const { papers } = await give(made.t, jobId, 0, [{ paper: "upload:export.0", title: "First included", abstract: "One." }, { paper: "upload:export.1", title: "Second included", abstract: "Two." }]);
    const vote = voter(made, jobId);
    await vote("ann", papers[0]!._id, "include");
    await runAll(made.t, vi.runAllTimers);
    expect(await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId))).toMatchObject({ libraryWriteProblem: "full" });
    // A collection deleted, the next paper included makes the screening's, and the one included before goes in it too.
    await room(0);
    await vote("ann", papers[1]!._id, "include");
    await runAll(made.t, vi.runAllTimers);
    const job = (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!;
    expect(job.libraryWriteProblem).toBeUndefined();
    const held = await made.t.run((ctx) => ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", job.targetCollectionId!)).collect());
    expect(held).toHaveLength(2);
  });
});

describe("the queue every screening's papers are settled from", () => {
  it("goes on with the other screenings when one screening's papers can't be settled", async () => {
    const made = await team(["ann"]);
    const [broken, sound] = [await started(made, ["ann"], 1, { rule: { each: 1, settle: "all", blind: "after" } }), await started(made, ["ann"], 1, { rule: { each: 1, settle: "all", blind: "after" } })];
    // A screening whose row of counts is gone can't be settled: its papers fail every time they are tried.
    await made.t.run(async (ctx) => ctx.db.delete("screeningJobProgress", (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", broken.jobId)).unique())!._id));
    // A model's reading of the broken one's paper has come back, and still holds one of the workspace's slots.
    await made.t.run(async (ctx) => {
      const reviewerId = await ctx.db.insert("screeningReviewers", { jobId: broken.jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
      await ctx.db.insert("screeningVotes", { jobId: broken.jobId, resultId: broken.papers[0]!._id, reviewerId, place: 0, status: "cast", decision: "include", slot: true });
      await ctx.db.insert("screeningSlots", { workspaceId: made.workspaceId, running: 1 });
    });
    await voter(made, broken.jobId)("ann", broken.papers[0]!._id, "include");
    await voter(made, sound.jobId)("ann", sound.papers[0]!._id, "include");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runAll(made.t, vi.runAllTimers);
    // The slot is back with the workspace: its other screenings' models are not kept waiting by this one.
    expect(await made.t.run(async (ctx) => (await ctx.db.query("screeningSlots").withIndex("by_workspace", (q) => q.eq("workspaceId", made.workspaceId)).unique())?.running)).toBe(0);
    // The other screening's paper is settled, and the broken one's is out of the queue as it stood.
    expect((await standingOf(made.t, sound.jobId)).papers[0]).toMatchObject({ result: "include" });
    expect(await made.t.run((ctx) => ctx.db.get("screeningResults", broken.papers[0]!._id))).toMatchObject({ result: "waiting" });
    expect((await made.t.run((ctx) => ctx.db.get("screeningResults", broken.papers[0]!._id)))!.doneAt).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("couldn't be bookkept"), expect.objectContaining({ jobId: broken.jobId }));
  });
});

describe("a reviewer taken off with their votes thrown out", () => {
  it("counts nothing of a model's reading that comes back after it was taken off", async () => {
    const made = await team(["ann"]);
    const { workspaceId } = made;
    const { jobId, papers } = await started(made, ["ann"], 1, { rule: { each: 1, settle: "one", blind: "after" } });
    const paperId = papers[0]!._id;
    const modelId = await made.t.run(async (ctx) => {
      const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
      await ctx.db.insert("screeningVotes", { jobId, resultId: paperId, reviewerId, place: 0, status: "waiting", workId: "late reading" });
      return reviewerId;
    });
    await made.as.ann!.mutation(api.screening.reviewers.remove, { workspaceId, jobId, reviewerId: modelId, discard: true });
    await runAll(made.t, vi.runAllTimers);
    // The reading in the pool comes back with answers: under "the first vote decides" a counted vote would settle the paper.
    await made.t.mutation(internal.screening.readings.done, { workId: "late reading", context: {}, result: { kind: "success", returnValue: { read: true, answers: {}, confidences: {}, credits: 3 } } } as never);
    await settleAll(made.t);
    const row = await made.t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", modelId)).collect())[0]!);
    expect(row).toMatchObject({ status: "discarded", credits: 3 });
    expect((await standingOf(made.t, jobId)).papers.map((one) => one.result)).toEqual(["waiting"]);
  });

  it("gives a person put back the places they had on the papers still open, without their old votes", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: "all", settle: "all", blind: "after" } });
    const paperId = papers[0]!._id;
    await voter(made, jobId)("ben", paperId, "include");
    await settleAll(made.t);
    const ben = await made.t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.userId === made.ids.ben)!._id);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { remove: [{ reviewerId: ben, discard: true }] } });
    await runAll(made.t, vi.runAllTimers);
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addPeople: [made.ids.ben!] } });
    await runAll(made.t, vi.runAllTimers);
    const row = await made.t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", ben)).collect())[0]!);
    expect(row).toMatchObject({ status: "waiting" });
    expect(row.decision).toBeUndefined();
    // Ann's include alone doesn't settle it: it waits for Ben again.
    await voter(made, jobId)("ann", paperId, "include");
    await settleAll(made.t);
    expect((await standingOf(made.t, jobId)).papers.map((one) => one.result)).toEqual(["waiting"]);
  });
});

describe("another screening's included papers as a source", () => {
  it("hands on a paper that is only its PDF with the PDF", async () => {
    const made = await team(["ann"]);
    const { jobId, papers } = await started(made, ["ann"], 1);
    const file = await made.t.run(async (ctx) => {
      const stored = await ctx.storage.store(new Blob(["%PDF-1.4"]));
      await ctx.db.patch("screeningResults", papers[0]!._id, { abstract: undefined, file: stored, pages: 3, outcome: "included" });
      return stored;
    });
    const read = await made.t.query(internal.paperSets.held.page, { userId: made.ids.ann!, workspaceId: made.workspaceId, set: { kind: "screening", jobId }, cursor: null, numItems: 10 });
    expect(read.page).toMatchObject([{ file, pages: 3 }]);
  });
});

describe("a search through a reviewer's queue", () => {
  it("finds every paper still to vote on, however many matching papers were voted on before them, the first within the reads one page takes", async () => {
    const made = await team(["ann"]);
    const { workspaceId } = made;
    const { jobId, papers } = await started(made, ["ann"], 230);
    // Most of the papers that match are voted on already: the few still to do come after a search's first batches.
    for (const one of papers.slice(0, 215)) await voter(made, jobId)("ann", one._id, "include");
    await settleAll(made.t);
    const found: string[] = [];
    let cursor: string | null = null;
    // The reads before the first paper shows: a page reads on past a short one, five reads at most (lib/hooks/use-cursor-page.ts).
    let firstShownAfter = 0;
    for (let reads = 1; reads <= 50; reads++) {
      const read: { page: Array<{ id: string }>; isDone: boolean; continueCursor: string } = await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "todo", text: "Paper", paginationOpts: { cursor, numItems: 10 } });
      found.push(...read.page.map((one) => one.id));
      if (read.page.length && !firstShownAfter) firstShownAfter = reads;
      if (read.isDone) break;
      cursor = read.continueCursor;
    }
    expect(new Set(found)).toEqual(new Set(papers.slice(215).map((one) => one._id)));
    expect(firstShownAfter).toBeGreaterThan(0);
    expect(firstShownAfter).toBeLessThanOrEqual(5);
  });
});

describe("a vote asked for again", () => {
  it("stays asked for while answers join it, and is answered by a new vote", async () => {
    // Ben hasn't voted, so the paper is still open when the criterion changes.
    const made = await team(["ann", "ben"]);
    const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: 2, settle: "all", blind: "after" } });
    const paperId = papers[0]!._id;
    await voter(made, jobId)("ann", paperId, "include");
    await runAll(made.t, vi.runAllTimers);
    // A criterion made a must-have asks for her vote again.
    const criteria = (await made.t.run((ctx) => ctx.db.get("screeningJobs", jobId)))!.criteria!.map(({ key, text, short, terms, points }) => ({ key, text, short, terms, points, must: true }));
    await made.as.ann!.mutation(api.screening.settings.save, { workspaceId: made.workspaceId, jobId, change: { criteria } });
    await runAll(made.t, vi.runAllTimers);
    const ann = await made.t.run(async (ctx) => (await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.userId === made.ids.ann)!._id);
    const flagged = () => made.t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).collect()).find((one) => one.reviewerId === ann)!.flagged);
    expect(await flagged()).toBe(true);
    const key = criteria[0]!.key;
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId: made.workspaceId, jobId, paperId, decision: "include", answers: { [key]: "yes" }, answersOnly: true });
    expect(await flagged()).toBe(true);
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId: made.workspaceId, jobId, paperId, decision: "include", answers: { [key]: "yes" } });
    expect(await flagged()).toBeFalsy();
  });
});
