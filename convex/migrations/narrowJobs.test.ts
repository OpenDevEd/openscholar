// Clearing the person screening and extraction jobs belonged to before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { personalWorkspaceOf } from "../workspaces/personal";

it("clears the person a job, its queued paper, the slots and a waiting paper named, keeps who started the jobs, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const ada = await t.run(async (ctx) => ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const own = await t.run(async (ctx) => personalWorkspaceOf(ctx, ada));
    const mine = { userId: ada, workspaceId: own, createdBy: ada };
    await runUntriggered(t, async (ctx) => {
      const screeningId = await ctx.db.insert("screenings", { workspaceId: own, version: 0, createdAt: 1 });
      const screeningJob = await ctx.db.insert("screeningJobs", { ...mine, screeningId, status: "processing", totalPapers: 1, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("screeningResults", { jobId: screeningJob, openalexId: "https://openalex.org/W1", title: "Waiting", status: "processing", waitingUser: ada, waitingWorkspace: own, waitingSince: 1, createdAt: 1 });
      await ctx.db.insert("screeningResults", { jobId: screeningJob, openalexId: "https://openalex.org/W2", title: "Started", status: "processing", workId: "work", createdAt: 1 });
      await ctx.db.insert("screeningSlots", { userId: ada, workspaceId: own, running: 1 });
      const extractionJob = await ctx.db.insert("extractionJobs", { ...mine, name: "Trials", totalPapers: 1, createdAt: 1, updatedAt: 1 });
      const paperId = await ctx.db.insert("extractionPapers", { jobId: extractionJob, openalexId: "https://openalex.org/W1", title: "Trial", status: "pending", processable: true });
      await ctx.db.insert("extractionPaperQueue", { jobId: extractionJob, userId: ada, workspaceId: own, paperId, runEpoch: 0, kind: "initial", status: "pending", priority: 0, attempt: 0, createdAt: 1, updatedAt: 1 });
    });
    expect(await t.action(internal.migrations.narrowJobs.verify, {})).toBe(5);
    const rows = () => t.run(async (ctx) => ({
      jobs: [...(await ctx.db.query("screeningJobs").collect()), ...(await ctx.db.query("extractionJobs").collect())],
      results: await ctx.db.query("screeningResults").collect(),
      slots: await ctx.db.query("screeningSlots").collect(),
      queue: await ctx.db.query("extractionPaperQueue").collect(),
    }));
    await t.mutation(internal.migrations.narrowJobs.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect([...once.jobs, ...once.slots, ...once.queue].every((row) => !("userId" in row))).toBe(true);
    expect(once.jobs).toMatchObject([{ createdBy: ada }, { createdBy: ada }]);
    // The waiting paper still waits, under its workspace's slots alone.
    expect(once.results.map((row) => ("waitingUser" in row ? "named" : row.waitingWorkspace ?? row.workId))).toEqual([own, "work"]);
    await t.mutation(internal.migrations.narrowJobs.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowJobs.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
