import { seedOrganizationFeatures } from "../../organizationFeatures.test-support";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { foldCounts } from "../counts.test-support";
import { readExtractionExport } from "../../../lib/extraction/export";
import { recomputePaperListProjection } from "../listProjection";

const CLERK_OWNER = "clerk_results_page_owner";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

const DEFAULT_FILTERS = {
  searchQuery: "",
  confidenceRange: [0, 100] as [number, number],
  statusFilters: [] as string[],
  questionFilters: [] as Array<{
    questionKey: string;
    value: Doc<"extractionResults">["answer"];
  }>,
};

async function seedJobWithProjectionCorpus(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await seedOrganizationFeatures(ctx, [CLERK_OWNER], { extraction: true });
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId: CLERK_OWNER,
      email: "results-page@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      description: "extraction.enabled (test)",
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Results Page Test",
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 60,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 1; i <= 60; i += 1) {
      const title =
        i === 30
          ? "Alpha Result"
          : i === 40
            ? "Mike Result"
            : i === 52
              ? "Rare Search Match"
              : `Paper ${i}`;

      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:${i}`,
        title,
        processable: true,
        status: "completed" as const,
        pdfContentUsed: i === 52,
        isOpenAccess: i === 52,
        sortTitle: title.toLowerCase(),
        avgConfidence:
          i === 30 ? 0.15 : i === 40 ? 0.75 : i === 52 ? 0.95 : 0.58,
        hasErrors: false,
        hasPdfSource: i === 52,
        questionAnswerTokens: i === 52 ? ["q1::yes"] : [],
        searchText:
          i === 52
            ? "rare search match target answer"
            : `${title.toLowerCase()} generic corpus text`,
      });

      if (i === 52) {
        const resultId = await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: "q1",
          answer: "Target answer",
          citations: [],
          citationStatus: "grounded" as const,
          confidence: 0.95,
          status: "completed" as const,
          processedAt: now,
        });
      }
    }

    return { jobId };
  });
}

type View = Partial<{ cursor: string | null; numItems: number; selectedPaperIds: Doc<"extractionPapers">["_id"][]; filters: typeof DEFAULT_FILTERS; sortBy: "default" | "title-asc" | "title-desc" | "confidence-high" | "confidence-low" }>;

async function listResults(auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, jobId: string, view?: View) {
  return await auth.query(api.extraction.queries.listJobResults, {
    jobId: jobId as never,
    filters: view?.filters ?? DEFAULT_FILTERS,
    sortBy: view?.sortBy ?? "default",
    paginationOpts: { cursor: view?.cursor ?? null, numItems: view?.numItems ?? 25 },
    selectedPaperIds: view?.selectedPaperIds,
  });
}

/** Every page of a view, read one after another by cursor. */
async function everyPage(auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, jobId: string, view?: View) {
  const pages: Awaited<ReturnType<typeof listResults>>["page"][] = [];
  let cursor: string | null = null;
  for (let reads = 0; reads < 20; reads++) {
    const read: Awaited<ReturnType<typeof listResults>> = await listResults(auth, jobId, { ...view, cursor });
    pages.push(read.page);
    if (read.isDone) break;
    cursor = read.continueCursor;
  }
  return pages;
}

const titles = (papers: Array<{ title: string }>) => papers.map((paper) => paper.title);
const countMatching = (auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, jobId: string, filters = DEFAULT_FILTERS) =>
  auth.query(api.extraction.queries.countJobResults, { jobId: jobId as never, filters, includeRevision: true });

describe("listJobResults", () => {
  it("searches Unicode titles and answers and keeps Unicode answer filters narrow", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const first = (await listResults(auth, jobId, { numItems: 1 })).page[0];
    await t.run(async (ctx) => {
      await ctx.db.patch("extractionPapers", first._id, {
        title: "مدارس المغرب التأثير データ 학교교육 éducation", authors: ["山田太郎"], abstract: "शिक्षा",
      });
      await ctx.db.insert("extractionResults", {
        jobId, paperId: first._id, questionKey: "q1", answer: "学校教育",
        citations: [], citationStatus: "best_effort", status: "completed", processedAt: 1,
      });
      await recomputePaperListProjection(ctx, first._id);
    });
    for (const searchQuery of ["مدارس", "التأثير", "データ", "학교교육", "éducation", "山田太郎", "शिक्षा", "学校教育"]) {
      const filters = { ...DEFAULT_FILTERS, searchQuery };
      expect((await listResults(auth, jobId, { filters })).page.map(paper => paper._id)).toEqual([first._id]);
      expect(await countMatching(auth, jobId, filters)).toMatchObject({ matching: 1 });
    }
    for (const [value, expected] of [["学校教育", [first._id]], ["大学", []], ["+", []]] as const) {
      const filters = { ...DEFAULT_FILTERS, questionFilters: [{ questionKey: "q1", value }] };
      expect((await listResults(auth, jobId, { filters })).page.map(paper => paper._id)).toEqual(expected);
      expect(await countMatching(auth, jobId, filters)).toMatchObject({ matching: expected.length });
    }
    const filters = { ...DEFAULT_FILTERS, searchQuery: "✓" };
    expect((await listResults(auth, jobId, { filters })).page).toEqual([]);
    expect(await countMatching(auth, jobId, filters)).toMatchObject({ matching: 0 });
  });

  it("reads only selected papers and treats an empty selection as empty", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const all = await listResults(auth, jobId, { numItems: 60 });
    const selectedPaperIds = [all.page[52]._id, all.page[58]._id];
    expect((await listResults(auth, jobId, { selectedPaperIds })).page.map(p => p._id)).toEqual(selectedPaperIds);
    expect((await listResults(auth, jobId, { selectedPaperIds: [] })).page).toEqual([]);
    expect(await auth.query(api.extraction.queries.countJobResults, { jobId, filters: DEFAULT_FILTERS, selectedPaperIds })).toEqual({ all: 60, matching: 2, revision: null });
    const filtered = await listResults(auth, jobId, { selectedPaperIds, filters: { ...DEFAULT_FILTERS, searchQuery: "rare" } });
    expect(filtered.page).toEqual([]);
  });

  it("steps through every paper once in the order they were added, with answers only on the page's papers", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const pages = await everyPage(auth, jobId);
    const all = pages.flat();

    expect(pages.filter((page) => page.length).map((page) => page.length)).toEqual([25, 25, 10]);
    expect(new Set(all.map((paper) => paper._id)).size).toBe(60);
    expect(titles(all.slice(0, 2))).toEqual(["Paper 1", "Paper 2"]);
    expect(all.filter((paper) => paper.results.length).map((paper) => [paper.title, paper.results[0].answer])).toEqual([["Rare Search Match", "Target answer"]]);
  });

  it("orders by title and by confidence, either way, across the whole job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const first = async (sortBy: NonNullable<View["sortBy"]>) => titles((await listResults(auth, jobId, { sortBy, numItems: 2 })).page);

    expect(await first("title-asc")).toEqual(["Alpha Result", "Mike Result"]);
    expect((await first("title-desc"))[0]).toBe("Rare Search Match");
    expect(await first("confidence-high")).toEqual(["Rare Search Match", "Mike Result"]);
    expect((await first("confidence-low"))[0]).toBe("Alpha Result");
  });

  it("keeps papers by confidence, status and answer wherever they are in the job, and counts them", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const kept = async (filters: Partial<typeof DEFAULT_FILTERS>) => titles((await everyPage(auth, jobId, { filters: { ...DEFAULT_FILTERS, ...filters }, numItems: 5 })).flat());

    expect(await kept({ confidenceRange: [90, 100] })).toEqual(["Rare Search Match"]);
    expect(await kept({ statusFilters: ["has-pdf"] })).toEqual(["Rare Search Match"]);
    expect(await kept({ statusFilters: ["open-access"] })).toEqual(["Rare Search Match"]);
    expect(await countMatching(auth, jobId, { ...DEFAULT_FILTERS, statusFilters: ["open-access"] })).toMatchObject({ all: 60, matching: 1 });
    expect(await kept({ statusFilters: ["low-confidence"] })).toEqual(["Alpha Result"]);
    expect(await kept({ questionFilters: [{ questionKey: "q1", value: true }] })).toEqual(["Rare Search Match"]);
    expect(await countMatching(auth, jobId, { ...DEFAULT_FILTERS, confidenceRange: [90, 100] })).toMatchObject({ all: 60, matching: 1 });
    expect(await countMatching(auth, jobId)).toMatchObject({ all: 60, matching: 60 });
  });

  it("sorts a search's matches and steps through them", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const view = { filters: { ...DEFAULT_FILTERS, searchQuery: "generic" }, sortBy: "title-asc" as const, numItems: 40 };

    const pages = await everyPage(auth, jobId, view);
    const all = pages.flat();

    expect(pages.map((page) => page.length)).toEqual([40, 19]);
    expect(new Set(all.map((paper) => paper._id)).size).toBe(59);
    expect(titles(all.slice(0, 2))).toEqual(["Alpha Result", "Mike Result"]);
    expect(await countMatching(auth, jobId, view.filters)).toMatchObject({ all: 60, matching: 59 });

    const rare = await listResults(auth, jobId, { filters: { ...DEFAULT_FILTERS, searchQuery: "rare" } });
    expect(rare.page.map((paper) => [paper.title, paper.results.map((result) => result.answer)])).toEqual([["Rare Search Match", ["Target answer"]]]);
    expect(rare.isDone).toBe(true);
  });

  it("shows someone else nothing of the job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "clerk_someone_else", email: "else@test.com", state: "active" as const, createdAt: 1, updatedAt: 1 }));
    const other = t.withIdentity({ tokenIdentifier: "https://test.clerk.local|clerk_someone_else", subject: "clerk_someone_else", issuer: "https://test.clerk.local" });

    expect(await listResults(other, jobId)).toMatchObject({ page: [], isDone: true });
    expect(await countMatching(other, jobId)).toEqual({ all: 0, matching: 0, revision: -1 });
  });

  it("is read page by page by an export, in the view's order and filter", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const view = { filters: { ...DEFAULT_FILTERS, confidenceRange: [50, 100] as [number, number] }, sortBy: "title-asc" as const };

    const whole = await listResults(auth, jobId, { ...view, numItems: 200 });
    const exported = await readExtractionExport((cursor) => listResults(auth, jobId, { ...view, cursor, numItems: 7 }), () => countMatching(auth, jobId, view.filters), async () => ({}));

    expect(whole.page.length).toBeGreaterThan(7);
    expect(exported.papers.map((paper) => paper._id)).toEqual(whole.page.map((paper) => paper._id));
  });

  it("rereads answers and job metadata after same-count changes, including before counters fold", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const first = (await listResults(auth, jobId, { numItems: 1 })).page[0];
    let changed = false;
    const data = await readExtractionExport(async cursor => {
      if (cursor && !changed) {
        changed = true;
        await t.run(async ctx => {
          await ctx.db.insert("extractionResults", { jobId, paperId: first._id, questionKey: "q1", answer: "Corrected value", citations: [], citationStatus: "best_effort", status: "completed", processedAt: 1 });
          await ctx.db.patch("extractionJobs", jobId, { name: "Corrected job" });
        });
      }
      return listResults(auth, jobId, { cursor, numItems: 7 });
    }, () => countMatching(auth, jobId), async () => ({ name: (await t.run(ctx => ctx.db.get("extractionJobs", jobId)))!.name }));
    expect(data.name).toBe("Corrected job");
    expect(data.papers).toHaveLength(60);
    expect(data.papers.find(p => p._id === first._id)!.results[0].answer).toBe("Corrected value");
    const before = await countMatching(auth, jobId);
    await foldCounts(t);
    expect(await countMatching(auth, jobId)).toEqual(before);
  });

  it("keeps counts readable but refuses a snapshot while more changes are waiting than it can count", async () => {
    vi.useFakeTimers();
    try {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    await t.run(async ctx => {
      for (let i = 0; i < 10_001; i++) await ctx.db.insert("extractionCountChanges", { jobId, queuedAt: 1n, deltas: { exportRevision: 1 } });
    });
    expect(await countMatching(auth, jobId)).toEqual({ all: 60, matching: 60, revision: null });
    await expect(readExtractionExport(cursor => listResults(auth, jobId, { cursor }), () => countMatching(auth, jobId), async () => ({})))
      .rejects.toMatchObject({ code: "exportChanged" });
    } finally { vi.useRealTimers(); }
  });

  it("is read again from the start when a paper moves between pages mid-export", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const view = { sortBy: "confidence-high" as const, numItems: 20 };
    const firstPage = await listResults(auth, jobId, view);

    let moved = false;
    const exported = await readExtractionExport(async (cursor) => {
      if (cursor !== null && !moved) {
        // The last paper of page 1 drops to the bottom, where the walk reads it a second time.
        moved = true;
        await t.run((ctx) => ctx.db.patch(firstPage.page.at(-1)!._id, { avgConfidence: 0 }));
      }
      return listResults(auth, jobId, { ...view, cursor });
    }, () => countMatching(auth, jobId), async () => ({}));

    const ids = exported.papers.map((paper) => paper._id);
    expect(moved).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(60);
  });
});
