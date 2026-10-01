/**
 * Integration tests for the chatPapers query + mutation surface
 * (plan-03). Covers the join shape, single-toggle idempotency, bulk
 * modes (all-for-job and subset), and cross-user auth denial for
 * every entry point.
 */

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type TestInstance = ReturnType<typeof convexTest>;

const IDENTITY_A = {
  tokenIdentifier: "https://test.clerk.local|clerk_owner_a",
  subject: "clerk_owner_a",
  issuer: "https://test.clerk.local",
};

const IDENTITY_B = {
  tokenIdentifier: "https://test.clerk.local|clerk_owner_b",
  subject: "clerk_owner_b",
  issuer: "https://test.clerk.local",
};

async function seedUser(
  t: TestInstance,
  clerkId: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId,
      email: `${clerkId}@test.com`,
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedChatJob(
  t: TestInstance,
  userId: Id<"users">,
): Promise<Id<"extractionJobs">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat" as const,
      sourceType: "history" as const,
      name: "Test chat",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedSources(
  t: TestInstance,
  jobId: Id<"extractionJobs">,
  count: number,
  initialIncluded = true,
): Promise<{
  sourceIds: Id<"extractionJobSources">[];
  chatPaperIds: Id<"chatPapers">[];
}> {
  return await t.run(async (ctx) => {
    const sourceIds: Id<"extractionJobSources">[] = [];
    const chatPaperIds: Id<"chatPapers">[] = [];
    for (let i = 0; i < count; i++) {
      const sourceId = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: i,
        bucketKey: `history:W${i}`,
        source: "library" as const,
        sourceRefId: `W${i}`,
        title: `Paper ${i}`,
        authors: [`Author ${i}`],
        openalexId: `W${i}`,
        year: 2020 + i,
      });
      sourceIds.push(sourceId);
      const chatPaperId = await ctx.db.insert("chatPapers", {
        jobId,
        sourceId,
        included: initialIncluded,
      });
      chatPaperIds.push(chatPaperId);
    }
    return { sourceIds, chatPaperIds };
  });
}

describe("listChatSourcesWithInclusion", () => {
  it("returns one row per source with included=true, sorted by position", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    await seedSources(t, jobId, 3);

    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.query(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );

    expect(result.totalCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(
      result.rows.map((r: (typeof result.rows)[number]) => r.position),
    ).toEqual([0, 1, 2]);
    expect(
      result.rows.every((r: (typeof result.rows)[number]) => r.included === true),
    ).toBe(true);
    expect(
      result.rows.every((r: (typeof result.rows)[number]) => r.jobId === jobId),
    ).toBe(true);
    expect(result.rows[0].title).toBe("Paper 0");
    expect(result.rows[0].year).toBe(2020);
    expect(result.rows[0].authors).toEqual(["Author 0"]);
    expect(result.rows[0].sourceType).toBe("openalex");
  });

  it("reflects live included=false after a direct patch", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    const { chatPaperIds } = await seedSources(t, jobId, 3);

    await t.run(async (ctx) => {
      await ctx.db.patch(chatPaperIds[1], { included: false });
    });

    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.query(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    expect(result.totalCount).toBe(3);
    expect(
      result.rows.find((r: (typeof result.rows)[number]) => r.position === 1)
        ?.included,
    ).toBe(false);
    expect(
      result.rows.find((r: (typeof result.rows)[number]) => r.position === 0)
        ?.included,
    ).toBe(true);
    expect(
      result.rows.find((r: (typeof result.rows)[number]) => r.position === 2)
        ?.included,
    ).toBe(true);
  });

  it("keeps totalCount authoritative while mirrored chat rows are still bootstrapping", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);

    await t.run(async (ctx) => {
      const sourceOne = await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 0,
        bucketKey: "history:W0",
        source: "library" as const,
        sourceRefId: "W0",
        title: "Paper 0",
        authors: ["Author 0"],
        openalexId: "W0",
        year: 2020,
      });
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 1,
        bucketKey: "history:W1",
        source: "library" as const,
        sourceRefId: "W1",
        title: "Paper 1",
        authors: ["Author 1"],
        openalexId: "W1",
        year: 2021,
      });
      await ctx.db.insert("chatPapers", {
        jobId,
        sourceId: sourceOne,
        included: true,
      });
    });

    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.query(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );

    expect(result.totalCount).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe("Paper 0");
  });

  it("denies a non-owner reading another user's chat sources", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    await seedUser(t, "clerk_owner_b");
    const jobId = await seedChatJob(t, userA);
    await seedSources(t, jobId, 2);

    const auth = t.withIdentity(IDENTITY_B);
    await expect(
      auth.query(api.chat.chatPapers.listChatSourcesWithInclusion, {
        jobId,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });
});

describe("toggleChatPaper", () => {
  it("flips included from true to false", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    const { chatPaperIds } = await seedSources(t, jobId, 1);

    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.mutation(
      api.chat.chatPapers.toggleChatPaper,
      { chatPaperId: chatPaperIds[0], included: false },
    );

    expect(result).toEqual({
      chatPaperId: chatPaperIds[0],
      included: false,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(chatPaperIds[0]);
      expect(row?.included).toBe(false);
    });
  });

  it("is idempotent — calling with the same value twice is a no-op", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    const { chatPaperIds } = await seedSources(t, jobId, 1);

    const auth = t.withIdentity(IDENTITY_A);
    await auth.mutation(api.chat.chatPapers.toggleChatPaper, {
      chatPaperId: chatPaperIds[0],
      included: false,
    });
    await auth.mutation(api.chat.chatPapers.toggleChatPaper, {
      chatPaperId: chatPaperIds[0],
      included: false,
    });

    await t.run(async (ctx) => {
      const row = await ctx.db.get(chatPaperIds[0]);
      expect(row?.included).toBe(false);
    });
  });

  it("denies a non-owner toggling another user's chat paper", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    await seedUser(t, "clerk_owner_b");
    const jobId = await seedChatJob(t, userA);
    const { chatPaperIds } = await seedSources(t, jobId, 1);

    const auth = t.withIdentity(IDENTITY_B);
    await expect(
      auth.mutation(api.chat.chatPapers.toggleChatPaper, {
        chatPaperId: chatPaperIds[0],
        included: false,
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    // Row is unchanged.
    await t.run(async (ctx) => {
      const row = await ctx.db.get(chatPaperIds[0]);
      expect(row?.included).toBe(true);
    });
  });
});

describe("bulkSetChatPapers", () => {
  it("with undefined sourceIds flips every row for the job", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    await seedSources(t, jobId, 10);

    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.mutation(
      api.chat.chatPapers.bulkSetChatPapers,
      { jobId, included: false },
    );
    expect(result.changedCount).toBe(10);

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(rows.every((r) => r.included === false)).toBe(true);
    });
  });

  it("with explicit sourceIds limits the patch to that subset", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    const { sourceIds } = await seedSources(t, jobId, 10);

    const subset = [sourceIds[1], sourceIds[3], sourceIds[7]];
    const auth = t.withIdentity(IDENTITY_A);
    const result = await auth.mutation(
      api.chat.chatPapers.bulkSetChatPapers,
      { jobId, sourceIds: subset, included: false },
    );
    expect(result.changedCount).toBe(3);

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      const excluded = rows.filter((r) => !r.included).map((r) => r.sourceId);
      expect(new Set(excluded)).toEqual(new Set(subset));
      expect(rows.filter((r) => r.included)).toHaveLength(7);
    });
  });

  it("is idempotent — second call with the same args reports changedCount=0", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    const jobId = await seedChatJob(t, userA);
    await seedSources(t, jobId, 5);

    const auth = t.withIdentity(IDENTITY_A);
    const first = await auth.mutation(
      api.chat.chatPapers.bulkSetChatPapers,
      { jobId, included: false },
    );
    expect(first.changedCount).toBe(5);
    const second = await auth.mutation(
      api.chat.chatPapers.bulkSetChatPapers,
      { jobId, included: false },
    );
    expect(second.changedCount).toBe(0);
  });

  it("denies a non-owner bulk-setting another user's chat papers", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "clerk_owner_a");
    await seedUser(t, "clerk_owner_b");
    const jobId = await seedChatJob(t, userA);
    await seedSources(t, jobId, 3);

    const auth = t.withIdentity(IDENTITY_B);
    await expect(
      auth.mutation(api.chat.chatPapers.bulkSetChatPapers, {
        jobId,
        included: false,
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    // Rows unchanged.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(rows.every((r) => r.included === true)).toBe(true);
    });
  });
});
