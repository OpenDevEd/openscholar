import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

it("repairs unsupported evidence labels without rewriting answers, and guards rollback", async () => {
  const t = convexTest(schema);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkId: "evidence-repair", email: "repair@test", state: "active", libraryItemCount: 0, createdAt: 1, updatedAt: 1 });
    const jobId = await ctx.db.insert("extractionJobs", { userId, name: "Evidence repair", mode: "extraction", sourceType: "history", status: "completed", totalPapers: 1, createdAt: 1, updatedAt: 1 });
    const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: "W1", title: "Trial", abstract: "The trial assigned 120 schools to tutoring.", status: "completed" });
    const citation = { evidenceId: "pdf-unit", page: 2, charRange: [10, 30], quote: "A saved PDF passage.", retrieval: {}, validated: true };
    await ctx.db.insert("extractionEvidenceUnits", { jobId, paperId, evidenceId: citation.evidenceId, page: citation.page, charRange: citation.charRange, text: citation.quote, tokens: [], anchorConfidence: 1, source: "pdfjs_chunks", createdAt: 1 });
    const common = { jobId, paperId, answer: 0, confidence: 0, reasoning: "Original reasoning", citations: [], citationStatus: "grounded" as const, processedAt: 123, creditsUsed: 8, status: "completed" as const };
    const uncited = await ctx.db.insert("extractionResults", { ...common, questionKey: "uncited" });
    const empty = await ctx.db.insert("extractionResults", { ...common, questionKey: "empty", answer: null });
    const pdf = await ctx.db.insert("extractionResults", { ...common, questionKey: "pdf", citations: [citation] });
    return { uncited, empty, pdf, paperId };
  });
  expect(await t.mutation(internal.migrations.extractionEvidence.results, { cursor: null, dryRun: true })).toMatchObject({ DryRun: "No changes were committed." });
  expect(await t.run(ctx => ctx.db.query("extractionEvidenceChanges").take(10))).toEqual([]);
  expect((await t.run(ctx => ctx.db.get("extractionResults", ids.uncited)))!.citationStatus).toBe("grounded");
  const migrate = () => t.mutation(internal.migrations.extractionEvidence.results, { cursor: null, dryRun: false });
  await migrate();
  expect(await t.action(internal.migrations.extractionEvidence.verify, {})).toEqual({ total: 3, remaining: 0, groundedWithoutCitations: 0, legacyCitations: 0 });
  const uncited = await t.run(ctx => ctx.db.get("extractionResults", ids.uncited));
  expect(uncited).toMatchObject({ answer: 0, confidence: 0, reasoning: "Original reasoning", processedAt: 123, creditsUsed: 8, status: "completed", citationStatus: "best_effort", evidenceVersion: 2 });
  expect((await t.run(ctx => ctx.db.get("extractionResults", ids.empty)))!.citationStatus).toBe("insufficient_evidence");
  const pdf = await t.run(ctx => ctx.db.get("extractionResults", ids.pdf));
  expect(pdf).toMatchObject({ citationStatus: "grounded", citations: [{ source: "pdf", paperId: ids.paperId, quote: "A saved PDF passage.", page: 2 }] });
  expect(pdf!.citations[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
  const receipts = await t.run(ctx => ctx.db.query("extractionEvidenceChanges").take(10));
  expect(receipts).toHaveLength(3);
  await migrate();
  expect(await t.run(ctx => ctx.db.query("extractionEvidenceChanges").take(10))).toEqual(receipts);
  const receipt = receipts.find(row => row.resultId === ids.uncited)!;
  await t.run(ctx => ctx.db.patch("extractionResults", ids.uncited, { reasoning: "A later manual correction" }));
  await expect(t.mutation(internal.migrations.extractionEvidence.rollback, { changeId: receipt._id })).rejects.toThrow(/changed after repair/);
  const emptyReceipt = receipts.find(row => row.resultId === ids.empty)!;
  expect(await t.mutation(internal.migrations.extractionEvidence.rollback, { changeId: emptyReceipt._id })).toBe(true);
  expect(await t.mutation(internal.migrations.extractionEvidence.rollback, { changeId: emptyReceipt._id })).toBe(false);
  expect((await t.run(ctx => ctx.db.get("extractionResults", ids.empty)))!.citationStatus).toBe("grounded");
  // Convex serializes object keys in sorted order, including nested citations.
  await t.run(ctx => ctx.db.patch("extractionResults", ids.pdf, {
    citations: pdf!.citations.map(citation => Object.fromEntries(Object.entries(citation).sort(([a], [b]) => a.localeCompare(b))) as typeof citation),
  }));
  const pdfReceipt = receipts.find(row => row.resultId === ids.pdf)!;
  expect(await t.mutation(internal.migrations.extractionEvidence.rollback, { changeId: pdfReceipt._id })).toBe(true);
  expect((await t.run(ctx => ctx.db.get("extractionResults", ids.pdf)))!.citations).toEqual(JSON.parse(pdfReceipt.before).citations);
});
