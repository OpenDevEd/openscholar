import { seedOrganizationFeatures } from "../../organizationFeatures.test-support";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { readEveryResultsPage } from "../../../lib/extraction/export";

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

async function getResultsPage(
  auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  jobId: string,
  overrides?: Partial<{
    page: number;
    pageSize: number;
    filters: typeof DEFAULT_FILTERS;
    sortBy: "default" | "title-asc" | "title-desc" | "confidence-high" | "confidence-low";
  }>,
) {
  return await auth.query(api.extraction.queries.getJobResultsPage, {
    jobId: jobId as never,
    page: overrides?.page ?? 1,
    pageSize: overrides?.pageSize ?? 25,
    filters: overrides?.filters ?? DEFAULT_FILTERS,
    sortBy: overrides?.sortBy ?? "default",
  });
}

describe("getJobResultsPage", () => {
  it("filters search over the full bounded corpus before slicing page 1", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await getResultsPage(auth, jobId, {
      filters: {
        ...DEFAULT_FILTERS,
        searchQuery: "rare",
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.totalAll).toBe(60);
    expect(result.totalFiltered).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Rare Search Match");
    expect(result.items[0]?.results).toEqual([
      expect.objectContaining({
        answer: "Target answer",
      }),
    ]);
    expect(result.items[0]?.results[0]).not.toHaveProperty("reviewState");
  });

  it("applies confidence range filters over late papers outside the first raw page", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await getResultsPage(auth, jobId, {
      filters: {
        ...DEFAULT_FILTERS,
        confidenceRange: [90, 100],
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.totalFiltered).toBe(1);
    expect(result.items.map((paper) => paper.title)).toEqual(["Rare Search Match"]);
  });

  it("supports has-pdf and open-access status filters from projection fields", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const hasPdf = await getResultsPage(auth, jobId, {
      filters: {
        ...DEFAULT_FILTERS,
        statusFilters: ["has-pdf"],
      },
    });
    const openAccess = await getResultsPage(auth, jobId, {
      filters: {
        ...DEFAULT_FILTERS,
        statusFilters: ["open-access"],
      },
    });

    expect(hasPdf.status).toBe("ok");
    expect(openAccess.status).toBe("ok");
    if (hasPdf.status !== "ok" || openAccess.status !== "ok") {
      throw new Error("unreachable");
    }
    expect(hasPdf.totalFiltered).toBe(1);
    expect(hasPdf.items.map((paper) => paper.title)).toEqual([
      "Rare Search Match",
    ]);
    expect(openAccess.totalFiltered).toBe(1);
    expect(openAccess.items.map((paper) => paper.title)).toEqual([
      "Rare Search Match",
    ]);
  });

  it("applies question equality filters from questionAnswerTokens", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await getResultsPage(auth, jobId, {
      filters: {
        ...DEFAULT_FILTERS,
        questionFilters: [{ questionKey: "q1", value: true }],
      },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.totalFiltered).toBe(1);
    expect(result.items.map((paper) => paper.title)).toEqual(["Rare Search Match"]);
  });

  it("sorts titles across the full corpus before taking the first page", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await getResultsPage(auth, jobId, {
      sortBy: "title-asc",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.items[0]?.title).toBe("Alpha Result");
    expect(result.items[1]?.title).toBe("Mike Result");
  });

  it("sorts confidence across the full corpus before taking the first page", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const result = await getResultsPage(auth, jobId, {
      sortBy: "confidence-high",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.items[0]?.title).toBe("Rare Search Match");
    expect(result.items[1]?.title).toBe("Mike Result");
  });

  it("loads full child rows only for the visible page slice", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const pageTwo = await getResultsPage(auth, jobId, {
      page: 2,
      pageSize: 25,
    });
    const pageThree = await getResultsPage(auth, jobId, {
      page: 3,
      pageSize: 25,
    });

    expect(pageTwo.status).toBe("ok");
    expect(pageThree.status).toBe("ok");
    if (pageTwo.status !== "ok" || pageThree.status !== "ok") {
      throw new Error("unreachable");
    }
    expect(pageTwo.items.every((paper) => paper.results.length === 0)).toBe(true);
    expect(pageThree.items[1]?.title).toBe("Rare Search Match");
    expect(pageThree.items[1]?.results).toEqual([
      expect.objectContaining({
        answer: "Target answer",
      }),
    ]);
    expect(pageThree.items[1]?.results[0]).not.toHaveProperty("reviewState");
  });

});

type View = Partial<{ cursor: string | null; numItems: number; filters: typeof DEFAULT_FILTERS; sortBy: "default" | "title-asc" | "title-desc" | "confidence-high" | "confidence-low" }>;

async function listResults(auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, jobId: string, view?: View) {
  return await auth.query(api.extraction.queries.listJobResults, {
    jobId: jobId as never,
    filters: view?.filters ?? DEFAULT_FILTERS,
    sortBy: view?.sortBy ?? "default",
    paginationOpts: { cursor: view?.cursor ?? null, numItems: view?.numItems ?? 25 },
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
  auth.query(api.extraction.queries.countJobResults, { jobId: jobId as never, filters });

describe("listJobResults", () => {
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
    expect(await kept({ statusFilters: ["low-confidence"] })).toEqual(["Alpha Result"]);
    expect(await kept({ questionFilters: [{ questionKey: "q1", value: true }] })).toEqual(["Rare Search Match"]);
    expect(await countMatching(auth, jobId, { ...DEFAULT_FILTERS, confidenceRange: [90, 100] })).toEqual({ all: 60, matching: 1 });
    expect(await countMatching(auth, jobId)).toEqual({ all: 60, matching: 60 });
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
    expect(await countMatching(auth, jobId, view.filters)).toEqual({ all: 60, matching: 59 });
  });

  it("shows someone else nothing of the job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    await t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "clerk_someone_else", email: "else@test.com", state: "active" as const, createdAt: 1, updatedAt: 1 }));
    const other = t.withIdentity({ tokenIdentifier: "https://test.clerk.local|clerk_someone_else", subject: "clerk_someone_else", issuer: "https://test.clerk.local" });

    expect(await listResults(other, jobId)).toMatchObject({ page: [], isDone: true });
    expect(await countMatching(other, jobId)).toEqual({ all: 0, matching: 0 });
  });

  it("is read page by page by an export, in the view's order and filter", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const view = { filters: { ...DEFAULT_FILTERS, confidenceRange: [50, 100] as [number, number] }, sortBy: "title-asc" as const };

    const whole = await listResults(auth, jobId, { ...view, numItems: 200 });
    const exported = await readEveryResultsPage((cursor) => listResults(auth, jobId, { ...view, cursor, numItems: 7 }), async () => (await countMatching(auth, jobId, view.filters)).matching);

    expect(whole.page.length).toBeGreaterThan(7);
    expect(exported.map((paper) => paper._id)).toEqual(whole.page.map((paper) => paper._id));
  });

  it("is read again from the start when a paper moves between pages mid-export", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const view = { sortBy: "confidence-high" as const, numItems: 20 };
    const firstPage = await listResults(auth, jobId, view);

    let moved = false;
    const exported = await readEveryResultsPage(async (cursor) => {
      if (cursor !== null && !moved) {
        // The last paper of page 1 drops to the bottom, where the walk reads it a second time.
        moved = true;
        await t.run((ctx) => ctx.db.patch(firstPage.page.at(-1)!._id, { avgConfidence: 0 }));
      }
      return listResults(auth, jobId, { ...view, cursor });
    }, async () => (await countMatching(auth, jobId)).matching);

    const ids = exported.map((paper) => paper._id);
    expect(moved).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(60);
  });
});
