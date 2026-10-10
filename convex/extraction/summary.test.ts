import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { recomputePaperListProjection } from "./listProjection";
import { catchUp } from "../lib/catchUp.test-support";

type Row = { title: string; country: string | null; outcomes: string[]; confidence?: number; status?: "completed" };

/** A finished job: one paper a row, answering where it was done and what it measured, written through the paper's projection. */
async function seedJob(t: ReturnType<typeof convexTest>, rows: Row[], project = true) {
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { clerkId: "clerk_summary", email: "summary@test.com", state: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: now });
    const jobId = await ctx.db.insert("extractionJobs", { userId, sourceType: "history", status: "completed", totalPapers: rows.length, name: "Summary", createdAt: now, updatedAt: now });
    await ctx.db.insert("extractionQuestions", { jobId, key: "country", question: "In what country was the study done?", type: "string", order: 0, createdAt: now });
    await ctx.db.insert("extractionQuestions", { jobId, key: "outcomes", question: "Which outcomes were measured?", type: "array", order: 1, createdAt: now });
    const papers: Id<"extractionPapers">[] = [];
    for (const { title, country, outcomes, confidence = 0.9, status = "completed" } of rows) {
      const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${title}`, title, authors: [], processable: true, status: "completed" });
      for (const [questionKey, answer] of [["country", country], ["outcomes", outcomes]] as const) {
        await ctx.db.insert("extractionResults", { jobId, paperId, questionKey, answer, citations: [], citationStatus: "best_effort", confidence, ...(project ? { status } : {}), processedAt: 1 });
      }
      if (project) await recomputePaperListProjection(ctx, paperId);
      papers.push(paperId);
    }
    return { userId, jobId, papers };
  });
  // The job's counts and tallies are a moment behind its writes.
  await catchUp(t);
  return seeded;
}
const filters = (more: object) => ({ searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [], ...more });

it("groups and counts a question's answers across every paper, narrowed as the results page narrows them", async () => {
  const t = convexTest(schema);
  const { userId, jobId } = await seedJob(t, [
    { title: "Côte", country: "Côte d’Ivoire", outcomes: ["test scores", "attendance"] },
    { title: "Kenya", country: "Kenya", outcomes: ["test scores"], confidence: 0.29 },
    { title: "Côte again", country: "Cote d Ivoire", outcomes: ["attendance"] },
    { title: "Silent", country: null, outcomes: [] },
  ]);
  const summarize = (args: object) => t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, ...args } as never);

  // Grouped as the page's filter groups them: one country, however it was spelt.
  expect(await summarize({ questionKey: "country" })).toMatchObject({ question: "In what country was the study done?", papers: 4, answered: 3, answers: [{ papers: 2 }, { answer: "Kenya", papers: 1 }], moreAnswers: 0 });
  // A list question counts each item across the papers that name it.
  expect((await summarize({ questionKey: "outcomes" })).items).toEqual(expect.arrayContaining([{ item: expect.stringMatching(/test scores/i), papers: 2 }, { item: expect.stringMatching(/attendance/i), papers: 2 }]));
  // Only the papers done in Côte d'Ivoire, filtered as the page spells it: what they measured.
  const cote = await summarize({ questionKey: "outcomes", filters: filters({ questionFilters: [{ questionKey: "country", value: "Cote d Ivoire" }] }) });
  expect(cote).toMatchObject({ papers: 2, answered: 2 });
  // The page's tags and its confidence range, to the edge.
  expect(await summarize({ questionKey: "country", filters: filters({ statusFilters: ["high-confidence"] }) })).toMatchObject({ papers: 3 });
  expect(await summarize({ questionKey: "country", filters: filters({ confidenceRange: [29, 30] }) })).toMatchObject({ papers: 1, answers: [{ answer: "Kenya" }] });
  await expect(summarize({ questionKey: "country", filters: filters({ searchQuery: "trial" }) })).rejects.toThrow(/text search/);
  await expect(summarize({ questionKey: "nope" })).rejects.toThrow(/no question/);
});

it("keeps answers apart past the text it shows, counts every item, and names the answers past the first ones", async () => {
  const t = convexTest(schema);
  const long = "a".repeat(250);
  const { userId, jobId } = await seedJob(t, [
    { title: "Long one", country: `${long} one`, outcomes: Array.from({ length: 7 }, (_, n) => `outcome ${2 * n}; outcome ${2 * n + 1}`) },
    { title: "Long two", country: `${long} two`, outcomes: ["outcome 13"] },
    ...Array.from({ length: 28 }, (_, n) => ({ title: `Paper ${n}`, country: `Country ${n}`, outcomes: [] })),
  ]);
  const summarize = (questionKey: string) => t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey } as never);
  const countries = await summarize("country");
  expect(countries).toMatchObject({ papers: 30, answered: 30, moreAnswers: 5 });
  expect(countries.answers).toHaveLength(25);
  const outcomes = await summarize("outcomes");
  expect(outcomes.items).toHaveLength(14);
  expect(outcomes.items[0]).toEqual({ item: expect.stringMatching(/outcome 13/), papers: 2 });
});

it("writes a batch's answers as it's saved, and backfills papers from before, once", async () => {
  const t = convexTest(schema);
  // Saved before results had a status, and before answer rows were kept.
  const { userId, jobId, papers } = await seedJob(t, [{ title: "Old", country: "Ghana", outcomes: ["attendance"] }], false);
  const rows = () => t.run((ctx) => ctx.db.query("extractionAnswerRows").withIndex("by_paper", (q) => q.eq("paperId", papers[0])).collect());
  expect(await rows()).toHaveLength(0);
  await t.mutation(internal.migrations.extractionAnswers.run, {});
  await catchUp(t);
  const written = await rows();
  expect(written.map((row) => row.questionKey).sort()).toEqual(["country", "outcomes"]);
  expect(await t.run((ctx) => ctx.db.query("extractionPaperFacts").withIndex("by_paper", (q) => q.eq("paperId", papers[0])).unique())).not.toBeNull();
  await t.mutation(internal.migrations.extractionAnswers.run, {});
  await catchUp(t);
  expect(await rows()).toEqual(written);
  expect(await t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey: "country" } as never)).toMatchObject({ papers: 1, answers: [{ answer: "Ghana" }] });
});
