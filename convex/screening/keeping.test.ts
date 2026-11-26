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
