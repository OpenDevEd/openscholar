// A job's setup reads its sources a step at a time (#634): a library range of any length as one
// source, and a screening's copy of a paper taking the place of another source's.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { writeJobSources } from "./jobSources";
import { setupExtractionPaperWorkpool } from "./queue/workpool.test-support";
import { madeBy } from "../workspaces/actor.test-support";
import { paperOf } from "../lib/paperRef.test-support";

const abstract = "A long enough abstract for the paper to be read from it, about tutoring in primary schools.";

it("reads a collection's range as one source, a page at a time, and runs every paper", { tags: ["size"] }, async () => {
  const t = convexTest(schema);
  setupExtractionPaperWorkpool(t);
  const papers = 250;
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "range", email: "range@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    const collectionId = await ctx.db.insert("collections", { ...(await madeBy(ctx, userId)), name: "Trials", sortName: "trials", itemCount: papers, createdAt: 1, updatedAt: 1 });
    for (let i = 0; i < papers; i++) {
      const libraryItemId = await ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paperOf(`https://openalex.org/W${i}`), title: `Paper ${i}`, abstract, searchableText: "x", savedAt: i, updatedAt: 1 });
      await ctx.db.insert("libraryItemCollections", { collectionId, libraryItemId, assignedAt: 1 });
    }
    const id = await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Range", status: "pending", runEpoch: 0, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
    await writeJobSources(ctx, id, [{ source: "collection", bucketKey: "range", sourceRefId: collectionId, title: "Trials", authors: [], librarySet: { collectionId, first: 1, last: papers, count: papers } }]);
    return id;
  });
  await t.action(internal.extraction.actions.setupExtractionQueueJob, { jobId, expectedEpoch: 0 });
  const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId as Id<"extractionJobs">));
  expect(job).toMatchObject({ status: "extracting", totalPapers: papers });
  expect(job?.setup).toBeUndefined();
  const saved = await t.run(async (ctx) => (await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(papers + 1)).length);
  expect(saved).toBe(papers);
  // Queued a page at a time: the first now, the rest in the page it scheduled.
  const queued = await t.run(async (ctx) => (await ctx.db.query("extractionPaperQueue").withIndex("by_job_and_status", (q) => q.eq("jobId", jobId)).take(papers + 1)).length);
  expect(queued).toBe(200);
  const next = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").take(50)).filter((fn) => fn.name.includes("requeueLater") && fn.state.kind === "pending"));
  expect(next).toHaveLength(1);
});

it("a screening's copy takes another source's place, and one the job can't read takes it out", async () => {
  const t = convexTest(schema);
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "copies", email: "copies@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Copies", status: "pending", runEpoch: 0, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
  });
  const step = (papers: object[], position: number) => t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: papers as never, setup: { expectedEpoch: 0, next: { position, read: 0, papers: 0, processable: 0 } } });
  const setupOf = async () => (await t.run((ctx) => ctx.db.get("extractionJobs", jobId)))!.setup!;
  await step([{ paper: "W1", title: "One", abstract, sourceType: "history", sourceId: "s" }, { paper: "W2", title: "Two", abstract, sourceType: "history", sourceId: "s" }], 1);
  expect(await setupOf()).toMatchObject({ papers: 2, processable: 2 });
  // The screening's copy of W1 keeps its provenance; its copy of W2 has nothing to read, so W2 goes.
  const counted = await setupOf();
  await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: [{ paper: "W1", title: "One, screened", abstract, sourceType: "screening", sourceId: "job", screeningRevision: "r1" }, { paper: "W2", title: "Two", sourceType: "screening", sourceId: "job" }] as never, setup: { expectedEpoch: 0, next: { ...counted, position: 2 } } });
  expect(await setupOf()).toMatchObject({ papers: 1, processable: 1 });
  const kept = await t.run(async (ctx) => await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(5));
  expect(kept.map((paper) => [paper.paperKey, paper.sourceType, paper.screeningRevision])).toEqual([["openalex:W1", "screening", "r1"]]);
});

it("a job cancelled between two steps of its setup counts the papers it has", async () => {
  const t = convexTest(schema);
  const jobId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "stopped", email: "stopped@test", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("featureFlags", { key: "extraction.pdf", enabled: false, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { ...(await madeBy(ctx, userId)), name: "Stopped", status: "pending", runEpoch: 0, totalPapers: 0, setup: { position: 0, read: 0, papers: 0, processable: 0 }, createdAt: 1, updatedAt: 1 });
  });
  const paper = (n: number) => ({ paper: `W${n}`, title: `Paper ${n}`, abstract, sourceType: "history", sourceId: "s" });
  // Its first step saves two papers; the cancel lands before the second.
  await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: [paper(1), paper(2)] as never, setup: { expectedEpoch: 0, next: { position: 1, read: 2, papers: 0, processable: 0 } } });
  await t.run((ctx) => ctx.db.patch("extractionJobs", jobId, { status: "cancelled", runEpoch: 1 }));
  // The step that was on its way saves nothing, and the setup's last write changes nothing.
  await t.mutation(internal.extraction.mutations.papers.createPaperRecords, { jobId, papers: [paper(3)] as never, setup: { expectedEpoch: 0, next: { position: 2, read: 3, papers: 2, processable: 2 } } });
  await t.mutation(internal.extraction.mutations.results.updateJobStatus, { jobId, expectedEpoch: 0, status: "indexing", totalPapers: 3 });
  const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
  const rows = await t.run(async (ctx) => (await ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(10)).length);
  expect(rows).toBe(2);
  expect(job).toMatchObject({ status: "cancelled", totalPapers: rows });
});
