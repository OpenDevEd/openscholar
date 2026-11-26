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
    await settleAll(made.t);
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
    // Taken back, it is in her queue like any paper given to her: with the number the order by the models' votes reads.
    await voter(made, one.jobId)("cat", one.papers[0]!._id, null);
    await settleAll(made.t);
    expect(await made.t.run(async (ctx) => (await ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", one.papers[0]!._id)).collect()).map(({ status, lean }) => ({ status, lean })))).toEqual([{ status: "waiting", lean: 0 }]);
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
