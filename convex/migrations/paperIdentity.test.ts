// Papers kept before they were named by their source get their identity (plans/evidence-library-sources).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertJob } from "../screening/createJob.test-support";
import { madeBy } from "../workspaces/actor.test-support";

it("names every stored paper by its source, finds duplicates, and leaves what it can't place for the report", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      const where = await madeBy(ctx, ada);
      const saved = (openalexId: string, extra: Record<string, string> = {}) =>
        ctx.db.insert("libraryItems", { ...where, openalexId, title: openalexId, searchableText: openalexId, savedAt: 1, updatedAt: 1, ...extra });
      await saved("https://openalex.org/W1", { doi: "https://doi.org/10.1/AB" });
      // The same paper saved again under its bare ID, before the library kept one form.
      await saved("W1");
      const removed = await saved("https://openalex.org/W2");
      const item = (await ctx.db.get("libraryItems", removed))!;
      const { _id, _creationTime, workspaceId, ...kept } = item;
      await ctx.db.insert("libraryRemovals", { workspaceId, item: kept, itemId: removed, expiresAt: 10 });
      await ctx.db.delete("libraryItems", removed);

      const jobId = await insertJob(ctx, { userId: ada, status: "completed", totalPapers: 2, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
      const result = (openalexId: string, pdfUrl?: string) =>
        ctx.db.insert("screeningResults", { jobId, openalexId, title: openalexId, status: "completed", createdAt: 1, ...(pdfUrl ? { pdfUrl } : {}) });
      await result("zotero:group:JUDM2WBF", "zotero://select/groups/2129771/items/JUDM2WBF");
      await result("https://openalex.org/W3");

      const extraction = await ctx.db.insert("extractionJobs", { ...where, sourceType: "history", status: "completed", totalPapers: 2, name: "Job", createdAt: 1, updatedAt: 1 });
      const paper = (openalexId: string) => ctx.db.insert("extractionPapers", { jobId: extraction, openalexId, title: openalexId, status: "completed", processable: true });
      await paper("upload:kg2storage");
      // An ID from before any source kept one: nothing names its paper.
      await paper("history:lost");
    });

    const before = await t.action(internal.migrations.paperIdentity.verify, {});
    expect(before.libraryItems.left).toBe(2);
    expect(before.extractionPapers).toEqual({ left: 2, unplaced: 1, sample: ["history:lost"] });

    await t.mutation(internal.migrations.paperIdentity.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await t.run(async (ctx) => ({
      saved: (await ctx.db.query("libraryItems").collect()).map(({ openalexId, paperKey, ref, crossRefs }) => ({ openalexId, paperKey, ref, crossRefs })),
      removed: (await ctx.db.query("libraryRemovals").collect()).map(({ item }) => item.paperKey),
      screened: (await ctx.db.query("screeningResults").collect()).map(({ paperKey, ref }) => ({ paperKey, ref })),
      extracted: (await ctx.db.query("extractionPapers").collect()).map(({ openalexId, paperKey }) => ({ openalexId, paperKey })),
    }));
    expect(rows.saved).toEqual([
      { openalexId: "https://openalex.org/W1", paperKey: "openalex:W1", ref: { source: "openalex", work: "W1" }, crossRefs: { openalexId: "W1", doi: "10.1/ab" } },
      { openalexId: "W1", paperKey: "openalex:W1", ref: { source: "openalex", work: "W1" }, crossRefs: { openalexId: "W1" } },
    ]);
    expect(rows.removed).toEqual(["openalex:W2"]);
    expect(rows.screened).toEqual([
      { paperKey: "zotero:group:2129771:JUDM2WBF", ref: { source: "zotero", library: "group", owner: "2129771", key: "JUDM2WBF" } },
      { paperKey: "openalex:W3", ref: { source: "openalex", work: "W3" } },
    ]);
    expect(rows.extracted).toEqual([
      { openalexId: "upload:kg2storage", paperKey: "upload:kg2storage" },
      { openalexId: "history:lost", paperKey: undefined },
    ]);

    const after = await t.action(internal.migrations.paperIdentity.verify, {});
    expect(after.libraryItems).toEqual({ left: 0, unplaced: 0, sample: [] });
    expect(after.screeningResults.left).toBe(0);
    expect(after.extractionPapers).toEqual({ left: 1, unplaced: 1, sample: ["history:lost"] });
    // W1 is one paper saved twice in one workspace: the narrowing step has to merge it first.
    expect(after.duplicates.count).toBe(1);
    expect(after.duplicates.sample[0]).toMatch(/\|openalex:W1$/);
  } finally {
    vi.useRealTimers();
  }
});
