// A screening with reviewers at the largest sizes a plan allows stays within Convex's transaction limits
// (docs/agents/project.md "Convex limits"): its papers are read from their source, dealt, counted, listed, voted
// on and previewed a page or a step at a time.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertMany, text } from "../lib/maxSize.test-support";
import { paperOf } from "../lib/paperRef.test-support";
import { runAll, started, team, type Team } from "../screening/reviewers.test-support";

/** The most papers a plan gives one screening (lib/billing/plans.ts `request_papers`, Southern). */
const PAPERS = 5_000;
const PEOPLE = ["ann", "ben", "cat", "dan", "eve", "fay", "gus", "hal", "ida", "jon"];
const page = (numItems: number, cursor: string | null = null) => ({ paginationOpts: { cursor, numItems } });

/** Saved papers in the team's library, each with a title of its own (two records of one title and year are one paper), an abstract of the usual length and its authors. */
const saved = (made: Team, items: number) =>
  insertMany(made.t, "libraryItems", Array.from({ length: items }, (_, i) => ({
    userId: made.ids.ann!, workspaceId: made.workspaceId, createdBy: made.ids.ann!, ...paperOf(`openalex:W${i}`), rating: 1, title: `${text(90, i)} ${i}`, authors: Array.from({ length: 8 }, (_, a) => text(24, a + i)), publicationYear: 1990 + (i % 35),
    journal: text(40, i), citedByCount: i % 500, paperData: text(1_700, i), searchableText: text(160, i), savedAt: 1_700_000_000_000 + i, updatedAt: 1, abstract: text(2_000, i),
  })), 500);

// Time moves a second a turn while scheduled work runs, as it does: jumped to every timer at once, the watch on a
// reading (../screening/gathering.ts `watch`) wakes over and over while the counts beside its papers are still being written,
// and takes the reading for one gone quiet.
const tick = () => vi.advanceTimersByTime(1_000);

describe("a screening with reviewers at the largest sizes the product allows", { tags: ["size"] }, () => {
  let made: Team;
  let jobId: Id<"screeningJobs">;

  beforeAll(async () => {
    vi.useFakeTimers();
    made = await team(PEOPLE);
    await saved(made, PAPERS);
    // Ten people, each on every paper: its sources are read by the screening's own reading, a step at a time, and every paper dealt as it arrives.
    ({ jobId } = await started(made, PEOPLE, 0, { rule: { each: "all", settle: "all", blind: "after" } }));
    await runAll(made.t, tick);
    // Fifty thousand places, each counted three ways (../screening/facets.ts): convex-test keeps the counts slower than a backend does.
  }, 3_600_000);
  afterAll(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("takes every paper of a 5,000-paper source, gives each to its ten reviewers, and says where they stand", async () => {
    const { workspaceId } = made;
    const view = (await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId }))!;
    expect(view).toMatchObject({ total: PAPERS, forYou: PAPERS, counts: { waiting: PAPERS } });
    expect(view.reviewers.map((one) => one.dealt)).toEqual(Array(PEOPLE.length).fill(PAPERS));
    // The Papers page's tabs, for all of it and narrowed to one reviewer's papers still to vote on.
    expect(await made.as.ann!.query(api.screening.paperViews.counts, { workspaceId, jobId })).toMatchObject({ waiting: PAPERS });
    expect(await made.as.ann!.query(api.screening.paperViews.counts, { workspaceId, jobId, reviewer: made.ids.ben!, voted: "none" })).toMatchObject({ waiting: PAPERS });
    expect((await made.as.ann!.query(api.screening.view.list, { workspaceId, show: "all", sort: "active", ...page(50) })).page).toHaveLength(1);
  }, 600_000);

  it("lists its papers and a reviewer's queue a page at a time, to the last page, as an export reads them", async () => {
    const { workspaceId } = made;
    expect((await made.as.ben!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "todo", ...page(100) })).page).toHaveLength(100);
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const read: { page: Array<{ id: string }>; isDone: boolean; continueCursor: string } = await made.as.ann!.query(api.screening.paperViews.list, { workspaceId, jobId, ...page(100, cursor) });
      for (const one of read.page) seen.add(one.id);
      cursor = read.isDone ? null : read.continueCursor;
    } while (cursor);
    expect(seen.size).toBe(PAPERS);
  }, 600_000);

  it("takes a hundred votes at once, settles what they settle, and counts a change to the rule over every paper", async () => {
    const { workspaceId } = made;
    const first = (await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "todo", ...page(100) })).page.map((one) => one.id);
    for (const name of PEOPLE) await made.as[name]!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: first, decision: "include" });
    await runAll(made.t, tick);
    expect((await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId }))!.counts).toMatchObject({ include: 100, waiting: PAPERS - 100 });
    // What a change would do is counted over all 5,000, a step at a time: here, that one vote settles a paper.
    const preview = await made.as.ann!.action(api.screening.effects.preview, { workspaceId, jobId, change: { rule: { each: "all", settle: "one", blind: "after" } } });
    expect(preview.total).toBe(PAPERS);
  }, 900_000);
});

describe("a step of papers that goes to many reviewers", { tags: ["size"] }, () => {
  it("is written in transactions that hold, however many people each paper goes to", async () => {
    vi.useFakeTimers();
    try {
      const made = await team(["ann"]);
      await saved(made, 400);
      const { jobId } = await started(made, ["ann"], 0, { rule: { each: "all", settle: "all", blind: "after" } });
      // Forty-four more people on it, the most a screening has, each on every paper: a step of 200 papers is then 9,000 places.
      await made.t.run(async (ctx) => {
        for (let i = 0; i < 44; i++) {
          const userId = await ctx.db.insert("users", { clerkId: `guest_${i}`, email: `guest_${i}@test`, state: "active", createdAt: 1, updatedAt: 1 });
          await ctx.db.insert("screeningReviewers", { jobId, kind: "person", userId, addedAt: 2 + i, addedBy: made.ids.ann!, dealt: 0 });
        }
      });
      await runAll(made.t, tick);
      const view = (await made.as.ann!.query(api.screening.view.get, { workspaceId: made.workspaceId, jobId }))!;
      expect(view).toMatchObject({ total: 400, forYou: 400 });
      expect(view.reviewers.map((one) => one.dealt)).toEqual(Array(45).fill(400));
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 900_000);

  it("settles papers with many reviewers each in batches their votes fit", async () => {
    vi.useFakeTimers();
    try {
      const people = ["ann", ...Array.from({ length: 29 }, (_, i) => `p${i}`)];
      const made = await team(people);
      await saved(made, 50);
      // Thirty people on every paper, Ann's vote on each, then "settled by the first vote": each paper settles on her vote
      // and closes the places of the 29 others, 1,450 rows written by one settling, each read back for its counts.
      const { jobId } = await started(made, people, 0, { rule: { each: "all", settle: "all", blind: "after" } });
      await runAll(made.t, tick);
      const { workspaceId } = made;
      const papers = (await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "todo", ...page(50) })).page.map((one) => one.id);
      expect(papers).toHaveLength(50);
      await made.as.ann!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: papers, decision: "include" });
      await runAll(made.t, tick);
      await made.as.ann!.mutation(api.screening.settings.save, { workspaceId, jobId, change: { rule: { each: "all", settle: "one", blind: "after" } } });
      await runAll(made.t, tick);
      expect((await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId }))!.counts).toMatchObject({ include: 50, waiting: 0 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 900_000);

  it("settles papers every one of the most reviewers voted on, and keeps the agreement of each pair of them", async () => {
    vi.useFakeTimers();
    try {
      // MAX_REVIEWERS people on every paper, each voting on all of them: settling adds to 990 pairs' agreement.
      const people = ["ann", ...Array.from({ length: 44 }, (_, i) => `p${i}`)];
      const made = await team(people);
      await saved(made, 10);
      const { jobId } = await started(made, people, 0, { rule: { each: "all", settle: "all", blind: "after" } });
      await runAll(made.t, tick);
      const { workspaceId } = made;
      const papers = (await made.as.ann!.query(api.screening.paperViews.queue, { workspaceId, jobId, queue: "todo", ...page(10) })).page.map((one) => one.id);
      for (const name of people) await made.as[name]!.mutation(api.screening.voting.voteMany, { workspaceId, jobId, paperIds: papers, decision: "include" });
      await runAll(made.t, tick);
      expect((await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId }))!.counts).toMatchObject({ include: 10, waiting: 0 });
      const { pairs } = (await made.as.ann!.query(api.screening.view.figures, { workspaceId, jobId, since: 0 }))!;
      expect(pairs).toHaveLength(990);
      expect(pairs.every((pair) => pair.matrix[0] === 10)).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 900_000);
});
