// PDFs handed to a screening (plans/screening-reviewers): a drop of any size is read in lanes, and a paper with its own PDF is screened without an abstract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { readAgain } from "./dealing";
import { give, paper, started, team, type Team } from "./reviewers.test-support";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const stored = ({ t }: Team, count: number, from = 0) =>
  t.run(async (ctx) => Promise.all(Array.from({ length: count }, async (_, i) => ({ file: await ctx.storage.store(new Blob([`pdf ${from + i}`])), name: `paper-${from + i}.pdf`, bytes: 10 }))));
const rowsOf = ({ t }: Team, batch: string) => t.run((ctx) => ctx.db.query("screeningFiles").withIndex("by_batch_and_at", (q) => q.eq("batch", batch)).collect());

describe("a drop of PDFs", () => {
  it("reads twenty at a time, each landing starting the one twenty after it, and counts how each stands", async () => {
    const made = await team(["ann", "ben"]);
    const { workspaceId } = made;
    const batch = "drop-1";
    await made.as.ann!.mutation(api.screening.files.add, { workspaceId, batch, files: await stored(made, 25) });
    let rows = await rowsOf(made, batch);
    expect(rows.map((row) => row.workId !== undefined)).toEqual([...Array(20).fill(true), ...Array(5).fill(false)]);

    // The first lands as a paper the index holds: the one twenty after it starts, and no other.
    await made.t.mutation(internal.screening.files.landed, { workId: rows[0]!.workId!, read: { state: "read", pages: 12, title: "Tutoring at scale", doi: "10.1000/a", known: true } });
    // The sixth doesn't open, and nothing is twenty after it yet.
    await made.t.mutation(internal.screening.files.landed, { workId: rows[5]!.workId!, read: { state: "broken" } });
    // The seventh's reading failed every try: it is screened as the file it is.
    await made.t.mutation(internal.screening.files.landed, { workId: rows[6]!.workId!, read: null });
    rows = await rowsOf(made, batch);
    expect(rows[20]!.workId).toBeDefined();
    expect(rows.slice(21).every((row) => row.workId === undefined)).toBe(true);
    expect(await made.as.ann!.query(api.screening.files.drop, { workspaceId, batch })).toEqual({ total: 25, waiting: 22, known: 1, file: 1, broken: 1 });

    // Files that arrive later: the one whose lane is free starts at once, the one behind a file still being read waits for it.
    await made.as.ann!.mutation(api.screening.files.add, { workspaceId, batch, files: await stored(made, 3, 25) });
    rows = await rowsOf(made, batch);
    expect([rows[25]!.workId !== undefined, rows[26]!.workId !== undefined, rows[27]!.workId !== undefined]).toEqual([true, true, false]);

    // A drop is its adder's: nobody else reads it or adds to it.
    await expect(made.as.ben!.query(api.screening.files.drop, { workspaceId, batch })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(made.as.ben!.mutation(api.screening.files.add, { workspaceId, batch, files: await stored(made, 1, 99) })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("what a source leaves out", () => {
  it("counts a paper the source holds twice once, and counts it again once each time the source is read again", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0);
    const bare = { ...paper(1), abstract: undefined };
    const { checkId, sourceId } = await made.t.run(async (ctx) => ({ checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id, sourceId: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id }));
    const sourceOf = () => made.t.run((ctx) => ctx.db.get("screeningSources", sourceId));
    const leftOut = () => made.t.run((ctx) => ctx.db.query("screeningLeftOut").collect());
    await made.t.mutation(internal.screening.gathering.begin, { sourceId });
    // A Zotero library reads a paper filed in two collections twice: in one step, and again in a later one.
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [bare, bare, paper(2)], read: 3, ended: false });
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [bare], read: 1, ended: true });
    expect(await sourceOf()).toMatchObject({ taken: 1, left: 1, bare: 1 });
    expect(await leftOut()).toHaveLength(1);

    // Read again from its start, by a later check or because its range changed while a check was running: what it leaves out is counted afresh, and named once.
    const again = (checkId: Id<"screeningChecks">) => made.t.run(async (ctx) => {
      await ctx.db.patch("screeningSources", sourceId, { ...readAgain((await ctx.db.get("screeningSources", sourceId))!), state: "reading" });
      return checkId;
    });
    await made.t.mutation(internal.screening.gathering.fill, { checkId: await again(checkId), sourceId, papers: [bare, bare], read: 2, ended: false });
    expect(await sourceOf()).toMatchObject({ left: 1, bare: 1 });
    const later = await made.t.run((ctx) => ctx.db.insert("screeningChecks", { jobId, at: 2, state: "running", beat: 2, from: 1, found: 0, added: 0 }));
    await made.t.mutation(internal.screening.gathering.fill, { checkId: await again(later), sourceId, papers: [bare, bare], read: 2, ended: true });
    expect(await sourceOf()).toMatchObject({ left: 1, bare: 1 });
    expect(await leftOut()).toHaveLength(1);
  });

  it("keeps what a source left out as it stood while the source is read again, and takes the new count once that reading is whole", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0);
    const { checkId, sourceId } = await made.t.run(async (ctx) => ({ checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id, sourceId: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id }));
    const sourceOf = () => made.t.run((ctx) => ctx.db.get("screeningSources", sourceId));
    const listed = async () => (await made.as.ann!.query(api.screening.view.leftOut, { workspaceId: made.workspaceId, jobId, sourceId, paginationOpts: { cursor: null, numItems: 10 } })).page.map((row) => row.name).sort();
    await made.t.mutation(internal.screening.gathering.begin, { sourceId });
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [{ ...paper(1), abstract: undefined }, { ...paper(2), abstract: undefined }], read: 2, ended: true });
    expect(await sourceOf()).toMatchObject({ left: 2, bare: 2 });
    // A check reads it again, and has met the first paper only so far: the page still says two were left out, and lists both.
    await made.t.run(async (ctx) => ctx.db.patch("screeningSources", sourceId, { ...readAgain((await ctx.db.get("screeningSources", sourceId))!), state: "reading" }));
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [{ ...paper(1), abstract: undefined }], read: 1, ended: false });
    expect(await sourceOf()).toMatchObject({ left: 2, bare: 2 });
    expect(await listed()).toEqual(["Paper 1", "Paper 2"]);
    // The second paper is gone from the source: once the reading is whole, one is left out.
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [], read: 0, ended: true });
    expect(await sourceOf()).toMatchObject({ left: 1, bare: 1 });
    expect((await sourceOf())!.next).toBeUndefined();
    expect(await listed()).toEqual(["Paper 1"]);
  });

  it("counts a paper a file lists twice as a duplicate merged, under two records or under one, so the file's records add up to what it held", async () => {
    const made = await team(["ann"]);
    const file = await made.t.run((ctx) => ctx.storage.store(new Blob(["title"])));
    const { jobId } = await started(made, ["ann"], 0, { sources: [{ set: { kind: "upload", file }, name: "export.csv" }] });
    const { checkId, sourceId } = await made.t.run(async (ctx) => ({ checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id, sourceId: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id }));
    const sourceOf = () => made.t.run((ctx) => ctx.db.get("screeningSources", sourceId));
    await made.t.mutation(internal.screening.gathering.begin, { sourceId });
    // Two records of one export with the same DOI, each under its own key, a third paper, and that third paper's record once more.
    const held = [paper(1, { doi: "10.1000/same" }), paper(2, { doi: "10.1000/same" }), paper(3), paper(3)];
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: held, read: 4, ended: true });
    expect(await sourceOf()).toMatchObject({ read: 4, taken: 2, duplicates: 2, left: 0 });
    expect(await made.t.run((ctx) => ctx.db.query("screeningLeftOut").collect())).toHaveLength(0);
    // Each repeat is named with the paper that stands for it, which this same file brought.
    const merged = (await made.as.ann!.query(api.screening.view.merged, { workspaceId: made.workspaceId, jobId, sourceId, paginationOpts: { cursor: null, numItems: 10 } })).page;
    expect(merged.map((row) => [row.name, row.paper?.title, row.paper?.sourceId])).toEqual([["Paper 2", "Paper 1", sourceId], ["Paper 3", "Paper 3", sourceId]]);
  });

  it("names a record another source already brought, and counts one it meets twice in a reading once", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0, { sources: [{ set: { kind: "saved" }, name: "Saved papers" }, { set: { kind: "saved" }, name: "Saved again" }] });
    const { checkId, sources } = await made.t.run(async (ctx) => ({ checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id, sources: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect()).map((one) => one._id) }));
    const [first, second] = sources as [Id<"screeningSources">, Id<"screeningSources">];
    for (const sourceId of sources) await made.t.mutation(internal.screening.gathering.begin, { sourceId });
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId: first, papers: [paper(1)], read: 1, ended: true });
    // The second source holds that paper too, and lists it under two of its folders, as a Zotero library does.
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId: second, papers: [paper(1), paper(1), paper(2)], read: 3, ended: true });
    expect(await made.t.run((ctx) => ctx.db.get("screeningSources", second))).toMatchObject({ taken: 1, duplicates: 1 });
    const merged = (await made.as.ann!.query(api.screening.view.merged, { workspaceId: made.workspaceId, jobId, sourceId: second, paginationOpts: { cursor: null, numItems: 10 } })).page;
    expect(merged.map((row) => [row.name, row.paper?.sourceId])).toEqual([["Paper 1", first]]);
  });

  it("passes over a paper the screening holds whose abstract a later reading doesn't bring, and leaves out only one that is new", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0);
    const { checkId, sourceId } = await made.t.run(async (ctx) => ({ checkId: (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id, sourceId: (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).first())!._id }));
    await made.t.mutation(internal.screening.gathering.begin, { sourceId });
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [paper(1)], read: 1, ended: true });
    await made.t.run(async (ctx) => ctx.db.patch("screeningSources", sourceId, { ...readAgain((await ctx.db.get("screeningSources", sourceId))!), state: "reading" }));
    await made.t.mutation(internal.screening.gathering.fill, { checkId, sourceId, papers: [{ ...paper(1), abstract: undefined }, { ...paper(2), abstract: undefined }], read: 2, ended: true });
    expect(await made.t.run((ctx) => ctx.db.get("screeningSources", sourceId))).toMatchObject({ taken: 1, left: 1, bare: 1 });
    expect(await made.t.run((ctx) => ctx.db.query("screeningLeftOut").collect())).toMatchObject([{ name: "Paper 2", why: "abstract" }]);
  });
});

describe("a paper with its own PDF", () => {
  it("goes to the models that take a file, and never to one that reads text only", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0);
    const [reads, textOnly] = await made.t.run(async (ctx) => {
      const model = { provider: "openrouter", inputPricePerMillion: 0.1, outputPricePerMillion: 0.4, costMarkup: 1, contextLength: 400_000, supportedParameters: [], isServed: true, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 };
      const withFiles = await ctx.db.insert("models", { ...model, modelId: "test/reads-files", name: "Reads files", inputModalities: ["text", "file"] });
      const text = await ctx.db.insert("models", { ...model, modelId: "test/text-only", name: "Text only", inputModalities: ["text"] });
      const on = (modelId: Id<"models">) => ctx.db.insert("screeningReviewers", { jobId, kind: "model", modelId, addedAt: 1, addedBy: made.ids.ann!, dealt: 0 });
      return [await on(withFiles), await on(text)];
    });
    const file: Id<"_storage"> = (await stored(made, 1))[0]!.file;
    const { papers } = await give(made.t, jobId, 0, [paper(1), { ...paper(2), abstract: undefined, file, pages: 12 }]);
    const on = async (paperId: Id<"screeningResults">) => (await made.t.run((ctx) => ctx.db.query("screeningVotes").withIndex("by_result", (q) => q.eq("resultId", paperId)).collect())).map((vote) => vote.reviewerId);
    // The paper with an abstract is every reviewer's. The one that is only its PDF is not the text-only model's: it has nothing to fail on there.
    expect(await on(papers[0]!._id)).toEqual(expect.arrayContaining([reads, textOnly]));
    expect(await on(papers[1]!._id)).toContain(reads);
    expect(await on(papers[1]!._id)).not.toContain(textOnly);
  });

  it("is screened as the file where it has no abstract, and one with neither is left out", async () => {
    const made = await team(["ann"]);
    const { jobId } = await started(made, ["ann"], 0);
    const file: Id<"_storage"> = (await stored(made, 1))[0]!.file;
    const { papers, sourceId } = await give(made.t, jobId, 0, [paper(1), { ...paper(2), abstract: undefined, file, pages: 40 }, { ...paper(3), abstract: undefined }]);
    expect(papers.map((one) => [one.title, one.abstract !== undefined, one.pages])).toEqual([["Paper 1", true, undefined], ["Paper 2", false, 40]]);
    expect(await made.t.run((ctx) => ctx.db.query("screeningLeftOut").collect())).toMatchObject([{ sourceId, name: "Paper 3", why: "abstract" }]);

    const seen = await made.as.ann!.query(api.screening.paperViews.paper, { workspaceId: made.workspaceId, jobId, paperId: papers[1]!._id });
    expect(seen).toMatchObject({ abstract: "", pdf: { pages: 40 } });
    expect(await made.as.ann!.query(api.screening.paperViews.pdf, { workspaceId: made.workspaceId, jobId, paperId: papers[1]!._id })).toEqual(expect.any(String));
    // A paper screened on its abstract has no PDF of its own to show.
    expect(await made.as.ann!.query(api.screening.paperViews.pdf, { workspaceId: made.workspaceId, jobId, paperId: papers[0]!._id })).toBeNull();
  });
});
