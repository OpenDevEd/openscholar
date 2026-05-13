/**
 * Plan-07 — listPaperErrors behavior tests.
 *
 * Covers the test plan:
 *   - 50 errors seeded; paginate through them; isDone flips correctly.
 *   - Ordering: newest first (by `_creationTime` desc via `by_paper` + `order desc`).
 *
 * Plus the caller-safe invariant (unowned paper → empty paginated shell).
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";

const CLERK_OWNER = "clerk_error_history_owner";
const OWNER_IDENTITY = {
  tokenIdentifier: `https://test.clerk.local|${CLERK_OWNER}`,
  subject: CLERK_OWNER,
  issuer: "https://test.clerk.local",
};

async function seedPaperWithErrors(
  t: ReturnType<typeof convexTest>,
  count: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_OWNER,
      email: "owner@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Error History Test",
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:history",
      title: "Flaky Upstream Paper",
      status: "failed" as const,
    });
    for (let i = 1; i <= count; i++) {
      await ctx.db.insert("extractionPaperErrors", {
        paperId,
        jobId,
        attempt: i,
        at: now + i,
        code: i % 2 === 0 ? ("rate_limit" as const) : ("network" as const),
        message: `attempt ${i} failed`,
      });
    }
    return { userId, jobId, paperId };
  });
}

describe("listPaperErrors", () => {
  it("paginates through 50 errors and flips isDone on the final page", async () => {
    const t = convexTest(schema);
    const { paperId } = await seedPaperWithErrors(t, 50);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const pageSize = 20;
    let cursor: string | null = null;
    const collected: Id<"extractionPaperErrors">[] = [];
    let lastIsDone = false;

    // Iterate with a safety limit so a regression cannot loop forever.
    for (let iter = 0; iter < 10; iter++) {
      const page: {
        page: Array<{ _id: Id<"extractionPaperErrors"> }>;
        isDone: boolean;
        continueCursor: string;
      } = await auth.query(
        api.extraction.queries.errorHistory.listPaperErrors,
        {
          paperId,
          paginationOpts: { cursor, numItems: pageSize },
        },
      );
      for (const row of page.page) collected.push(row._id);
      lastIsDone = page.isDone;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    expect(lastIsDone).toBe(true);
    expect(collected.length).toBe(50);
    // Dedup sanity: every _id unique.
    expect(new Set(collected).size).toBe(50);
  });

  it("returns rows newest-first (desc on _creationTime)", async () => {
    const t = convexTest(schema);
    const { paperId } = await seedPaperWithErrors(t, 5);
    const auth = t.withIdentity(OWNER_IDENTITY);

    const page = await auth.query(
      api.extraction.queries.errorHistory.listPaperErrors,
      {
        paperId,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    // Seeding went 1→5 with monotonically increasing `_creationTime`.
    // Descending order means attempt numbers appear 5, 4, 3, 2, 1.
    const attempts = page.page.map((row) => row.attempt);
    expect(attempts).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns an empty paginated shell for an unowned paper (no existence leak)", async () => {
    const t = convexTest(schema);
    const { paperId } = await seedPaperWithErrors(t, 3);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_error_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });

    const foreign = t.withIdentity({
      tokenIdentifier: "https://test.clerk.local|clerk_error_other",
      subject: "clerk_error_other",
      issuer: "https://test.clerk.local",
    });
    const page = await foreign.query(
      api.extraction.queries.errorHistory.listPaperErrors,
      {
        paperId,
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(page.page).toEqual([]);
    expect(page.isDone).toBe(true);
  });
});
