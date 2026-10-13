import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageIdOf } from "../../../lib/papers/paper-ref";
import { api, internal } from "../../_generated/api";
import { screeningInputs } from "./screening.test-support";
import { seedFeatureUser } from "../../organizationFeatures.test-support";
import { madeBy } from "../../workspaces/actor.test-support";
import { accountOf } from "../../billing/billing.test-support";
import { savedPapersPick } from "../picks.test-support";
import { paperOf } from "../../lib/paperRef.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("extraction from Included screening papers", () => {
  it.each([false, true])("saves screening metadata and revision through overlaps, exclusion and undo, library first: %s", async (libraryFirst) => {
    const { t, as, userId, jobId, selection, revision, start, snapshot, papers } = await screeningInputs();
    const libraryId = await t.run(async ctx => ctx.db.insert("libraryItems", { ...(await madeBy(ctx, userId)), ...paperOf("https://openalex.org/W0"), title: "Separately saved paper", rating: 4, searchableText: "saved paper", savedAt: 1, updatedAt: 1 }));
    const source = selection();
    const decided = await revision();
    const inputs = [source, await savedPapersPick(t, userId, 1)];
    const first = await start(libraryFirst ? inputs.reverse() : inputs);
    expect(await snapshot(first.jobId)).toMatchObject({ totalPapers: 2, processableCount: 2 });
    const frozen = await papers(first.jobId);
    expect(frozen.map(p => pageIdOf(p))).toEqual(["https://openalex.org/W0", "https://openalex.org/W1"]);
    expect(frozen[0]).toMatchObject({ title: "Study 0", authors: ["Piper, B.", "ليلى"], venueName: "Education Research", citedByCount: 0, sourceType: "screening", sourceId: jobId, screeningRevision: decided });
    const changed = await as.mutation(api.screening.papers.answer, { jobId, paperId: "https://openalex.org/W0", questionKey: "q1", answer: false });
    // A copy of the job reads the decisions it was started with, which have changed; a new job reads them as they are.
    await expect(as.mutation(api.extraction.mutations.duplicateJob, { jobId: first.jobId })).rejects.toThrow(/decisions changed/);
    const second = await start();
    await snapshot(second.jobId);
    expect((await papers(second.jobId)).map(p => pageIdOf(p))).toEqual(["https://openalex.org/W1"]);
    expect(await papers(first.jobId)).toEqual(frozen);
    expect(await t.run(ctx => ctx.db.get("libraryItems", libraryId))).toMatchObject({ rating: 4, title: "Separately saved paper" });
    expect(changed.undo).toBeDefined();
    await as.mutation(api.screening.papers.answer, changed.undo!.args);
    const third = await start();
    await snapshot(third.jobId);
    expect((await papers(third.jobId)).map(p => pageIdOf(p))).toEqual(frozen.map(p => pageIdOf(p)));
  });

  it("rejects same-count edits between selection, pagination and capture before saving any papers", async () => {
    const { t, as, userId, jobId, revision, start, snapshot, papers } = await screeningInputs(101);
    const decided = await revision();
    const created = await start();
    const first = await t.query(internal.paperSets.held.page, { userId, set: { kind: "screening", jobId }, revision: decided, cursor: null, numItems: 100 });
    expect(first.page).toHaveLength(100);
    await as.mutation(api.screening.papers.answer, { jobId, paperId: "https://openalex.org/W0", questionKey: "q2", answer: false });
    await expect(t.query(internal.paperSets.held.page, { userId, set: { kind: "screening", jobId }, revision: decided, cursor: first.continueCursor, numItems: 100 })).rejects.toThrow(/decisions changed/);
    await expect(snapshot(created.jobId)).rejects.toThrow(/decisions changed/);
    expect(await papers(created.jobId)).toEqual([]);
  });

  it("refuses another account's or deleted job without creating an extraction", async () => {
    const { t, jobId, selection, start } = await screeningInputs();
    await t.run(async ctx => { await seedFeatureUser(ctx, "outsider"); });
    const source = selection();
    await expect(t.withIdentity({ subject: "outsider" }).mutation(api.extraction.mutations.startJob, { name: "No access", sources: [source] })).rejects.toThrow(/Screening not found/);
    await t.run(ctx => ctx.db.delete("screeningJobs", jobId));
    await expect(start([source])).rejects.toThrow(/Screening not found/);
    expect(await t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });

  it("rejects empty inclusions, and counts a screening by the server's count against the plan (#632)", async () => {
    const empty = await screeningInputs(0);
    await expect(empty.start()).rejects.toThrow(/no Included papers/);
    const full = await screeningInputs(1000);
    // A plan that takes 1,000 papers in one extraction.
    await full.t.run(async ctx => {
      const account = await accountOf(ctx, full.userId);
      await ctx.db.patch("billingAccounts", account!._id, { limits: { request_papers: 1000 } });
    });
    // The server counts the screening: 1,000, and one more paper is past the plan.
    const extra = await full.t.run(ctx => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));
    await expect(full.start([full.selection()], [{ storageId: extra, title: "Extra paper" }])).rejects.toThrow(/plan takes up to 1,000 papers/);
    await full.t.run(async ctx => {
      const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", q => q.eq("jobId", full.jobId)).unique())!;
      await ctx.db.patch("screeningJobProgress", progress._id, { qualified: 1001 });
    });
    await expect(full.start()).rejects.toThrow(/plan takes up to 1,000 papers/);
    expect(await full.t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });

  it("counts one screening once even if a caller picks it twice", async () => {
    const { t, selection, start } = await screeningInputs(600);
    const created = await start([selection(), selection()]);
    const sources = await t.run(ctx => ctx.db.query("extractionJobSources").withIndex("by_job_and_position", q => q.eq("jobId", created.jobId)).take(3));
    expect(sources).toHaveLength(1);
    expect(sources[0].screeningSelection?.count).toBe(600);
  });

  it("reads a range of a screening's Included papers, counted by the server (#690)", async () => {
    const { t, jobId, start, snapshot, papers } = await screeningInputs(5);
    const created = await start([{ set: { kind: "screening", jobId }, first: 2, last: 3 }]);
    const sources = await t.run(ctx => ctx.db.query("extractionJobSources").withIndex("by_job_and_position", q => q.eq("jobId", created.jobId)).take(2));
    expect(sources[0].screeningSelection).toMatchObject({ first: 2, last: 3, count: 2 });
    expect(await snapshot(created.jobId)).toMatchObject({ totalPapers: 2 });
    expect((await papers(created.jobId)).map(p => pageIdOf(p))).toEqual(["https://openalex.org/W1", "https://openalex.org/W2"]);
  });

  it("refuses capture while a screening is processing", async () => {
    const { t, jobId, start } = await screeningInputs();
    await t.run(ctx => ctx.db.patch("screeningJobs", jobId, { status: "processing" }));
    await expect(start()).rejects.toThrow(/still processing/);
    expect(await t.run(ctx => ctx.db.query("extractionJobs").take(1))).toEqual([]);
  });
});
