// Papers kept before they were named by their source get their identity (plans/evidence-library-sources).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { insertJob } from "../screening/createJob.test-support";
import { madeBy } from "../workspaces/actor.test-support";

it("names every stored paper by its source, moves ratings and kept undos to it, finds duplicates, and leaves what it can't place for the report", async () => {
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

      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W1", rating: 4 });
      // Rated again under its key since: that is the person's rating now.
      await ctx.db.insert("ratings", { userId: ada, paperId: "https://openalex.org/W3", rating: 1 });
      await ctx.db.insert("ratings", { userId: ada, paperId: "openalex:W3", rating: 5 });

      const threadId = await ctx.db.insert("assistantThreads", { ...where, title: "Chat", agentThreadId: "agent", lastMessageAt: 1, createdAt: 1, updatedAt: 1 });
      const step = { threadId, workspaceId: where.workspaceId, order: 0, userId: ada, toolCallId: "call", input: "{}", status: "done" as const, startedAt: 1 };
      const stepId = await ctx.db.insert("assistantSteps", { ...step, path: "library/mutations:setPaperInCollection", undo: { path: "library/mutations:setPaperInCollection", args: JSON.stringify({ paper: { openalexId: "https://openalex.org/W1", savedAt: 1 }, collectionId: "c", inCollection: false }) } });
      await ctx.db.insert("assistantStepUndos", { threadId, stepId, path: "library/mutations:removeFromLibrary", args: JSON.stringify({ openalexId: "https://openalex.org/W1", expect: { savedAt: 1, rating: null } }) });
      await ctx.db.insert("assistantStepUndos", { threadId, stepId, path: "screening/papers:answer", args: JSON.stringify({ openalexId: "W1" }) });
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
      ratings: (await ctx.db.query("ratings").collect()).map(({ paperId, rating }) => ({ paperId, rating })),
      undo: JSON.parse((await ctx.db.query("assistantSteps").first())!.undo!.args),
      undos: (await ctx.db.query("assistantStepUndos").collect()).map(({ args }) => JSON.parse(args)),
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
    expect(rows.ratings).toEqual([{ paperId: "openalex:W1", rating: 4 }, { paperId: "openalex:W3", rating: 5 }]);
    expect(rows.undo.paper).toEqual({ paper: "https://openalex.org/W1", savedAt: 1 });
    // What another action takes stays as it is.
    expect(rows.undos).toEqual([{ paper: "https://openalex.org/W1", expect: { savedAt: 1, rating: null } }, { openalexId: "W1" }]);

    const after = await t.action(internal.migrations.paperIdentity.verify, {});
    expect(after.libraryItems).toEqual({ left: 0, unplaced: 0, sample: [] });
    expect(after.screeningResults.left).toBe(0);
    expect(after.extractionPapers).toEqual({ left: 1, unplaced: 1, sample: ["history:lost"] });
    expect(after.ratings.left).toBe(0);
    // W1 is one paper saved twice in one workspace: the narrowing step has to merge it first.
    expect(after.duplicates.count).toBe(1);
    expect(after.duplicates.sample[0]).toMatch(/\|openalex:W1$/);
  } finally {
    vi.useRealTimers();
  }
});

it("narrows: drops the rows no key names as removing or deleting them does, and the old ID from every other row", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      const where = await madeBy(ctx, ada);
      const saved = (fields: Record<string, unknown>) => ctx.db.insert("libraryItems", { ...where, title: "Saved", searchableText: "saved", savedAt: 1, updatedAt: 1, ...fields });
      const keyed = await saved({ openalexId: "https://openalex.org/W1", paperKey: "openalex:W1", ref: { source: "openalex", work: "W1" } });
      const fixture = await saved({ openalexId: "W_PLAN05_1" });
      const collectionId = await ctx.db.insert("collections", { ...where, name: "Trials", sortName: "trials", itemCount: 2, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId: keyed, assignedAt: 1 });
      await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId: fixture, assignedAt: 1 });
      await ctx.db.insert("libraryCounts", { workspaceId: where.workspaceId, count: 2 });
      for (const removed of [keyed, fixture]) {
        const { _id, _creationTime, workspaceId, ...kept } = (await ctx.db.get("libraryItems", removed))!;
        await ctx.db.insert("libraryRemovals", { workspaceId, item: kept, itemId: removed, expiresAt: 10_000_000 });
      }
      await ctx.db.insert("ratings", { userId: ada, paperId: "openalex:W1", rating: 4 });
      await ctx.db.insert("ratings", { userId: ada, paperId: "W_PLAN05_1", rating: 2 });

      const jobId = await insertJob(ctx, { userId: ada, status: "completed", totalPapers: 2, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("screeningResults", { jobId, openalexId: "https://openalex.org/W1", paperKey: "openalex:W1", title: "W1", status: "completed", createdAt: 1 });
      // A fixture's job goes whole, with its progress, in as many steps as it takes.
      const fixtureJob = await insertJob(ctx, { userId: ada, status: "completed", totalPapers: 250, questions: [], scoringConfig: { rules: [], starThresholds: [] }, createdAt: 1, updatedAt: 1 });
      for (let n = 0; n < 250; n++) await ctx.db.insert("screeningResults", { jobId: fixtureJob, openalexId: `https://openalex.org/WOS321QA${n}`, title: "Fixture", status: "completed", createdAt: 1 });
      const extraction = await ctx.db.insert("extractionJobs", { ...where, sourceType: "history", status: "completed", totalPapers: 1, name: "Job", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("extractionPapers", { jobId: extraction, openalexId: "https://openalex.org/W1", paperKey: "openalex:W1", title: "W1", status: "completed", processable: true });
      const fixtureExtraction = await ctx.db.insert("extractionJobs", { ...where, sourceType: "history", status: "completed", totalPapers: 1, name: "Fixture", createdAt: 1, updatedAt: 1 });
      const lost = await ctx.db.insert("extractionPapers", { jobId: fixtureExtraction, openalexId: "library:os321-fixture", title: "Fixture", status: "completed", processable: true });
      await ctx.db.insert("extractionResults", { jobId: fixtureExtraction, paperId: lost, questionKey: "q", answer: "x", citations: [], citationStatus: "best_effort", confidence: 0.5, status: "completed", processedAt: 1 });
    });

    await t.mutation(internal.migrations.paperIdentity.narrow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await t.run(async (ctx) => ({
      saved: (await ctx.db.query("libraryItems").collect()).map(({ openalexId, paperKey }) => ({ openalexId, paperKey })),
      places: (await ctx.db.query("libraryItemCollections").collect()).length,
      removed: (await ctx.db.query("libraryRemovals").collect()).map(({ item }) => ({ openalexId: item.openalexId, paperKey: item.paperKey })),
      ratings: (await ctx.db.query("ratings").collect()).map(({ paperId }) => paperId),
      screened: (await ctx.db.query("screeningResults").collect()).map(({ openalexId, paperKey }) => ({ openalexId, paperKey })),
      extracted: (await ctx.db.query("extractionPapers").collect()).map(({ openalexId, paperKey }) => ({ openalexId, paperKey })),
      results: (await ctx.db.query("extractionResults").collect()).length,
      jobs: [(await ctx.db.query("screeningJobs").collect()).length, (await ctx.db.query("screeningJobProgress").collect()).length, (await ctx.db.query("extractionJobs").collect()).length],
      counts: [(await ctx.db.query("libraryCounts").first())?.count, (await ctx.db.query("collections").first())?.itemCount],
    }));
    expect(rows).toEqual({
      saved: [{ openalexId: undefined, paperKey: "openalex:W1" }],
      places: 1,
      removed: [{ openalexId: undefined, paperKey: "openalex:W1" }],
      ratings: ["openalex:W1"],
      screened: [{ openalexId: undefined, paperKey: "openalex:W1" }],
      extracted: [{ openalexId: undefined, paperKey: "openalex:W1" }],
      results: 0,
      jobs: [1, 1, 1],
      counts: [1, 1],
    });
    expect(await t.action(internal.migrations.paperIdentity.verify, {})).toMatchObject({ libraryItems: { left: 0 }, screeningResults: { left: 0 }, extractionPapers: { left: 0 }, ratings: { left: 0 } });
  } finally {
    vi.useRealTimers();
  }
});
