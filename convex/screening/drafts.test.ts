// A screening's sources are read before it starts (plans/screening-reviewers), so the form that starts it says what they hold, and starting it deals what was read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { give, paper, runAll, standingOf, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const saved = { set: { kind: "saved" as const }, name: "Saved papers" };
const firstTen = { set: { kind: "saved" as const }, name: "Saved papers", first: 1, last: 10 };
const search = { set: { kind: "search" as const, searchId: "a-search" }, name: "tutoring trials" };
const setup = ({ ids }: Team, people: string[]) => ({
  name: "Tutoring",
  criteria: [{ text: "Is it about tutoring?", must: true }],
  rule: { each: 2, settle: "all" as const, blind: "after" as const },
  people: people.map((name) => ids[name]!),
  models: [],
  saveTo: { kind: "none" as const },
});
const jobsOf = ({ t }: Team) => t.run((ctx) => ctx.db.query("screeningJobs").collect());

describe("a screening read before it starts", () => {
  it("is its maker's alone, reads on when a source is added at the end, and starts over when its sources change otherwise", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const first = (await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, sources: [saved] }))!;
    await give(made.t, first.jobId, 0, [paper(1), paper(2), { ...paper(3), abstract: undefined }]);

    // Nobody's list shows it, and only its maker reads it: its source says what it took and what it left out.
    expect((await made.as.ann!.query(api.screening.view.list, { workspaceId, show: "all", sort: "active", paginationOpts: { cursor: null, numItems: 10 } })).page).toEqual([]);
    expect(await made.as.ben!.query(api.screening.view.get, { workspaceId, jobId: first.jobId })).toBeNull();
    const seen = (await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId: first.jobId }))!;
    expect(seen.sources).toMatchObject([{ id: first.sources[0], taken: 2, left: 1, duplicates: 0 }]);

    // The same sources again change nothing. One more at the end is read by the same look, into the same screening.
    expect(await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, draft: first.jobId, sources: [saved] })).toEqual(first);
    const longer = (await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, draft: first.jobId, sources: [saved, search] }))!;
    expect(longer).toMatchObject({ jobId: first.jobId, sources: [first.sources[0], expect.any(String)] });
    expect(await made.t.run((ctx) => ctx.db.query("screeningChecks").collect())).toMatchObject([{ jobId: first.jobId, state: "running", from: 0 }]);

    // Other papers of a source, or a source taken out: a new one is read from the start, and the old one goes.
    const again = (await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, draft: first.jobId, sources: [firstTen] }))!;
    expect(again.jobId).not.toBe(first.jobId);
    await runAll(made.t, vi.runAllTimers);
    expect((await jobsOf(made)).map((job) => [job._id, job.status])).toEqual([[again.jobId, "draft"]]);

    // Someone else can't go on with it: theirs is their own.
    const bens = (await made.as.ben!.mutation(api.screening.screenings.sync, { workspaceId, draft: again.jobId, sources: [firstTen] }))!;
    expect(bens.jobId).not.toBe(again.jobId);
  });

  it("starts as the one that was read, with its papers dealt as they would have been had it started first", async () => {
    const made = await team(["ann", "ben", "cat"]);
    const { workspaceId, ids } = made;
    const papers = Array.from({ length: 7 }, (_, n) => paper(n + 1));
    const read = (await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, sources: [saved] }))!;
    await give(made.t, read.jobId, 0, papers);
    const { jobId } = await made.t.mutation(internal.screening.screenings.open, { userId: ids.ann!, workspaceId, author: "user", ...setup(made, ["ann", "ben", "cat"]), sources: [saved], draft: read.jobId });
    expect(jobId).toBe(read.jobId);
    await runAll(made.t, vi.runAllTimers);

    // The same team on the same papers, started the ordinary way.
    const plain = await started(made, ["ann", "ben", "cat"], 0, { rule: { each: 2, settle: "all", blind: "after" }, criteria: [{ text: "Is it about tutoring?", must: true }] });
    await give(made.t, plain.jobId, 0, papers);
    const [early, usual] = [await standingOf(made.t, jobId), await standingOf(made.t, plain.jobId)];
    expect(early.papers.map((one) => one.on)).toEqual(usual.papers.map((one) => one.on));
    expect(early.reviewers).toEqual(usual.reviewers);
    expect((await jobsOf(made)).find((job) => job._id === jobId)).toMatchObject({ status: "processing", name: "Tutoring" });

    // Sources that aren't the ones read: it starts from the start, and the one read goes.
    const stale = (await made.as.ann!.mutation(api.screening.screenings.sync, { workspaceId, sources: [saved] }))!;
    const fresh = await made.t.mutation(internal.screening.screenings.open, { userId: ids.ann!, workspaceId, author: "user", ...setup(made, ["ann"]), sources: [firstTen], draft: stale.jobId });
    expect(fresh.jobId).not.toBe(stale.jobId);
    await runAll(made.t, vi.runAllTimers);
    expect((await jobsOf(made)).some((job) => job._id === stale.jobId)).toBe(false);
  });
});
