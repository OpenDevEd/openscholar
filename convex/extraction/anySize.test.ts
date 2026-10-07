// An extraction job past the old 1,000-paper cap (#634): its filtered pages fill, its counts
// are exact, and its summary counts every paper, read from the job's counts and tallies.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { recomputePaperListProjection } from "./listProjection";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { catchUp } from "../lib/catchUp.test-support";
import { runUntriggered } from "../../tests/convex-test-with-limits";

const PAPERS = 1_500;
const COUNTRIES = ["Kenya", "Ghana", "Peru"];
/** Paper i: answered with COUNTRIES[i % 3], confidence 0.9 for one paper in five and 0.6 for the rest. */
const countryOf = (i: number) => COUNTRIES[i % 3];
const confidenceOf = (i: number) => (i % 5 === 0 ? 0.9 : 0.6);

async function seedJob(t: ReturnType<typeof convexTest>, { triggered = true } = {}) {
  const run = triggered ? t.run.bind(t) : (fn: Parameters<typeof t.run>[0]) => runUntriggered(t, fn);
  const { userId, jobId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "clerk_big", email: "big@test.com", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.enabled", enabled: true, updatedAt: 1 });
    await seedOrganizationFeatures(ctx, ["clerk_big"], { extraction: true });
    const jobId = await ctx.db.insert("extractionJobs", { userId, sourceType: "history", status: "completed", totalPapers: PAPERS, name: "Big", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("extractionQuestions", { jobId, key: "country", question: "In what country was the study done?", type: "string", order: 0, createdAt: 1 });
    return { userId, jobId };
  });
  for (let start = 0; start < PAPERS; start += 150) {
    await run(async (ctx) => {
      for (let i = start; i < start + 150; i++) {
        const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${i}`, title: `Paper ${i}`, authors: [], processable: true, status: "completed" });
        await ctx.db.insert("extractionResults", { jobId, paperId, questionKey: "country", answer: countryOf(i), citations: [], citationStatus: "best_effort", confidence: confidenceOf(i), status: "completed", processedAt: 1 });
        await recomputePaperListProjection(ctx, paperId);
      }
    });
  }
  await catchUp(t);
  return { userId, jobId: jobId as Id<"extractionJobs"> };
}

const filters = (more: object) => ({ searchQuery: "", confidenceRange: [0, 100], statusFilters: [], questionFilters: [], ...more });
const expected = (keep: (i: number) => boolean) => Array.from({ length: PAPERS }, (_, i) => i).filter(keep).length;

it("counts, pages and summarizes a job past the old cap exactly", async () => {
  const t = convexTest(schema);
  const { userId, jobId } = await seedJob(t);
  const count = (more: object) => t.query(internal.extraction.queries.countJobResultsForAssistant, { userId, jobId, filters: filters(more) } as never);
  const page = (more: object) => t.query(internal.extraction.queries.listJobResultsForAssistant, { userId, jobId, filters: filters(more), sortBy: "title-asc", paginationOpts: { cursor: null, numItems: 50 } } as never);

  // One filter, more papers than the old cap read: exact.
  expect(await count({ questionFilters: [{ questionKey: "country", value: "Kenya" }] })).toMatchObject({ all: PAPERS, matching: expected((i) => countryOf(i) === "Kenya") });
  expect(await count({ confidenceRange: [50, 70] })).toMatchObject({ matching: expected((i) => confidenceOf(i) === 0.6) });
  expect(await count({ statusFilters: ["high-confidence"] })).toMatchObject({ matching: expected((i) => confidenceOf(i) === 0.9) });
  // Several filters: read along the narrowest, exact.
  const both = await count({ statusFilters: ["high-confidence"], questionFilters: [{ questionKey: "country", value: "Ghana" }] });
  expect(both).toMatchObject({ matching: expected((i) => confidenceOf(i) === 0.9 && countryOf(i) === "Ghana") });
  expect(both.atLeast).toBeUndefined();

  // A narrow view (300 papers) is read and sorted whole; a wide one (1,000) along the order's index. Both fill a page.
  expect((await page({ statusFilters: ["high-confidence"] })).page).toHaveLength(50);
  expect((await page({ questionFilters: [{ questionKey: "country", value: "Peru" }] })).page).toHaveLength(50);

  // The summary counts every paper.
  const summary = await t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey: "country" } as never);
  expect(summary).toMatchObject({ papers: PAPERS, answered: PAPERS, moreAnswers: 0 });
  expect([...summary.answers].sort((a, b) => a.answer.localeCompare(b.answer))).toEqual([...COUNTRIES].sort().map((answer) => ({ answer, papers: PAPERS / 3 })));
  // Narrowed, it reads the papers the filter keeps.
  expect(await t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey: "country", filters: filters({ statusFilters: ["high-confidence"] }) } as never)).toMatchObject({ papers: expected((i) => confidenceOf(i) === 0.9) });
}, 300_000);

it("the backfill counts and tallies a job from before, once however often it runs", async () => {
  const t = convexTest(schema);
  const { userId, jobId } = await seedJob(t, { triggered: false });
  // As rows from before: the answer rows not tallied.
  await runUntriggered(t, async (ctx) => {
    for (const row of await ctx.db.query("extractionAnswerRows").take(PAPERS)) await ctx.db.patch("extractionAnswerRows", row._id, { tallied: undefined });
  });
  expect(await t.action(internal.migrations.extractionFacets.verify, {})).toBeGreaterThan(0);
  for (let runs = 0; runs < 2; runs++) {
    await t.mutation(internal.migrations.extractionFacets.run, {});
    await catchUp(t);
  }
  expect(await t.action(internal.migrations.extractionFacets.verify, {})).toBe(0);
  const summary = await t.query(internal.extraction.queries.summarizeJobResultsForAssistant, { userId, jobId, questionKey: "country" } as never);
  expect([...summary.answers].sort((a, b) => a.answer.localeCompare(b.answer))).toEqual([...COUNTRIES].sort().map((answer) => ({ answer, papers: PAPERS / 3 })));
}, 300_000);
