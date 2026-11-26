// A model reading a paper is charged what it cost, and never more than the screening quoted the paper at: a model
// that reasons longer than its quote allows costs Openscholar the difference, not the workspace.
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { fakeAutumn, fakeAutumnFetch } from "../billing/billing.test-support";
import { screeningPaperCredits } from "../../lib/pricing/estimate";
import { started, team } from "./reviewers.test-support";

vi.mock("../../lib/ai/core/batch", () => ({
  // Far more output than any quote allows: a long chain of reasoning before the answers.
  processScreeningBatch: async ({ papers }: { papers: Array<{ id: string }> }) => ({
    results: Object.fromEntries(papers.map((paper) => [paper.id, { responses: {}, confidences: {} }])),
    usages: [{ inputTokens: 3_000, outputTokens: 40_000 }],
    trackingByItemId: {},
    errors: [],
  }),
}));

describe("a model's reading of a paper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is charged no more than the paper was quoted at, at the effort the model reads at", async () => {
    fakeAutumn.reset();
    vi.stubGlobal("fetch", fakeAutumnFetch());
    const made = await team(["ann"]);
    const { jobId, papers } = await started(made, ["ann"], 1);
    const price = { input: 0.1, output: 0.5 };
    const voteId = await made.t.run(async (ctx) => {
      const modelId = await ctx.db.insert("models", { provider: "openrouter", modelId: "test/reasons", name: "Reasons", inputModalities: ["text"], outputModalities: ["text"], inputPricePerMillion: price.input, outputPricePerMillion: price.output, costMarkup: 1, contextLength: 200_000, supportedParameters: [], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 });
      const reviewerId = await ctx.db.insert("screeningReviewers", { jobId, kind: "model", modelId, effort: "medium", addedAt: 1, addedBy: made.ids.ann!, dealt: 1 });
      return await ctx.db.insert("screeningVotes", { jobId, resultId: papers[0]!._id, reviewerId, place: 0, status: "waiting" });
    });
    const read = await made.t.action(internal.screening.reading.readPaper, { voteId });
    expect(read).toMatchObject({ read: true, credits: screeningPaperCredits(price, "medium") });
  });
});
