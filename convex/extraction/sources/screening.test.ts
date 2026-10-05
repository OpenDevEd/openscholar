import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import { screeningInputs } from "./screening.test-support";
import { seedFeatureUser, seedOrganizationFeatures } from "../../organizationFeatures.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("extraction from Included screening papers", () => {
  it.each([false, true])("saves screening metadata and revision through overlaps, exclusion and undo, library first: %s", async (libraryFirst) => {
    const { t, as, userId, jobId, selection, start, snapshot, papers } = await screeningInputs();
    const libraryId = await t.run(ctx => ctx.db.insert("libraryItems", { userId, openalexId: "https://openalex.org/W0", title: "Separately saved paper", rating: 4, searchableText: "saved paper", savedAt: 1, updatedAt: 1 }));
    const source = await selection();
    const inputs = [source, { source: "library" as const, bucketKey: "library:W0", sourceRefId: libraryId, title: "Overlap", authors: [] }];
    const first = await start(libraryFirst ? inputs.reverse() : inputs);
    expect(await snapshot(first.jobId)).toMatchObject({ totalPapers: 2, processableCount: 2 });
    const frozen = await papers(first.jobId);
    expect(frozen.map(p => p.openalexId)).toEqual(["https://openalex.org/W0", "https://openalex.org/W1"]);
    expect(frozen[0]).toMatchObject({ title: "Study 0", authors: ["Piper, B.", "ليلى"], venueName: "Education Research", citedByCount: 0, sourceType: "screening", sourceId: jobId, screeningRevision: source.screeningSelection!.revision });
    expect(frozen[0].abstract).not.toBe(source.abstract);
    const changed = await as.mutation(api.screening.papers.answer, { jobId, paperId: "https://openalex.org/W0", questionKey: "q1", answer: false });
    await expect(start([source])).rejects.toThrow(/decisions changed/);
    await expect(as.mutation(api.extraction.mutations.duplicateJob, { jobId: first.jobId })).rejects.toThrow(/decisions changed/);
    const second = await start();
    await snapshot(second.jobId);
    expect((await papers(second.jobId)).map(p => p.openalexId)).toEqual(["https://openalex.org/W1"]);
    expect(await papers(first.jobId)).toEqual(frozen);
    expect(await t.run(ctx => ctx.db.get("libraryItems", libraryId))).toMatchObject({ rating: 4, title: "Separately saved paper" });
    expect(changed.undo).toBeDefined();
    await as.mutation(api.screening.papers.answer, changed.undo!.args);
    const third = await start();
    await snapshot(third.jobId);
    expect((await papers(third.jobId)).map(p => p.openalexId)).toEqual(frozen.map(p => p.openalexId));
  });

  it("rejects same-count edits between selection, pagination and capture before saving any papers", async () => {
    const { t, as, userId, jobId, selection, start, snapshot, papers } = await screeningInputs(101);
    const source = await selection();
    const created = await start([source]);
    const first = await t.query(internal.paperSets.held.page, { userId, set: { kind: "screening", jobId }, revision: source.screeningSelection!.revision, cursor: null, numItems: 100 });
    expect(first.page).toHaveLength(100);
    await as.mutation(api.screening.papers.answer, { jobId, paperId: "https://openalex.org/W0", questionKey: "q2", answer: false });
    expect((await selection()).screeningSelection!.count).toBe(101);
    await expect(start([source])).rejects.toThrow(/decisions changed/);
    await expect(t.query(internal.paperSets.held.page, { userId, set: { kind: "screening", jobId }, revision: source.screeningSelection!.revision, cursor: first.continueCursor, numItems: 100 })).rejects.toThrow(/decisions changed/);
    await expect(snapshot(created.jobId)).rejects.toThrow(/decisions changed/);
    expect(await papers(created.jobId)).toEqual([]);
  });

  it("refuses another account's or deleted job without creating an extraction", async () => {
    const { t, jobId, selection, start } = await screeningInputs();
    await t.run(async ctx => { await seedOrganizationFeatures(ctx, ["outsider"], { extraction: true }); await seedFeatureUser(ctx, "outsider"); });
    const source = await selection();
    await expect(t.withIdentity({ subject: "outsider" }).mutation(api.extraction.mutations.startJob, { name: "No access", mode: "extraction", bucketItems: [source] })).rejects.toThrow(/Screening not found/);
    await t.run(ctx => ctx.db.delete("screeningJobs", jobId));
    await expect(start([source])).rejects.toThrow(/Screening not found/);
    expect(await t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });

  it("rejects empty and oversized inclusions and uses the server count for the combined cap", async () => {
    const empty = await screeningInputs(0);
    await expect(empty.start()).rejects.toThrow(/no Included papers/);
    const full = await screeningInputs(1000);
    const source = await full.selection();
    source.screeningSelection!.count = 1;
    await expect(full.start([source, { source: "upload", bucketKey: "extra", sourceRefId: "extra", title: "Extra paper", authors: [] }])).rejects.toThrow(/1001 papers/);
    await full.t.run(async ctx => {
      const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", q => q.eq("jobId", full.jobId)).unique())!;
      await ctx.db.patch("screeningJobProgress", progress._id, { qualified: 1001 });
    });
    await expect(full.start()).rejects.toThrow(/includes 1001/);
    expect(await full.t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });

  it("counts one screening once even if a caller supplies different bucket keys", async () => {
    const { t, selection, start } = await screeningInputs(600);
    const source = await selection();
    const created = await start([{ ...source, bucketKey: "a" }, { ...source, bucketKey: "b" }]);
    const sources = await t.run(ctx => ctx.db.query("extractionJobSources").withIndex("by_job_and_position", q => q.eq("jobId", created.jobId)).take(3));
    expect(sources).toHaveLength(1);
    expect(sources[0].screeningSelection?.count).toBe(600);
  });

  it("refuses capture while a screening is processing", async () => {
    const { t, jobId, start } = await screeningInputs();
    await t.run(ctx => ctx.db.patch("screeningJobs", jobId, { status: "processing" }));
    await expect(start()).rejects.toThrow(/still processing/);
    expect(await t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });
});
