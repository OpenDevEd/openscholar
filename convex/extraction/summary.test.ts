import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { recomputePaperListProjection } from "./listProjection";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";

type Row = { title: string; country: string | null; outcomes: string[] };

/** A finished job: one paper a row, answering where it was done and what it measured, written through the paper's projection. */
async function seedJob(t: ReturnType<typeof convexTest>, rows: Row[]) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { clerkId: "clerk_summary", email: "summary@test.com", state: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: now });
    await seedOrganizationFeatures(ctx, ["clerk_summary"], { extraction: true });
    const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction", sourceType: "history", status: "completed", totalPapers: rows.length, name: "Summary", createdAt: now, updatedAt: now });
    await ctx.db.insert("extractionQuestions", { jobId, key: "country", question: "In what country was the study done?", type: "string", order: 0, createdAt: now });
    await ctx.db.insert("extractionQuestions", { jobId, key: "outcomes", question: "Which outcomes were measured?", type: "array", order: 1, createdAt: now });
    const papers: Id<"extractionPapers">[] = [];
    for (const { title, country, outcomes } of rows) {
      const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${title}`, title, authors: [], processable: true, status: "completed" });
      await ctx.db.insert("extractionResults", { jobId, paperId, questionKey: "country", answer: country, citations: [], citationStatus: "best_effort", confidence: 0.9, status: "completed", processedAt: 1 });
      await ctx.db.insert("extractionResults", { jobId, paperId, questionKey: "outcomes", answer: outcomes, citations: [], citationStatus: "best_effort", confidence: 0.9, status: "completed", processedAt: 1 });
      await recomputePaperListProjection(ctx, paperId);
      papers.push(paperId);
    }
    return { userId, jobId, papers };
  });
}

it("groups and counts a question's answers across every paper, narrowed by another question's answer", async () => {
  const t = convexTest(schema);
  const { userId, jobId } = await seedJob(t, [
    { title: "India", country: "India", outcomes: ["test scores", "attendance"] },
    { title: "Kenya", country: "Kenya", outcomes: ["test scores"] },
    { title: "India again", country: "India", outcomes: ["attendance"] },
    { title: "Silent", country: null, outcomes: [] },
  ]);
  const summarize = (args: object) => t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, ...args } as never);

  expect(await summarize({ questionKey: "country" })).toMatchObject({ question: "In what country was the study done?", papers: 4, answered: 3, answers: [{ answer: "India", papers: 2 }, { answer: "Kenya", papers: 1 }], moreAnswers: 0 });
  // A list question counts each item across the papers that name it.
  expect((await summarize({ questionKey: "outcomes" })).items).toEqual(expect.arrayContaining([{ item: expect.stringMatching(/test scores/i), papers: 2 }, { item: expect.stringMatching(/attendance/i), papers: 2 }]));
  // Only the papers done in India: what they measured.
  const india = await summarize({ questionKey: "outcomes", filters: { searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [{ questionKey: "country", value: "India" }] } });
  expect(india).toMatchObject({ papers: 2, answered: 2 });
  expect(india.items).toEqual(expect.arrayContaining([{ item: expect.stringMatching(/attendance/i), papers: 2 }, { item: expect.stringMatching(/test scores/i), papers: 1 }]));
  await expect(summarize({ questionKey: "country", filters: { searchQuery: "trial", confidenceRange: [0, 100], statusFilters: [], questionFilters: [] } })).rejects.toThrow(/text search/);
  await expect(summarize({ questionKey: "nope" })).rejects.toThrow(/no question/);
});

it("counts the answers past the ones it names, and the backfill writes a paper's rows once", async () => {
  const t = convexTest(schema);
  const { userId, jobId, papers } = await seedJob(t, Array.from({ length: 30 }, (_, n) => ({ title: `Paper ${n}`, country: `Country ${n}`, outcomes: [] })));
  const summary = await t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey: "country" } as never);
  expect(summary).toMatchObject({ papers: 30, answered: 30, moreAnswers: 5 });
  expect(summary.answers).toHaveLength(25);

  // A paper that finished before its rows were kept gets them from the backfill, and running it again changes nothing.
  const rows = () => t.run((ctx) => ctx.db.query("extractionAnswerRows").withIndex("by_paper", (q) => q.eq("paperId", papers[0])).collect());
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query("extractionAnswerRows").withIndex("by_paper", (q) => q.eq("paperId", papers[0])).collect()) await ctx.db.delete("extractionAnswerRows", row._id);
  });
  expect(await rows()).toHaveLength(0);
  await t.mutation(internal.migrations.extractionAnswers.run, {});
  await t.finishAllScheduledFunctions(() => {});
  const written = await rows();
  expect(written).toHaveLength(2);
  await t.mutation(internal.migrations.extractionAnswers.run, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(await rows()).toEqual(written);
});
