import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";

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
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_OWNER,
      email: "results-page@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      minimumTier: 0,
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
      processedPapers: 60,
      failedPapers: 0,
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

async function getResultsExport(
  auth: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  jobId: string,
  overrides?: Partial<{
    filters: typeof DEFAULT_FILTERS;
    sortBy: "default" | "title-asc" | "title-desc" | "confidence-high" | "confidence-low";
  }>,
) {
  return await auth.query(api.extraction.queries.getJobResultsForExport, {
    jobId: jobId as never,
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

  it("returns the full filtered corpus for export with a count equal to totalFiltered", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJobWithProjectionCorpus(t);
    const auth = t.withIdentity(OWNER_IDENTITY);
    const filters = {
      ...DEFAULT_FILTERS,
      statusFilters: ["has-pdf"],
    };

    const pageResult = await getResultsPage(auth, jobId, {
      filters,
      pageSize: 1,
    });
    const exportResult = await getResultsExport(auth, jobId, {
      filters,
    });

    expect(pageResult.status).toBe("ok");
    expect(exportResult.status).toBe("ok");
    if (pageResult.status !== "ok" || exportResult.status !== "ok") {
      throw new Error("unreachable");
    }
    expect(exportResult.totalFiltered).toBe(pageResult.totalFiltered);
    expect(exportResult.items).toHaveLength(pageResult.totalFiltered);
    expect(exportResult.items.map((paper) => paper.title)).toEqual([
      "Rare Search Match",
    ]);
    expect(exportResult.items[0]?.results[0]).not.toHaveProperty("reviewState");
  });
});
