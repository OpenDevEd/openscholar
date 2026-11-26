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
