import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../credits/aggregates.test-support";
import { incPaperOutcome } from "./jobCounters";

const CLERK_OWNER = "clerk_rebuild_projection";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

async function seedPreProjectionJob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    await seedOrganizationFeatures(ctx, [CLERK_OWNER], { extraction: true });
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_OWNER,
      email: "rebuild-projection@test.com",
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
    await seedCreditsForTest(ctx, { userId, free: 0, paid: 10_000, now });

    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Pre-projection job",
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "Outcome?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });

    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:repair-1",
      title: "Repairable Paper",
      processable: true,
      status: "completed" as const,
      authors: ["A. Author"],
      abstract: "Repair helper test abstract",
      pdfContentUsed: false,
      isOpenAccess: true,
    });

    await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q1",
      answer: "Recovered answer",
      citations: [],
      citationStatus: "grounded" as const,
      confidence: 0.82,
      status: "completed" as const,
      processedAt: now,
    });

    await incPaperOutcome(ctx, jobId, true);

    return { jobId };
  });
}

describe("rebuildJobListProjection", () => {
  it("repairs pre-projection jobs instead of relying on a runtime fallback", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    const { jobId } = await seedPreProjectionJob(t);
    const auth = t.withIdentity(OWNER_IDENTITY);

    await expect(
      auth.query(api.extraction.queries.getJobResultsPage, {
        jobId,
        page: 1,
        pageSize: 25,
        filters: {
          searchQuery: "",
          confidenceRange: [0, 100],
          statusFilters: [],
          questionFilters: [],
        },
        sortBy: "default",
      }),
    ).rejects.toThrow(/rebuildJobListProjection/);

    const repair = await t.mutation(
      internal.extraction.mutations.internal.admin.rebuildJobListProjection,
      { jobId },
    );
    expect(repair.rebuilt).toBe(1);
    expect(repair.remaining).toBe(0);
    expect(repair.scheduled).toBe(false);

    const results = await auth.query(api.extraction.queries.getJobResultsPage, {
      jobId,
      page: 1,
      pageSize: 25,
      filters: {
        searchQuery: "",
        confidenceRange: [0, 100],
        statusFilters: [],
        questionFilters: [],
      },
      sortBy: "default",
    });

    expect(results.status).toBe("ok");
    if (results.status !== "ok") {
      throw new Error("unreachable");
    }
    expect(results.totalFiltered).toBe(1);
    expect(results.items[0]?.title).toBe("Repairable Paper");
    expect(results.items[0]?.results[0]?.answer).toBe("Recovered answer");
  });
});
