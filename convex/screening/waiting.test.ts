// What waits for a person on a screening is counted one way (./view.ts `waitsOn`): for the list, for the rail's count and for another workspace's page.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { settleAll, started, team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("tells whoever settles conflicts of a conflict, whether or not they review the screening", async () => {
  const made = await team(["ann", "ben", "cat"]);
  const { workspaceId } = made;
  // Ann and Ben review. Cat settles what they split on, and votes on nothing.
  const { jobId, papers } = await started(made, ["ann", "ben"], 1, { rule: { each: 2, settle: "all", blind: "always", resolver: made.ids.cat! } });
  await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: papers[0]!._id, decision: "include" });
  await made.as.ben!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: papers[0]!._id, decision: "exclude", reason: "other" });
  await settleAll(made.t);

  const waitsFor = async (name: string) => ({
    rail: (await made.as[name]!.query(api.screening.view.rail, { workspaceId }))!.waiting,
    list: (await made.as[name]!.query(api.screening.view.mine, { workspaceId })).page.map((one) => ({ id: one.id, forYou: one.forYou, conflicts: one.conflicts })),
  });
  expect(await waitsFor("cat")).toEqual({ rail: 1, list: [{ id: jobId, forYou: 0, conflicts: 1 }] });
  // Ann has voted on her one paper, and the conflict is not hers to settle: nothing waits for her.
  expect(await waitsFor("ann")).toEqual({ rail: 0, list: [] });

  // Once Cat has settled it, nothing waits for her either.
  await made.as.cat!.mutation(api.screening.voting.resolve, { workspaceId, jobId, paperId: papers[0]!._id, decision: "include" });
  await settleAll(made.t);
  expect(await waitsFor("cat")).toEqual({ rail: 0, list: [] });
});

it("finds a workspace's screenings by the words of their names, in any order and whatever their case, in the order asked for", async () => {
  const made = await team(["ann"]);
  const { workspaceId } = made;
  for (const name of ["Tutoring in Kenya", "Kenya school feeding", "Tutoring at scale"]) {
    const { jobId } = await started(made, ["ann"], 0);
    await made.t.run((ctx) => ctx.db.patch("screeningJobs", jobId, { name }));
  }
  const found = async (text: string) => (await made.as.ann!.query(api.screening.view.list, { workspaceId, show: "all", sort: "name", text, paginationOpts: { cursor: null, numItems: 10 } })).page.map((one) => one.name);
  expect(await found("kenya")).toEqual(["Kenya school feeding", "Tutoring in Kenya"]);
  expect(await found(" KENYA tutor ")).toEqual(["Tutoring in Kenya"]);
  expect(await found("malaria")).toEqual([]);
});
