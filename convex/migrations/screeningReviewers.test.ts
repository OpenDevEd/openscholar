// The screenings from before a screening had reviewers, brought into that shape: each keeps what it decided.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { runAll, standingOf, team } from "../screening/reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a screening from before screenings had reviewers", () => {
  it("keeps each paper's result, gives the model that ran it a vote on each, and lets a person's vote decide from then on", async () => {
    const made = await team(["ann"]);
    const { workspaceId } = made;
    const { jobId, modelId } = await made.t.run(async (ctx) => {
      const modelId = await ctx.db.insert("models", { modelId: "test/reader", name: "Test: Reader", provider: "openrouter", inputPricePerMillion: 1, outputPricePerMillion: 2, costMarkup: 1, contextLength: 200_000, supportedParameters: ["tools"], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", {
        workspaceId,
        createdBy: made.ids.ann!,
        status: "completed",
        totalPapers: 3,
        questions: [{ key: "q1", question: "Is it about tutoring?" }, { key: "q2", question: "Is it a trial?" }],
        // The old rule: a paper needed two points, whatever its required answers said.
        scoringConfig: { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0, required: true }, { questionKey: "q2", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [1, 2, 3, 4, 5].map((stars) => ({ minScore: stars > 2 ? 2 : stars, stars })) },
        set: { kind: "saved" },
        label: "Saved papers",
        screeningId: await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: 1 }),
        serverModelId: modelId,
        createdAt: 1,
        updatedAt: 5,
        completedAt: 5,
      });
      const paper = (n: number, outcome: "included" | "excluded" | "unclear", answers: Record<string, boolean | null>) =>
        ctx.db.insert("screeningResults", { jobId, paperKey: `openalex:W${n}`, ref: { source: "openalex", work: `W${n}` }, title: `Paper ${n}`, abstract: "Found something.", status: "completed", answers, outcome, qualified: outcome === "included", creditsUsed: 2, createdAt: n, completedAt: n });
      await paper(1, "included", { q1: true, q2: true });
      // Met its one required question, and was excluded on its points: under the rule that follows must-haves alone it would be included.
      await paper(2, "excluded", { q1: true, q2: false });
      await paper(3, "unclear", { q1: null, q2: true });
      await ctx.db.insert("screeningJobProgress", { jobId, completed: 3, skipped: 0, failed: 0, qualified: 1 });
      return { jobId, modelId };
    });

    await made.t.mutation(internal.migrations.screeningReviewers.one, { jobId });
    await runAll(made.t, vi.runAllTimers);

    const after = await standingOf(made.t, jobId);
    expect(after.papers.map((one) => one.result)).toEqual(["include", "exclude", "maybe"]);
    expect(after.counts).toEqual({ include: 1, maybe: 1, exclude: 1, conflict: 0 });
    // The model's own votes follow its answers: it includes the paper the old points excluded, and that paper stays excluded.
    expect(after.reviewers[`model:${modelId}`]).toMatchObject({ dealt: 3, cast: 3, include: 2, maybe: 1, exclude: 0, spent: 6 });
    const seen = await made.as.ann!.query(api.screening.view.get, { workspaceId, jobId });
    expect(seen).toMatchObject({ name: "Saved papers", total: 3, finishedAt: 5, each: 0, criteria: [{ key: "q1", text: "Is it about tutoring?", must: true }, { key: "q2", must: false }], sources: [{ name: "Saved papers", taken: 3 }] });

    // Brought over twice, nothing is made twice.
    await made.t.mutation(internal.migrations.screeningReviewers.one, { jobId });
    await runAll(made.t, vi.runAllTimers);
    expect((await standingOf(made.t, jobId)).reviewers[`model:${modelId}`]).toMatchObject({ dealt: 3, cast: 3 });

    // Reopened, a person who joins and votes on the excluded paper lets go of what it kept: the first vote on it now decides.
    await made.as.ann!.mutation(api.screening.screenings.reopen, { workspaceId, jobId });
    await made.as.ann!.mutation(api.screening.reviewers.joinIn, { workspaceId, jobId });
    await runAll(made.t, vi.runAllTimers);
    const second = (await made.t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()))[1]!;
    await made.as.ann!.mutation(api.screening.voting.vote, { workspaceId, jobId, paperId: second._id, decision: "include" });
    await runAll(made.t, vi.runAllTimers);
    const voted = await standingOf(made.t, jobId);
    expect(voted.papers.map((one) => one.result)).toEqual(["include", "include", "maybe"]);
    expect(voted.counts).toEqual({ include: 2, maybe: 1, exclude: 0, conflict: 0 });
  });
});
