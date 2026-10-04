import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { saveQualified } from "../screening/bookkeeping";
import { expandJobSources } from "../extraction/expandSources";

it("keeps a rated paper intact through screening, repeated saves and extraction persistence", async () => {
  const t = convexTest(schema);
  const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "metadata-owner", email: "metadata@test", state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 }));
  const owner = t.withIdentity({ subject: "metadata-owner" });
  const abstract = "Saved abstract: This randomized school trial measured literacy outcomes in two groups of pupils over one school term, using the same assessment before and after teaching.";
  const { id } = await owner.mutation(api.library.mutations.saveToLibrary, { openalexId: "W7", title: "Saved title", abstract, authors: ["Smith, Jr., John", "ليلى"], citedByCount: 0, isOpenAccess: false, pdfUrl: "https://example.test/retained.pdf", rating: 4 });
  const before = await t.run((ctx) => ctx.db.get("libraryItems", id));
  await t.run(async (ctx) => {
    const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
    const jobId = await ctx.db.insert("screeningJobs", { userId, screeningId, status: "completed", totalPapers: 1, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
    const resultId = await ctx.db.insert("screeningResults", { jobId, openalexId: "https://openalex.org/W7", title: "Later title", authors: ["Wrong name"], citedByCount: 100, isOpenAccess: true, venue: "Trial journal", workType: "preprint", stars: 1, status: "completed", createdAt: 1 });
    await saveQualified(ctx, (await ctx.db.get("screeningJobs", jobId))!, (await ctx.db.get("screeningResults", resultId))!);
  });
  await owner.mutation(api.library.mutations.saveToLibrary, { openalexId: "W7", title: "Partial later save" });
  const saved = await t.run((ctx) => ctx.db.get("libraryItems", id));
  expect(saved).toMatchObject({ title: "Saved title", abstract, authors: ["Smith, Jr., John", "ليلى"], rating: 4, citedByCount: 0, isOpenAccess: false, journal: "Trial journal", workType: "preprint", savedAt: before!.savedAt });
  expect(saved!.searchableText).toContain("Saved abstract");
  expect(saved!.searchableText).toContain("Smith, Jr., John");
  const expanded = await expandJobSources([{ source: "library", sourceRefId: id, bucketKey: "W7", title: "Browser copy", authors: [] }], { readLibraryItems: (ids) => t.query(internal.extraction.queries.internal.ownedLibraryItems, { userId, ids }), fetchPapersFromHistory: async () => [], resolveZoteroUserId: async () => undefined });
  // The actual paper-writing mutation must keep the expanded metadata too.
  const jobId = await t.run((ctx) => ctx.db.insert("extractionJobs", { userId, name: "Metadata QA", mode: "extraction", status: "pending", totalPapers: 0, processedPapers: 0, failedPapers: 0, createdAt: 1, updatedAt: 1 }));
  await t.run((ctx) => ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 }));
  const { paperIds } = await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: expanded.map(({ paper }) => ({ ...paper, storageId: undefined })) });
  expect(await t.run((ctx) => ctx.db.get("extractionPapers", paperIds[0]))).toMatchObject({ authors: ["Smith, Jr., John", "ليلى"], citedByCount: 0, isOpenAccess: false, venueName: "Trial journal", workType: "preprint", pdfUrl: "https://example.test/retained.pdf", processable: true });
  expect((await t.query(internal.extraction.queries.internal.getJobAndFlagsInternal, { jobId })).pdfEnabled).toBe(false);
  const manyAuthors = Array.from({ length: 101 }, (_, i) => `Author ${i}`);
  const { id: largeId } = await owner.mutation(api.library.mutations.saveToLibrary, { openalexId: "W8", title: "Large collaboration", authors: manyAuthors });
  await owner.mutation(api.library.mutations.saveToLibrary, { openalexId: "W8", title: "Partial re-save" });
  const large = await t.run(ctx => ctx.db.get("libraryItems", largeId));
  expect(large!.authors).toBeUndefined();
  expect(large!.authorsUnparsed).toBe(manyAuthors.join(", "));
});
