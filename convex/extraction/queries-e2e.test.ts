import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { seedFullJobGraph, SEED_IDENTITY } from "./tests/seed";
import { setupAggregates } from "./aggregates.test-support";

/**
 * Safety net SN-3 (P3 plan): drive every public query once against a
 * fully-seeded job graph and assert the headline field. Unlike SN-1 (routing
 * only), this suite verifies the query plumbs through `resolveOwnedJob` →
 * DB reads → response shaping correctly. If the barrel split silently sends
 * a caller to the wrong handler, the headline assertion goes red.
 *
 * Covers: getJobDetails, getJobResultsPaginated, getJobInsights,
 * getQuestionInsights, getQuestionDisagreements, getReviewQueue,
 * subscribeToJobProgress, getSavedViews, getWorkflowTemplates,
 * getReportSnapshots, getRunDiff.
 */

async function seedAndAuth() {
  const t = convexTest(schema);
  setupAggregates(t);
  const ids = await seedFullJobGraph(t);
  // Queries gate on the extraction.enabled master switch plus the tier
  // flags (insights, reviewQueue, reportBuilder, templates). Enable each
  // with zero tier for the pin-test so routing reaches the real handler.
  const FLAG_KEYS = [
    "extraction.enabled",
    "extraction.insights",
    "extraction.reviewQueue",
    "extraction.reportBuilder",
    "extraction.templates",
  ] as const;
  await t.run(async (ctx) => {
    for (const key of FLAG_KEYS) {
      await ctx.db.insert("featureFlags", {
        key,
        enabled: true,
        minimumTier: 0,
        description: `${key} (test)`,
        updatedAt: Date.now(),
      });
    }
  });
  const auth = t.withIdentity(SEED_IDENTITY);
  return { t, auth, ids };
}

describe("SN-3 public queries resolve against a seeded job graph", () => {
  test("getJobDetails returns ok with seeded job name and one paper", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getJobDetails, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.job.name).toBe("Test Job");
    expect(res.questions).toHaveLength(1);
    expect(res.papers).toHaveLength(1);
  });

  test("getJobResultsPaginated reaches handler", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(
      api.extraction.queries.getJobResultsPaginated,
      { jobId: ids.jobId, paginationOpts: { numItems: 10, cursor: null } }
    );
    expect(res.status).toBe("ok");
  });

  test("getJobInsights returns ok with totalPapers=1", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getJobInsights, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.summary.totalPapers).toBe(1);
  });

  test("getQuestionInsights returns ok for seeded questionKey q1", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getQuestionInsights, {
      jobId: ids.jobId,
      questionKey: "q1",
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.question.key).toBe("q1");
  });

  test("getQuestionDisagreements returns ok for seeded questionKey q1", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(
      api.extraction.queries.getQuestionDisagreements,
      { jobId: ids.jobId, questionKey: "q1" }
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.question.key).toBe("q1");
  });

  test("getReviewQueue returns ok with the seeded review counted", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getReviewQueue, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.counts.total).toBeGreaterThanOrEqual(1);
  });

  test("subscribeToJobProgress returns ok with seeded totals", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(
      api.extraction.queries.subscribeToJobProgress,
      { jobId: ids.jobId }
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.job.name).toBe("Test Job");
    expect(res.totalPapers).toBe(1);
  });

  test("getSavedViews returns ok with the seeded view", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getSavedViews, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.views).toHaveLength(1);
    expect(res.views[0].name).toBe("Test View");
  });

  test("getWorkflowTemplates returns an array (empty for seeded user)", async () => {
    const { auth } = await seedAndAuth();
    const res = await auth.query(
      api.extraction.queries.getWorkflowTemplates,
      {}
    );
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(0);
  });

  test("getReportSnapshots returns ok with the seeded snapshot", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getReportSnapshots, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.reports).toHaveLength(1);
    expect(res.reports[0].name).toBe("Test Report");
  });

  test("getRunDiff returns ok with the latest seeded diff", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getRunDiff, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.diff).not.toBeNull();
    expect(res.diff?._id).toBe(ids.runDiffId);
  });
});
