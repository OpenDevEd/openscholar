// How the other reviewers voted is kept from a reviewer who still has papers to vote on (./view.ts `keepsVotes`): in their counts and in how far they agree.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { settleAll, started, team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("says how far the others are and not how they voted until the person has voted on every paper of theirs, unless votes show at any time", async () => {
  const made = await team(["ann", "ben"]);
  const { workspaceId } = made;
  const { jobId, papers } = await started(made, ["ann", "ben"], 2);
  const vote = (name: string, paperId: Id<"screeningResults">, decision: "include" | "exclude") => made.as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
  const seenBy = async (name: string) => {
    const view = (await made.as[name]!.query(api.screening.view.get, { workspaceId, jobId }))!;
    const figures = (await made.as[name]!.query(api.screening.view.figures, { workspaceId, jobId, since: 0 }))!;
    return { others: view.reviewers.filter((one) => one.id !== made.ids[name]).map(({ cast, include, exclude, kept }) => ({ cast, include, exclude, kept })), mine: view.reviewers.filter((one) => one.id === made.ids[name]).map(({ cast, include, exclude, kept }) => ({ cast, include, exclude, kept })), pairs: figures.pairs.length };
  };
  // Ann votes on both papers, Ben on the first.
  await vote("ann", papers[0]!._id, "include");
  await vote("ann", papers[1]!._id, "exclude");
  await vote("ben", papers[0]!._id, "include");
  await settleAll(made.t);

  // Ben has a paper left: he sees that Ann voted twice, not how, and no agreement. His own counts are his.
  expect(await seenBy("ben")).toEqual({ others: [{ cast: 2, include: 0, exclude: 0, kept: true }], mine: [{ cast: 1, include: 1, exclude: 0, kept: undefined }], pairs: 0 });
  // Ann has none left: she sees how Ben voted, and how far the two agree.
  expect(await seenBy("ann")).toEqual({ others: [{ cast: 1, include: 1, exclude: 0, kept: undefined }], mine: [{ cast: 2, include: 1, exclude: 1, kept: undefined }], pairs: 1 });

  // Once Ben has voted on his last paper, nothing is kept from him.
  await vote("ben", papers[1]!._id, "include");
  await settleAll(made.t);
  expect(await seenBy("ben")).toMatchObject({ others: [{ cast: 2, include: 1, exclude: 1, kept: undefined }], pairs: 1 });

  // A finished screening keeps nothing either: Ben can't vote on his last paper any more, so nothing would ever open it for him.
  const done = await started(made, ["ann", "ben"], 2);
  await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId: done.jobId, paperId: done.papers[0]!._id, decision: "include" });
  await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId: done.jobId, paperId: done.papers[1]!._id, decision: "include" });
  await settleAll(made.t);
  const before = (await made.as.ben!.query(api.screening.paperViews.paper, { workspaceId, jobId: done.jobId, paperId: done.papers[0]!._id }))!;
  expect(before.sees).toBe(false);
  await made.as.ann!.mutation(api.screening.screenings.finish, { workspaceId, jobId: done.jobId });
  const closed = (await made.as.ben!.query(api.screening.view.get, { workspaceId, jobId: done.jobId }))!;
  expect(closed.reviewers.find((one) => one.id === made.ids.ann)).toMatchObject({ cast: 2, include: 2 });
  expect((await made.as.ben!.query(api.screening.paperViews.paper, { workspaceId, jobId: done.jobId, paperId: done.papers[0]!._id }))!.sees).toBe(true);

  // A screening that shows votes at any time keeps nothing, whoever has papers left.
  const open = await started(made, ["ann", "ben"], 2, { rule: { each: 2, settle: "all", blind: "always" } });
  await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId: open.jobId, paperId: open.papers[0]!._id, decision: "include" });
  await settleAll(made.t);
  const view = (await made.as.ben!.query(api.screening.view.get, { workspaceId, jobId: open.jobId }))!;
  expect(view.reviewers.find((one) => one.id === made.ids.ann)).toMatchObject({ cast: 1, include: 1 });
});

it("orders, narrows, finds and previews nothing by votes that are kept from the person", async () => {
  const made = await team(["ann", "ben", "cat"]);
  const { workspaceId } = made;
  const { jobId, papers } = await started(made, ["ann", "ben", "cat"], 3, { rule: { each: "all", settle: "all", blind: "after" } });
  const [p1, p2, p3] = papers.map((one) => one._id) as [Id<"screeningResults">, Id<"screeningResults">, Id<"screeningResults">];
  const vote = (name: string, paperId: Id<"screeningResults">, decision: "include" | "exclude") => made.as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
  // Ann and Cat have voted on everything and split on the third paper. Ben has voted on the first only: the other two are kept from him.
  for (const [name, on, how] of [["ann", p1, "include"], ["ann", p2, "exclude"], ["ann", p3, "include"], ["cat", p1, "include"], ["cat", p2, "exclude"], ["cat", p3, "exclude"], ["ben", p1, "include"]] as const) await vote(name, on, how);
  await settleAll(made.t);
  const list = (name: string, more: Record<string, unknown>) => made.as[name]!.query(api.screening.paperViews.list, { workspaceId, jobId, paginationOpts: { cursor: null, numItems: 10 }, ...more });
  const ids = async (name: string, more: Record<string, unknown>) => (await list(name, more)).page.map((one) => one.id);

  // Most divided first puts the third paper on top for someone who sees every vote, and tells Ben nothing: his come as they were added.
  expect((await ids("ann", { sort: "split" }))[0]).toBe(p3);
  expect(await ids("ben", { sort: "split" })).toEqual([p1, p2, p3]);
  expect(await ids("ben", { sort: "points" })).toEqual(await ids("ben", { sort: "added" }));

  // Ann's papers by how she voted: Ben is given the one he has voted on, and no page that the kept ones would have filled.
  expect(await list("ben", { reviewer: made.ids.ann, voted: "include" })).toMatchObject({ page: [{ id: p1 }], isDone: true });
  expect(await list("ben", { reviewer: made.ids.ann, voted: "exclude" })).toMatchObject({ page: [], isDone: true });
  expect(await ids("ann", { reviewer: made.ids.cat, voted: "exclude" })).toEqual(expect.arrayContaining([p2, p3]));
  // Found by its words, a paper is still kept to the reviewer and the vote asked for.
  expect(await ids("ben", { reviewer: made.ids.ann, voted: "exclude", text: "Paper" })).toEqual([]);
  expect(await ids("ben", { reviewer: made.ids.ann, voted: "include", text: "Paper" })).toEqual([p1]);
  expect(await ids("ann", { reviewer: made.ids.cat, voted: "exclude", text: "Paper" })).toEqual(expect.arrayContaining([p2, p3]));

  // What a change of rule would move: for Ben, the kept papers are counted under no result.
  const preview = await made.as.ben!.action(api.screening.effects.preview, { workspaceId, jobId, change: { rule: { each: "all", settle: "one", blind: "after" } } });
  const kept = preview.moves.filter((move) => move.hidden > 0);
  expect(kept.length).toBeGreaterThan(0);
  for (const move of kept) expect(move).toMatchObject({ from: "waiting", to: "waiting", papers: [] });
  expect(preview.moves.filter((move) => move.from !== move.to).every((move) => move.hidden === 0)).toBe(true);
});

it("tells a reviewer the same thing whichever way the votes kept from them went", async () => {
  const made = await team(["ann", "ben", "cat"]);
  const { workspaceId } = made;
  // Two screenings alike, of one paper Ben has yet to vote on: in the first Ann and Cat agree on it, in the second they split.
  const seen = async (cats: "include" | "exclude") => {
    const { jobId, papers } = await started(made, ["ann", "ben", "cat"], 1, { rule: { each: "all", settle: "all", blind: "after" } });
    const vote = (name: string, decision: "include" | "exclude") => made.as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: papers[0]!._id, decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
    await vote("ann", "include");
    await vote("cat", cats);
    await settleAll(made.t);
    const ben = (await made.t.run((ctx) => ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", made.ids.ben!)).first()))!._id;
    // Cat's papers by one way of voting: what comes back, and whether another page follows.
    const listed = await Promise.all((["include", "exclude"] as const).map(async (voted) => { const read = await made.as.ben!.query(api.screening.paperViews.list, { workspaceId, jobId, reviewer: made.ids.cat, voted, paginationOpts: { cursor: null, numItems: 10 } }); return { papers: read.page.length, isDone: read.isDone }; }));
    // What taking himself off would do: whether the paper is then settled on the others' votes says whether they agree.
    const preview = await made.as.ben!.action(api.screening.effects.preview, { workspaceId, jobId, change: { remove: [{ reviewerId: ben }] } });
    const { settled, waiting } = preview.leaving[ben]!;
    return { listed, reopened: preview.reopened, settled, waiting, moves: preview.moves.map(({ from, to, count, hidden, papers: named }) => ({ from, to, count, hidden, named: named.length })) };
  };
  expect(await seen("include")).toEqual(await seen("exclude"));
});

it("keeps from a reviewer only what could give a vote away: a paper nobody else voted on is worked out, and a change that only adds papers moves none", async () => {
  const made = await team(["ann", "ben", "cat"]);
  const { workspaceId } = made;
  // Three papers Ben has yet to vote on. Ann has voted on the first only.
  const { jobId, papers } = await started(made, ["ann", "ben", "cat"], 3, { rule: { each: "all", settle: "all", blind: "after" } });
  await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: papers[0]!._id, decision: "include" });
  await settleAll(made.t);
  const sourceId = (await made.t.run((ctx) => ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first()))!._id;
  const moves = async (change: (typeof api.screening.effects.preview)["_args"]["change"]) => (await made.as.ben!.action(api.screening.effects.preview, { workspaceId, jobId, change })).moves.map(({ from, to, count, hidden }) => ({ from, to, count, hidden }));
  // Another rule can move the one paper Ann voted on: it is counted, under no result. The two nobody voted on stay where they are, and are not counted as his to wait for.
  expect(await moves({ rule: { each: "all", settle: "one", blind: "after" } })).toEqual([{ from: "waiting", to: "waiting", count: 1, hidden: 1 }]);
  // More papers from a source move none of the papers the screening has.
  expect(await moves({ ranges: [{ sourceId, first: 1, last: 10 }] })).toEqual([]);
});

it("shows a model's vote before the person votes where the models only advise, and keeps the people's", async () => {
  const made = await team(["ann", "ben"]);
  const { workspaceId } = made;
  const seen = async (models: "vote" | "advice") => {
    const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: 2, settle: "all", blind: "after", models } });
    const paperId = papers[0]!._id;
    const modelId = await made.t.run(async (ctx) => {
      const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
      await ctx.db.insert("screeningVotes", { jobId, resultId: paperId, reviewerId, place: 0, status: "cast", decision: "exclude", reason: "other", at: 1 });
      return reviewerId;
    });
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision: "include" });
    await settleAll(made.t);
    const paper = (await made.as.ben!.query(api.screening.paperViews.paper, { workspaceId, jobId, paperId }))!;
    const of = (id: string) => paper.cast.find((one) => one.reviewer === id)!;
    return { sees: paper.sees, model: of(modelId).vote?.decision ?? (of(modelId).hidden ? "hidden" : null), ann: of(made.ids.ann!).vote?.decision ?? (of(made.ids.ann!).hidden ? "hidden" : null) };
  };
  expect(await seen("advice")).toEqual({ sees: false, model: "exclude", ann: "hidden" });
  expect(await seen("vote")).toEqual({ sees: false, model: "hidden", ann: "hidden" });
});
