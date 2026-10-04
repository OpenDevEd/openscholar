import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { seedFullJobGraph, SEED_IDENTITY } from "./tests/seed";

/**
 * Safety net SN-3 (P3 plan): drive every public query once against a
 * fully-seeded job graph and assert the headline field. Unlike SN-1 (routing
 * only), this suite verifies the query plumbs through `resolveOwnedJob` →
 * DB reads → response shaping correctly. If the barrel split silently sends
 * a caller to the wrong handler, the headline assertion goes red.
 *
 * Covers: getJobShell, getJobDetails, listJobResults,
 * subscribeToJobProgress.
 */

async function seedAndAuth() {
  const t = convexTest(schema);
  const ids = await seedFullJobGraph(t);
  const FLAG_KEYS = ["extraction.enabled"] as const;
  await t.run(async (ctx) => {
    await seedOrganizationFeatures(ctx, [SEED_IDENTITY.subject], { extraction: true });
    for (const key of FLAG_KEYS) {
      await ctx.db.insert("featureFlags", {
        key,
        enabled: true,
        description: `${key} (test)`,
        updatedAt: Date.now(),
      });
    }
  });
  await t.mutation(
    internal.extraction.mutations.internal.admin.rebuildJobListProjection,
    { jobId: ids.jobId },
  );
  const auth = t.withIdentity(SEED_IDENTITY);
  return { t, auth, ids };
}

describe("SN-3 public queries resolve against a seeded job graph", () => {
  test("getJobShell returns the job without questions or papers", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getJobShell, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.job.name).toBe("Test Job");
    expect("questions" in res).toBe(false);
    expect("papers" in res).toBe(false);
  });

  test("getJobDetails returns job questions without result-page paper rows", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.getJobDetails, {
      jobId: ids.jobId,
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.job.name).toBe("Test Job");
    expect(res.questions).toHaveLength(1);
    expect("papers" in res).toBe(false);
    expect("progress" in res).toBe(false);
  });

  test("listJobResults reaches handler", async () => {
    const { auth, ids } = await seedAndAuth();
    const res = await auth.query(api.extraction.queries.listJobResults, {
      jobId: ids.jobId,
      paginationOpts: { cursor: null, numItems: 200 },
      filters: {
        searchQuery: "",
        confidenceRange: [0, 100],
        statusFilters: [],
        questionFilters: [],
      },
      sortBy: "default",
    });
    expect(res.isDone).toBe(true);
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

});
