// How many papers stand each way under what the Papers page is narrowed to (./paperViews.ts `counts`), counted from the papers' cards (./cards.ts).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { runAll, settleAll, started, team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("counts a source's papers and a reviewer's by where they stand, follows a paper as it is settled and as its source is taken out, and keeps another's votes from someone who still has papers to vote on", async () => {
  const made = await team(["ann", "ben"]);
  const { workspaceId } = made;
  const { jobId, papers } = await started(made, ["ann", "ben"], 3);
  const source = papers[0]!.sourceId!;
  const vote = (name: string, paperId: Id<"screeningResults">, decision: "include" | "exclude") => made.as[name]!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId, decision, ...(decision === "exclude" ? { reason: "other" } : {}) });
  const counts = (name: string, narrowed: object = {}) => made.as[name]!.query(api.screening.paperViews.counts, { workspaceId, jobId, ...narrowed });
  expect(await counts("ann", { source })).toEqual({ include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 3 });

  // The first is included by both, the second splits them, the third waits for Ben.
  await vote("ann", papers[0]!._id, "include");
  await vote("ben", papers[0]!._id, "include");
  await vote("ann", papers[1]!._id, "include");
  await vote("ben", papers[1]!._id, "exclude");
  await vote("ann", papers[2]!._id, "exclude");
  await settleAll(made.t);
  expect(await counts("ann", { source })).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1, waiting: 1 });
  // The papers Ann voted on, and the ones she voted to include, by where they stand now.
  expect(await counts("ann", { reviewer: made.ids.ann })).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1, waiting: 1 });
  expect(await counts("ann", { reviewer: made.ids.ann, voted: "include" })).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1, waiting: 0 });
  // Ben has a paper left: how many Ann voted each way is kept from him, and the papers she is on are not.
  expect(await counts("ben", { reviewer: made.ids.ann, voted: "include" })).toBeNull();
  expect(await counts("ben", { reviewer: made.ids.ann })).toEqual({ include: 1, maybe: 0, exclude: 0, conflict: 1, waiting: 1 });
  // Ann has none left, and sees how many Ben voted each way.
  expect(await counts("ann", { reviewer: made.ids.ben, voted: "exclude" })).toEqual({ include: 0, maybe: 0, exclude: 0, conflict: 1, waiting: 0 });

  // Its source taken out: its papers nobody settled leave the counts.
  await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "search", searchId: "another" }, name: "Another search" }], removeSources: [source] } });
  await runAll(made.t, vi.runAllTimers);
  const left = (await counts("ann", { source }))!;
  expect(left.waiting + left.conflict).toBe(0);
});

it("keeps the papers another source still holds when the source they were kept under is taken out, and says so before", async () => {
  const made = await team(["ann"]);
  const { workspaceId } = made;
  const { jobId, papers } = await started(made, ["ann"], 3);
  const first = papers[0]!.sourceId!;
  await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { addSources: [{ set: { kind: "search", searchId: "another" }, name: "Another search" }] } });
  await runAll(made.t, vi.runAllTimers);
  // The second search held the first two papers too: each was merged into the paper the first search brought.
  const second = await made.t.run(async (ctx) => {
    const other = (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).find((one) => one._id !== first)!;
    for (const paper of papers.slice(0, 2)) await ctx.db.insert("screeningMerged", { jobId, sourceId: other._id, name: paper.title ?? "Paper", into: paper._id, paperKey: paper.paperKey, pass: other.pass ?? 0 });
    await ctx.db.patch("screeningSources", other._id, { duplicates: other.duplicates + 2 });
    return { id: other._id, taken: other.taken, duplicates: other.duplicates + 2 };
  });
  // Before it is taken out, the change says one paper leaves: the two the second search holds stay.
  expect((await made.as.ann!.action(api.screening.effects.preview, { workspaceId, jobId, change: { removeSources: [first] } })).removed).toBe(1);
  await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { removeSources: [first] } });
  await runAll(made.t, vi.runAllTimers);
  const [one, two, gone, source] = await made.t.run(async (ctx) => [await ctx.db.get("screeningResults", papers[0]!._id), await ctx.db.get("screeningResults", papers[1]!._id), await ctx.db.get("screeningResults", papers[2]!._id), await ctx.db.get("screeningSources", second.id)] as const);
  // The papers both held stay, as the second search's own; the one only the first held goes.
  for (const kept of [one, two]) expect({ withdrawn: kept!.withdrawn ?? false, source: kept!.sourceId }).toEqual({ withdrawn: false, source: second.id });
  expect(gone!.withdrawn).toBe(true);
  // Each paper it took counts under it, one after the other in the same step.
  expect({ taken: source!.taken, duplicates: source!.duplicates }).toEqual({ taken: second.taken + 2, duplicates: second.duplicates - 2 });
});
